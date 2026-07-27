import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase-config.js';

// Instead of a per-document "rand" field + range query (which is biased by
// the gaps between randomly-assigned values, not by vote count - but biased
// either way), we fetch the whole active pool once, shuffle client-side, and
// cycle through it without repeats until it's exhausted, then reshuffle.
// For a joke app's realistic scale (dozens to low hundreds of active jokes)
// this is one cheap query per "cycle", genuinely uniform, and trivially
// supports "don't show what they've already seen."

let activeJokes = [];      // cached pool: [{ id, ...data }]
let shownIds = new Set();  // ids already shown in the current shuffle cycle
let lastShownId = null;
let currentJoke = null;

async function refreshActivePool() {
  const q = query(collection(db, 'jokes'), where('status', '==', 'active'));
  const snap = await getDocs(q);
  activeJokes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  shownIds = new Set();
}

export async function fetchRandomJoke() {
  if (activeJokes.length === 0) {
    await refreshActivePool();
  }

  let candidates = activeJokes.filter((j) => !shownIds.has(j.id));

  if (candidates.length === 0) {
    // Cycle exhausted - refresh from the server (picks up newly-approved
    // jokes or status changes from other users) and start a new cycle,
    // just avoiding an immediate repeat of the very last joke shown.
    await refreshActivePool();
    candidates = activeJokes.filter((j) => j.id !== lastShownId);
    if (candidates.length === 0) candidates = activeJokes; // only 1 active joke total
  }

  if (candidates.length === 0) {
    currentJoke = null;
    return null;
  }

  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  shownIds.add(picked.id);
  lastShownId = picked.id;
  currentJoke = picked;
  return currentJoke;
}

// Called after a successful vote so the in-memory pool and the currently
// displayed joke both reflect the new counts/status without a re-fetch.
export function applyVoteResult(jokeId, upvotes, downvotes, status) {
  const idx = activeJokes.findIndex((j) => j.id === jokeId);
  if (idx !== -1) {
    if (status !== 'active') {
      activeJokes.splice(idx, 1); // quarantined - no longer eligible to be picked
    } else {
      activeJokes[idx] = { ...activeJokes[idx], upvotes, downvotes, status };
    }
  }
  if (currentJoke && currentJoke.id === jokeId) {
    currentJoke = { ...currentJoke, upvotes, downvotes, status };
  }
}

export function renderJoke(joke) {
  const root = document.getElementById('joke-root');
  if (!joke) {
    root.innerHTML = `<p class="empty-state">No jokes available right now. Check back soon!</p>`;
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
      <button id="reveal-btn" class="btn-accent">Reveal Answer</button>
      <p class="joke-answer hidden" id="joke-answer">${escapeHtml(joke.answer)}</p>
    `;
    document.getElementById('reveal-btn').addEventListener('click', () => {
      document.getElementById('joke-answer').classList.remove('hidden');
      document.getElementById('reveal-btn').classList.add('hidden');
    });
  }

  updateVoteScore(joke);
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
