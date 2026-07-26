const STORAGE_KEY = 'malayalamJokeApp_votes';

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

export function hasVoted(jokeId) {
  return !!readCache()[jokeId];
}

export function markVoted(jokeId, direction) {
  const cache = readCache();
  cache[jokeId] = direction; // 'up' | 'down'
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // storage full/unavailable - vote still succeeds server-side,
    // it just won't be remembered for dedupe on this browser
  }
}

export function getVoteDirection(jokeId) {
  return readCache()[jokeId] || null;
}
