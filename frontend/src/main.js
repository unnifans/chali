import './firebase-config.js';
import {
  fetchRandomJoke, renderJoke, updateVoteScore, applyVoteResult, getCurrentJoke
} from './modules/joke.js';
import { castVote } from './modules/vote.js';
import { getVoteDirection } from './modules/voteCache.js';
import { initSubmitForm } from './modules/submitForm.js';
import {
  fetchLoadingMemes, renderMemeCard, getOrPreloadMeme, preloadNextMeme,
  DEFAULT_MALAYALAM_LOADING_MSG
} from './modules/meme.js';

const upBtn = document.getElementById('upvote-btn');
const downBtn = document.getElementById('downvote-btn');
const nextBtn = document.getElementById('next-btn');
const votePill = document.querySelector('.vote-pill');
const submitBtn = document.getElementById('show-submit-btn');

let jokesViewedCount = 0;
let isShowingMeme = false;
let autoNextTimeout = null;

function clearAutoNext() {
  if (autoNextTimeout) {
    clearTimeout(autoNextTimeout);
    autoNextTimeout = null;
  }
}

function hideCardControls() {
  if (votePill) votePill.classList.add('hidden');
  if (nextBtn) nextBtn.classList.add('hidden');
  if (submitBtn) submitBtn.classList.add('hidden');
}

function showCardControls() {
  if (votePill) votePill.classList.remove('hidden');
  if (nextBtn) nextBtn.classList.remove('hidden');
  if (submitBtn) submitBtn.classList.remove('hidden');
}

async function loadInitialState() {
  // 1. Hide buttons and show initial meme placeholder with Malayalam loading text
  hideCardControls();
  renderMemeCard(null, DEFAULT_MALAYALAM_LOADING_MSG);

  // 2. Fetch memes and initial joke in parallel
  const [memes, joke] = await Promise.all([
    fetchLoadingMemes(),
    fetchRandomJoke(),
  ]);

  // Preload the next meme in background for the first meme break
  preloadNextMeme();

  const meme = getOrPreloadMeme();
  if (meme) {
    renderMemeCard(meme, DEFAULT_MALAYALAM_LOADING_MSG);
  }

  // 3. Automatically transition to initial joke in 3 seconds
  if (joke) {
    autoNextTimeout = setTimeout(() => {
      showCardControls();
      isShowingMeme = false;
      renderJoke(joke);
      jokesViewedCount++;
      reflectVoteState(joke);
    }, 3000);
  } else if (!meme) {
    showCardControls();
    renderJoke(null);
  }
}

async function loadAndShowNextJoke() {
  clearAutoNext();
  showCardControls();
  isShowingMeme = false;
  const joke = await fetchRandomJoke();
  renderJoke(joke);
  if (joke) {
    jokesViewedCount++;
    // Preload next meme if we're approaching the next meme break (every 2 jokes)
    if (jokesViewedCount % 5 === 1) {
      preloadNextMeme();
    }
  }
  reflectVoteState(joke);
}

function showMemeBreak() {
  clearAutoNext();
  isShowingMeme = true;
  hideCardControls();
  const meme = getOrPreloadMeme();
  renderMemeCard(meme);

  // Automatically transition to next joke in 3 seconds
  autoNextTimeout = setTimeout(() => {
    loadAndShowNextJoke();
  }, 3000);
}

function disableVoteButtons() {
  upBtn.disabled = true;
  downBtn.disabled = true;
  upBtn.classList.remove('voted');
  downBtn.classList.remove('voted');
  updateVoteScore(null);
}

function reflectVoteState(joke) {
  if (!joke || isShowingMeme) {
    disableVoteButtons();
    return;
  }
  const existingVote = getVoteDirection(joke.id);
  upBtn.disabled = !!existingVote;
  downBtn.disabled = !!existingVote;
  upBtn.classList.toggle('voted', existingVote === 'up');
  downBtn.classList.toggle('voted', existingVote === 'down');
}

async function handleVote(direction) {
  if (isShowingMeme) return;
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
  clearAutoNext();
  if (isShowingMeme) {
    loadAndShowNextJoke();
  } else if (jokesViewedCount > 0 && jokesViewedCount % 3 === 0) {
    showMemeBreak();
  } else {
    loadAndShowNextJoke();
  }
});

initSubmitForm();
loadInitialState();

