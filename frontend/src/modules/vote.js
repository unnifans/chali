import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase-config.js';
import { hasVoted, markVoted } from './voteCache.js';

const QUARANTINE_THRESHOLD = 3;

// Returns { upvotes, downvotes, status } on success, or null on failure.
export async function castVote(jokeId, actionType, directionDetails, options = {}) {
  const jokeRef = doc(db, 'jokes', jokeId);
  let result = null;

  try {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(jokeRef);
      if (!snap.exists()) throw new Error('Joke no longer exists');

      const data = snap.data();
      let newUpvotes = data.upvotes;
      let newDownvotes = data.downvotes;

      if (actionType === 'new') {
        if (directionDetails.target === 'up') newUpvotes += 1;
        if (directionDetails.target === 'down') newDownvotes += 1;
      } else if (actionType === 'undo') {
        if (directionDetails.previous === 'up') newUpvotes = Math.max(0, newUpvotes - 1);
        if (directionDetails.previous === 'down') newDownvotes = Math.max(0, newDownvotes - 1);
      } else if (actionType === 'switch') {
        if (directionDetails.target === 'up') {
          newUpvotes += 1;
          newDownvotes = Math.max(0, newDownvotes - 1);
        } else if (directionDetails.target === 'down') {
          newDownvotes += 1;
          newUpvotes = Math.max(0, newUpvotes - 1);
        }
      }

      const newStatus =
        newUpvotes - newDownvotes < QUARANTINE_THRESHOLD ? 'quarantine' : 'active';

      transaction.update(jokeRef, {
        upvotes: newUpvotes,
        downvotes: newDownvotes,
        status: newStatus,
      });

      result = { upvotes: newUpvotes, downvotes: newDownvotes, status: newStatus };
    });

    return result;
  } catch (err) {
    console.error('Vote transaction failed:', err);
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
