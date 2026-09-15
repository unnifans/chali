import { api } from '../api.js';

const QUARANTINE_THRESHOLD = 3;

// Vote writes go through the Worker which applies atomic, read-free
// increments and reconciles quarantine/active status server-side (the logic
// that used to live in the onVoteUpdate Cloud Function).

function voteDelta(actionType, directionDetails) {
  const delta = { upvotes: 0, downvotes: 0 };
  if (actionType === 'new') {
    if (directionDetails.target === 'up') delta.upvotes = 1;
    else delta.downvotes = 1;
  } else if (actionType === 'undo') {
    if (directionDetails.previous === 'up') delta.upvotes = -1;
    else delta.downvotes = -1;
  } else if (actionType === 'switch') {
    if (directionDetails.target === 'up') {
      delta.upvotes = 1;
      delta.downvotes = -1;
    } else {
      delta.downvotes = 1;
      delta.upvotes = -1;
    }
  }
  return delta;
}

// Returns { upvotes, downvotes, status } from the server (authoritative), or
// null on failure.
export async function castVote(jokeId, actionType, directionDetails, options = {}) {
  const delta = voteDelta(actionType, directionDetails);

  try {
    const res = await api.castVote(jokeId, delta.upvotes, delta.downvotes);
    return {
      upvotes: res.upvotes,
      downvotes: res.downvotes,
      status: res.status,
    };
  } catch (err) {
    console.error('Vote update failed:', err);
    return null;
  }
}

export function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 2500);
}