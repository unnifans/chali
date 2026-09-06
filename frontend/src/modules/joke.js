import { collection, query, where, orderBy, startAfter, getDocs, documentId } from 'firebase/firestore';
import { db } from '../firebase-config.js';

// Read-efficient joke fetcher (critical at viral scale).
//
// Old approach: pull the ENTIRE active pool with where('status','==','active'),
// which bills one Firestore read per active joke on every page load and again
// every time the shuffle cycle ran out. With hundreds of active jokes that is
// thousands of reads per user session.
//
// New approach: Firestore auto-generated document IDs are already random, so we
// walk the pool in document-ID order with
//   where('status','==','active').orderBy(documentId()).startAfter(cursor).limit(1)
// which returns exactly ONE joke = ONE read. A local cursor walks forward
// through the globally random ID order and wraps when it hits the end, while a
// small "recently shown" set keeps repeats out of any given session.
//
// No schema field, no backfill migration, and no composite index are needed —
// ordering by document ID is served by the automatic single-field index on
// `status`. If the query ever fails (e.g. network), it falls back to the old
// whole-pool fetch so the app never breaks.

const MAX_WALK_ATTEMPTS = 8;
const RECENT_LIMIT = 40;

// Firestore auto IDs use this alphabet; drawing a random 20-char cursor drops
// each session at a random position in the ordering.
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function randomIdCursor() {
  let s = '';
  for (let i = 0; i < 20; i++) {
    s += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  }
  return s;
}

let idCursor = randomIdCursor();
const recentShown = new Set();
let lastShownId = null;
let currentJoke = null;

// Legacy whole-pool fallback (used if the document-ID walk ever fails).
let useLegacyPool = false;
let legacyPool = [];
let legacyShown = new Set();

function walkQuery() {
  return query(
    collection(db, 'jokes'),
    where('status', '==', 'active'),
    orderBy(documentId()),
    startAfter(idCursor),
    limit(1)
  );
}

export async function fetchRandomJoke() {
  if (useLegacyPool) {
    return fetchFromLegacyPool();
  }

  // Walk the document-ID ordering: each iteration costs exactly one read.
  for (let attempt = 0; attempt < MAX_WALK_ATTEMPTS; attempt++) {
    let snap;
    try {
      snap = await getDocs(walkQuery());
    } catch (err) {
      console.warn('Doc-ID walk query failed, falling back to pool fetch:', err);
      useLegacyPool = true;
      return fetchFromLegacyPool();
    }

    if (snap.empty) {
      // Walked past the highest ID — wrap around to the beginning.
      idCursor = '';
      continue;
    }

    const doc = snap.docs[0];
    const joke = { id: doc.id, ...doc.data() };
    idCursor = joke.id; // next query is strictly after this doc

    if (recentShown.has(joke.id)) {
      continue; // shown recently — the next step naturally moves past it
    }

    recordShown(joke);
    return joke;
  }

  // Tiny pool that can't avoid a repeat: admit one and reset the recency set.
  const snap = await getDocs(walkQuery());
  if (snap.empty) {
    currentJoke = null;
    return null;
  }
  const doc = snap.docs[0];
  const joke = { id: doc.id, ...doc.data() };
  recentShown.clear();
  recordShown(joke);
  return joke;
}

function recordShown(joke) {
  lastShownId = joke.id;
  recentShown.add(joke.id);
  if (recentShown.size > RECENT_LIMIT) {
    const oldest = recentShown.values().next().value;
    if (oldest !== undefined) recentShown.delete(oldest);
  }
  currentJoke = joke;
}

async function fetchFromLegacyPool() {
  if (legacyPool.length === 0) {
    const q = query(collection(db, 'jokes'), where('status', '==', 'active'));
    const snap = await getDocs(q);
    legacyPool = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    legacyShown = new Set();
  }

  let candidates = legacyPool.filter((j) => !legacyShown.has(j.id));
  if (candidates.length === 0) {
    candidates = legacyPool.filter((j) => j.id !== lastShownId);
    if (candidates.length === 0) candidates = legacyPool;
  }

  if (candidates.length === 0) {
    currentJoke = null;
    return null;
  }

  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  legacyShown.add(picked.id);
  lastShownId = picked.id;
  currentJoke = picked;
  return currentJoke;
}

// Called after a successful vote so the currently displayed joke reflects the
// new counts/status without any extra fetch.
export function applyVoteResult(jokeId, upvotes, downvotes, status) {
  if (currentJoke && currentJoke.id === jokeId) {
    currentJoke = { ...currentJoke, upvotes, downvotes, status };
  }
}

export function renderJoke(joke) {
  const root = document.getElementById('joke-root');
  if (!joke) {
    root.innerHTML = `<p class="empty-state">No jokes available right now. Check back soon!</p>`;
    root.scrollTop = 0;
    updateVoteScore(null);
    return;
  }

  const imageHtml = joke.imageUrl
    ? `<div class="joke-image-wrap">
         <img class="joke-image" loading="lazy" src="${toCloudinaryUrl(joke.imageUrl, 500)}" alt="joke illustration" />
       </div>`
    : '';

  if (joke.type === 'single') {
    root.innerHTML = `${imageHtml}<p class="joke-text">${escapeHtml(joke.question)}</p>`;
  } else {
    root.innerHTML = `
      ${imageHtml}
      <p class="joke-text">${escapeHtml(joke.question)}</p>
      <button id="reveal-btn" class="btn-accent" disabled>Reveal Answer</button>
      <p class="joke-answer hidden" id="joke-answer">${escapeHtml(joke.answer)}</p>
    `;
    const revealBtn = document.getElementById('reveal-btn');
    revealBtn.addEventListener('click', () => {
      const answerEl = document.getElementById('joke-answer');
      answerEl.classList.remove('hidden');
      revealBtn.classList.add('hidden');
      const root = document.getElementById('joke-root');
      if (root && answerEl) {
        // Only scroll if the answer hangs below the visible area, and align to
        // its start so the beginning of the answer is readable right away.
        // On touch devices the card scrolls internally; on PC the page scrolls.
        const scroller = root.scrollHeight > root.clientHeight + 2 ? root : null;
        const visibleBottom = scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight;
        if (answerEl.getBoundingClientRect().bottom > visibleBottom) {
          answerEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }
      }
    });

    let remaining = 3;
    const timer = setInterval(() => {
      remaining--;
      if (!document.body.contains(revealBtn)) {
        clearInterval(timer);
        return;
      }
      if (remaining > 0) {
        revealBtn.textContent = `Reveal Answer `;
      } else {
        clearInterval(timer);
        revealBtn.disabled = false;
        revealBtn.textContent = 'Reveal Answer';
      }
    }, 1000);
  }

  updateVoteScore(joke);

  // Fresh card starts at the top so the beginning of the text is always visible.
  root.scrollTop = 0;
}

export function updateVoteScore(joke) {
  const scoreEl = document.getElementById('vote-score');
  if (!scoreEl) return;
  if (!joke) {
    scoreEl.textContent = '+0';
    return;
  }
  const net = joke.upvotes - joke.downvotes;
  scoreEl.textContent = `${net >= 0 ? '+' : ''}${net}`;
}

function toCloudinaryUrl(url, width) {
  return url.replace('/upload/', `/upload/f_auto,q_auto,w_${width}/`);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function getCurrentJoke() {
  return currentJoke;
}