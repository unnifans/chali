import './firebase-config.js';
import { fetchRandomJoke, renderJoke, getCurrentJoke } from './modules/joke.js';
import { castVote } from './modules/vote.js';
import { getVoteDirection } from './modules/voteCache.js';
import { canFetch, startCooldown } from './modules/rateLimiter.js';
import { initSubmitForm } from './modules/submitForm.js';

const upBtn = document.getElementById('upvote-btn');
const downBtn = document.getElementById('downvote-btn');
const nextBtn = document.getElementById('next-btn');

async function loadAndShowJoke() {
  const joke = await fetchRandomJoke();
  renderJoke(joke);
  reflectVoteState(joke);
}

function reflectVoteState(joke) {
  if (!joke) {
    upBtn.disabled = true;
    downBtn.disabled = true;
    return;
  }
  const existingVote = getVoteDirection(joke.id);
  upBtn.disabled = !!existingVote;
  downBtn.disabled = !!existingVote;
  upBtn.classList.toggle('voted', existingVote === 'up');
  downBtn.classList.toggle('voted', existingVote === 'down');
}

upBtn.addEventListener('click', async () => {
  const joke = getCurrentJoke();
  if (!joke) return;
  const ok = await castVote(joke.id, 'up');
  if (ok) reflectVoteState(joke);
});

downBtn.addEventListener('click', async () => {
  const joke = getCurrentJoke();
  if (!joke) return;
  const ok = await castVote(joke.id, 'down');
  if (ok) reflectVoteState(joke);
});

nextBtn.addEventListener('click', async () => {
  if (!canFetch()) return;
  await loadAndShowJoke();
  startCooldown();
});

initSubmitForm();
loadAndShowJoke();
