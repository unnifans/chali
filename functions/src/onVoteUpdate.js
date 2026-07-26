const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { logger } = require('firebase-functions');
const { getFirestore } = require('firebase-admin/firestore');

const QUARANTINE_THRESHOLD = 3;

exports.onVoteUpdate = onDocumentUpdated('jokes/{jokeId}', async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  const jokeId = event.params.jokeId;

  const votesChanged =
    before.upvotes !== after.upvotes || before.downvotes !== after.downvotes;

  if (!votesChanged) {
    return null; // avoid re-triggering on our own status writes
  }

  if (after.status === 'deleted') {
    return null;
  }

  const netScore = (after.upvotes || 0) - (after.downvotes || 0);

  try {
    if (netScore < QUARANTINE_THRESHOLD && after.status !== 'quarantine') {
      await getFirestore().collection('jokes').doc(jokeId).update({
        status: 'quarantine',
      });
      logger.info(
        `Joke ${jokeId} quarantined. Net score: ${netScore} (up:${after.upvotes}, down:${after.downvotes})`
      );
    } else if (netScore >= QUARANTINE_THRESHOLD && after.status === 'quarantine') {
      // Auto-restore a joke that regained votes. Comment this block out if
      // you want quarantine exits to always require manual admin approval.
      await getFirestore().collection('jokes').doc(jokeId).update({
        status: 'active',
      });
      logger.info(`Joke ${jokeId} auto-restored to active. Net score: ${netScore}`);
    }
  } catch (err) {
    logger.error(`onVoteUpdate failed for joke ${jokeId}`, err);
    throw err;
  }

  return null;
});
