import { doc, updateDoc, increment } from 'firebase/firestore';
import { db } from '../firebase-config.js';

const QUARANTINE_THRESHOLD = 3;

// Read-free vote writes: `increment()` applies a delta server-side WITHOUT a
// read in front of it, so each vote costs 1 write instead of 1 read + 1 write.
// The status field is intentionally left untouched by the client — the
// onVoteUpdate Cloud Function reconciles quarantine/active based on the true
// totals, so concurrent votes can never be rejected by the security rules.

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

// Returns { upvotes, downvotes, status } as seen optimistically by this client
// (based on the counts it last fetched), or null on failure.
export async function castVote(jokeId, actionType, directionDetails, options = {}) {
  const { currentUpvotes = 0, currentDownvotes = 0 } = options;
  const delta = voteDelta(actionType, directionDetails);

  const upvotes = currentUpvotes + delta.upvotes;
  const downvotes = currentDownvotes + delta.downvotes;
  const status = upvotes - downvotes < QUARANTINE_THRESHOLD ? 'quarantine' : 'active';

  try {
    await updateDoc(doc(db, 'jokes', jokeId), {
      upvotes: increment(delta.upvotes),
      downvotes: increment(delta.downvotes),
    });
    return { upvotes, downvotes, status };
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