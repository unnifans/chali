import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase-config.js';
import { hasVoted, markVoted } from './voteCache.js';

const QUARANTINE_THRESHOLD = 3;

// Returns { upvotes, downvotes, status } on success, or null on failure/dupe.
export async function castVote(jokeId, direction) {
  if (hasVoted(jokeId)) {
    showToast("You've already voted on this one!");
    return null;
  }

  const jokeRef = doc(db, 'jokes', jokeId);
  let result = null;

  try {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(jokeRef);
      if (!snap.exists()) throw new Error('Joke no longer exists');

      const data = snap.data();
      const newUpvotes = direction === 'up' ? data.upvotes + 1 : data.upvotes;
      const newDownvotes = direction === 'down' ? data.downvotes + 1 : data.downvotes;
      const newStatus =
        newUpvotes - newDownvotes < QUARANTINE_THRESHOLD ? 'quarantine' : 'active';

      transaction.update(jokeRef, {
        upvotes: newUpvotes,
        downvotes: newDownvotes,
        status: newStatus,
      });

      result = { upvotes: newUpvotes, downvotes: newDownvotes, status: newStatus };
    });

    markVoted(jokeId, direction); // only cache on confirmed success
    return result;
  } catch (err) {
    console.error('Vote failed:', err);
    showToast('Something went wrong. Try again.');
    return null;
  }
}

function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 2500);
}
