import {
  collection, query, where, orderBy, limit, getDocs, startAt
} from 'firebase/firestore';
import { db } from '../firebase-config.js';

let currentJoke = null;

export async function fetchRandomJoke() {
  const jokesRef = collection(db, 'jokes');
  const r = Math.random();

  let q = query(
    jokesRef,
    where('status', '==', 'active'),
    orderBy('rand'),
    startAt(r),
    limit(1)
  );
  let snap = await getDocs(q);

  if (snap.empty) {
    q = query(jokesRef, where('status', '==', 'active'), orderBy('rand'), limit(1));
    snap = await getDocs(q);
  }

  if (snap.empty) {
    currentJoke = null;
    return null;
  }

  const doc = snap.docs[0];
  currentJoke = { id: doc.id, ...doc.data() };
  return currentJoke;
}

export function renderJoke(joke) {
  const root = document.getElementById('joke-root');
  if (!joke) {
    root.innerHTML = `<p class="empty-state">No jokes available right now. Check back soon!</p>`;
    return;
  }

  const imageHtml = joke.imageUrl
    ? `<img class="joke-image" loading="lazy" src="${toCloudinaryUrl(joke.imageUrl, 500)}" alt="joke illustration" />`
    : '';

  const badgeHtml = `<span class="joke-badge"></span>`;

  if (joke.type === 'single') {
    root.innerHTML = `${badgeHtml}${imageHtml}<p class="joke-text">${escapeHtml(joke.question)}</p>`;
  } else {
    root.innerHTML = `
      ${badgeHtml}
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