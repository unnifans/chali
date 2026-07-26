import './firebase-config.js';
import {
  fetchRandomJoke, renderJoke, updateVoteScore, applyVoteResult, getCurrentJoke
} from './modules/joke.js';
import { castVote } from './modules/vote.js';
import { getVoteDirection } from './modules/voteCache.js';
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

async function handleVote(direction) {
  const joke = getCurrentJoke();
  if (!joke) return;
  const result = await castVote(joke.id, direction);
  if (result) {
    applyVoteResult(joke.id, result.upvotes, result.downvotes, result.status);
    const updatedJoke = getCurrentJoke();
    updateVoteScore(updatedJoke);
    reflectVoteState(updatedJoke);
  }
}

upBtn.addEventListener('click', () => handleVote('up'));
downBtn.addEventListener('click', () => handleVote('down'));

nextBtn.addEventListener('click', () => {
  loadAndShowJoke();
});

initSubmitForm();
loadAndShowJoke();
