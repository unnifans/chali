import { api } from '../api.js';

// Read-efficient joke fetcher across the Chali API.
//
// The Worker serves exactly ONE active joke per request (a random-walk over a
// SQLite (status, rand) index), instead of pulling the whole pool like the old
// Firestore approach. A local cursor (last { rand, id }) walks forward and the
// worker wraps when it reaches the end; a small "recently shown" set keeps
// repeats out of any given session.

const MAX_WALK_ATTEMPTS = 8;
const RECENT_LIMIT = 40;

let cursor = null;
const recentShown = new Set();
let lastShownId = null;
let currentJoke = null;

export async function fetchRandomJoke() {
  // Random-walk: each iteration costs exactly one API call / one row.
  for (let attempt = 0; attempt < MAX_WALK_ATTEMPTS; attempt++) {
    let joke;
    try {
      const res = await api.getNextJoke(cursor);
      joke = res && res.joke ? res.joke : null;
    } catch (err) {
      console.error('Failed to fetch joke:', err);
      return null;
    }

    if (!joke) break;

    cursor = { rand: joke.rand ?? 0, id: joke.id };

    if (joke.id === lastShownId || recentShown.has(joke.id)) {
      continue; // shown recently — the next step walks past it
    }

    recordShown(joke);
    return joke;
  }

  // Pool exhausted or tiny: return the last fetched joke so the session
  // keeps working rather than showing an empty state.
  const last = currentJoke;
  if (last) {
    recentShown.clear();
    lastShownId = last.id;
    return last;
  }
  return null;
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
        // The card never scrolls internally — the page scrolls instead.
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