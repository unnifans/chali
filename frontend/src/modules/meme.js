import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase-config.js';

// Edit or replace this Malayalam loading message anytime:
export const DEFAULT_MALAYALAM_LOADING_MSG = 'ദേ ഇപ്പൊ ശരിയാക്കിത്തരാ.... 😁';
export const EVERY_5TH_JOKE_BREAK_MSG = 'ദേ ഇപ്പൊ ശരിയാക്കിത്തരാ.... 😁';
export const FIXED_INITIAL_LOADING_GIF_URL = 'https://res.cloudinary.com/ikrkjuoq/image/upload/v1785171591/malayalam_joke_app/loading_memes/xy0l8rsosbr5zygn0n7y.gif';

let loadingMemes = [];
let lastMemeId = null;

// Memes rarely change, so cache the list locally for 24h. This turns
// "M reads per page load" into "M reads per day per user" — an important
// saving at viral scale.
const MEME_CACHE_KEY = 'malayalamJokeApp_loadingMemes_v1';
const MEME_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

function readMemeCache() {
  try {
    const raw = localStorage.getItem(MEME_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.memes) || Date.now() - parsed.fetchedAt > MEME_CACHE_TTL) {
      return null;
    }
    return parsed.memes;
  } catch {
    return null;
  }
}

function writeMemeCache(memes) {
  try {
    localStorage.setItem(MEME_CACHE_KEY, JSON.stringify({ memes, fetchedAt: Date.now() }));
  } catch {
    // storage unavailable — cache is a nice-to-have
  }
}

/**
 * Fetches memes tagged with "loading" from Firestore, hitting the network at
 * most once per MEME_CACHE_TTL per user thanks to the localStorage cache.
 */
export async function fetchLoadingMemes() {
  const cached = readMemeCache();
  if (cached) {
    loadingMemes = cached;
    return loadingMemes;
  }
  try {
    const q = query(collection(db, 'memes'), where('tag', '==', 'loading'));
    const snap = await getDocs(q);
    loadingMemes = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    writeMemeCache(loadingMemes);
    console.log(`Loaded ${loadingMemes.length} memes from Firestore.`);
  } catch (err) {
    console.error('Error fetching loading memes from Firestore:', err);
    loadingMemes = [];
  }
  return loadingMemes;
}

/**
 * Returns a random meme from the loaded pool, avoiding immediate repetition if possible.
 */
export function getRandomLoadingMeme() {
  if (loadingMemes.length === 0) return null;
  if (loadingMemes.length === 1) return loadingMemes[0];

  const candidates = loadingMemes.filter((m) => m.id !== lastMemeId);
  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  lastMemeId = picked.id;
  return picked;
}

let preloadedMeme = null;
let preloadImageObj = null;

/**
 * Preloads the image of the next random meme in background memory so it renders instantly.
 */
export function preloadNextMeme() {
  const meme = getRandomLoadingMeme();
  if (!meme || !meme.url) return null;
  preloadedMeme = meme;
  const transformedUrl = toCloudinaryUrl(meme.url, 500);
  preloadImageObj = new Image();
  preloadImageObj.src = transformedUrl;
  return meme;
}

/**
 * Returns the preloaded meme (if ready) or picks a new one, then schedules preloading for the next break.
 */
export function getOrPreloadMeme() {
  let memeToUse = preloadedMeme;
  if (!memeToUse) {
    memeToUse = getRandomLoadingMeme();
  }
  preloadedMeme = null;
  preloadImageObj = null;
  // Preload the next meme in background
  setTimeout(preloadNextMeme, 100);
  return memeToUse;
}

/**
 * Renders a meme card into #joke-root.
 * @param {Object|null} meme - Cloudinary meme metadata object
 * @param {string} [malayalamMessage] - Message to display on the card
 * @param {string} [badgeText] - Badge label e.g., "LOADING..." or "CHALI BREAK"
 */
export function renderMemeCard(meme, malayalamMessage = '') {
  const root = document.getElementById('joke-root');
  if (!root) return;

  const imageSrc = meme && meme.url ? toCloudinaryUrl(meme.url, 500) : null;

  const imageHtml = imageSrc
    ? `<div class="joke-image-wrap meme-image-wrap">
         <img class="joke-image meme-image" loading="lazy" src="${imageSrc}" alt="loading meme" />
       </div>`
    : '';

  const textHtml = malayalamMessage
    ? `<p class="joke-text meme-loading-text">${escapeHtml(malayalamMessage)}</p>`
    : '';

  root.innerHTML = `
    ${imageHtml}
    ${textHtml}
  `;
  root.scrollTop = 0;
}

function toCloudinaryUrl(url, width) {
  if (!url || typeof url !== 'string') return '';
  if (url.includes('/upload/') && !url.includes('/upload/f_auto')) {
    return url.replace('/upload/', `/upload/f_auto,q_auto,w_${width}/`);
  }
  return url;
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
