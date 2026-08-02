import './firebase-config.js';
import {
  fetchRandomJoke, renderJoke, updateVoteScore, applyVoteResult, getCurrentJoke
} from './modules/joke.js';
import { castVote, showToast } from './modules/vote.js';
import { hasVoted, markVoted, unmarkVoted, getVoteDirection } from './modules/voteCache.js';
import { initSubmitForm } from './modules/submitForm.js';
import {
  fetchLoadingMemes, renderMemeCard, getOrPreloadMeme, preloadNextMeme,
  DEFAULT_MALAYALAM_LOADING_MSG, FIXED_INITIAL_LOADING_GIF_URL
} from './modules/meme.js';
import { initCardSwipe, flyOutAndTriggerNext, flyOutAndTriggerPrev, triggerSwipeHint } from './modules/swipe.js';
import { triggerEmojiBurst } from './modules/particles.js';

const upBtn = document.getElementById('upvote-btn');
const downBtn = document.getElementById('downvote-btn');
const nextBtn = document.getElementById('next-btn');
const votePill = document.querySelector('.vote-pill');
const submitBtn = document.getElementById('show-submit-btn');
const jokeCard = document.querySelector('.joke-card');

// Add joke history for going back
let jokeHistory = [];
let currentHistoryIndex = -1;
const MAX_HISTORY = 50; // Limit history to prevent memory issues

function pushJokeToHistory(joke) {
  if (!joke) return;
  // If the user had gone back and is now moving forward again, drop the stale forward stack
  jokeHistory = jokeHistory.slice(0, currentHistoryIndex + 1);
  jokeHistory.push(joke);
  if (jokeHistory.length > MAX_HISTORY) {
    jokeHistory.shift();
  }
  currentHistoryIndex = jokeHistory.length - 1;
}

function showPreviousJoke() {
  clearAutoNext();

  if (jokeHistory.length === 0) return;

  if (isShowingMeme) {
    // We're on a meme break — "previous" just returns to the last real joke,
    // which is already sitting at currentHistoryIndex (memes aren't pushed to history).
    const joke = jokeHistory[currentHistoryIndex];
    showCardControls();
    isShowingMeme = false;
    renderJoke(joke);
    reflectVoteState(joke);
    return;
  }

  if (currentHistoryIndex <= 0) {
    showToast("That's the earliest joke");
    return;
  }

  currentHistoryIndex--;
  const joke = jokeHistory[currentHistoryIndex];
  showCardControls();
  isShowingMeme = false;
  renderJoke(joke);
  reflectVoteState(joke);
}

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
  if (submitBtn) submitBtn.classList.add('hidden');
    if (nextBtn) nextBtn.classList.add('hidden');
}

function showCardControls() {
  if (votePill) votePill.classList.remove('hidden');
  if (submitBtn) submitBtn.classList.remove('hidden');
    if (nextBtn) nextBtn.classList.remove('hidden');
}

async function loadInitialState() {
  // 1. Hide controls and immediately render fixed GIF + Malayalam loading text together on frame 1
  hideCardControls();
  renderMemeCard({ url: FIXED_INITIAL_LOADING_GIF_URL }, DEFAULT_MALAYALAM_LOADING_MSG);

  // 2. Fetch memes and initial joke in parallel
  const [memes, joke] = await Promise.all([
    fetchLoadingMemes(),
    fetchRandomJoke(),
  ]);

  // Preload next meme in background for upcoming meme break
  preloadNextMeme();

  // 3. Automatically transition to initial joke in 1.5 seconds
  if (joke) {
    autoNextTimeout = setTimeout(() => {
      showCardControls();
      isShowingMeme = false;
      renderJoke(joke);
      jokesViewedCount++;
      pushJokeToHistory(joke);
      reflectVoteState(joke);
      // Trigger card swipe hint wiggle to let users know cards are swipable!
      triggerSwipeHint(jokeCard);
    }, 1500);
  } else {
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
    pushJokeToHistory(joke);
    if (jokesViewedCount % 2 === 1) {
      preloadNextMeme();
    }
  }
  reflectVoteState(joke);
}

function triggerNextCard() {
  clearAutoNext();
  if (isShowingMeme) {
    loadAndShowNextJoke();
  } else if (jokesViewedCount > 0 && jokesViewedCount % 2 === 0) {
    showMemeBreak();
  } else {
    loadAndShowNextJoke();
  }
}

function showMemeBreak() {
  clearAutoNext();
  isShowingMeme = true;
  hideCardControls();
  const meme = getOrPreloadMeme();
  renderMemeCard(meme, '');

  // Automatically transition to next joke in 3 seconds
  autoNextTimeout = setTimeout(() => {
    triggerNextCard();
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
  // Keep both buttons ENABLED so users can change or toggle their vote!
  upBtn.disabled = false;
  downBtn.disabled = false;
  upBtn.classList.toggle('voted', existingVote === 'up');
  downBtn.classList.toggle('voted', existingVote === 'down');
}

/**
 * Optimistic Voting Handler:
 * Supports New vote, Undo vote, and Vote Switching with instant 0ms UI response & particle bursts.
 */
async function handleVote(clickedDirection) {
  if (isShowingMeme) return;
  const joke = getCurrentJoke();
  if (!joke) return;

  const existingVote = getVoteDirection(joke.id);
  let actionType = 'new';
  let directionDetails = {};

  if (existingVote === clickedDirection) {
    // User clicked the same button again -> UNDO VOTE
    actionType = 'undo';
    directionDetails = { previous: existingVote };
  } else if (existingVote && existingVote !== clickedDirection) {
    // User clicked the opposite button -> SWITCH VOTE
    actionType = 'switch';
    directionDetails = { previous: existingVote, target: clickedDirection };
  } else {
    // NEW VOTE
    actionType = 'new';
    directionDetails = { target: clickedDirection };
  }

  // Preserve previous state for rollback on error
  const oldUpvotes = joke.upvotes;
  const oldDownvotes = joke.downvotes;
  const oldStatus = joke.status;

  let optUpvotes = oldUpvotes;
  let optDownvotes = oldDownvotes;

  if (actionType === 'new') {
    if (clickedDirection === 'up') optUpvotes += 1;
    if (clickedDirection === 'down') optDownvotes += 1;
  } else if (actionType === 'undo') {
    if (existingVote === 'up') optUpvotes = Math.max(0, optUpvotes - 1);
    if (existingVote === 'down') optDownvotes = Math.max(0, optDownvotes - 1);
  } else if (actionType === 'switch') {
    if (clickedDirection === 'up') {
      optUpvotes += 1;
      optDownvotes = Math.max(0, optDownvotes - 1);
    } else {
      optDownvotes += 1;
      optUpvotes = Math.max(0, optUpvotes - 1);
    }
  }

  const optStatus = (optUpvotes - optDownvotes < 3) ? 'quarantine' : 'active';

  // 1. Instantly update local cache & UI state (0ms response)
  if (actionType === 'new' || actionType === 'switch') {
    markVoted(joke.id, clickedDirection);
    const btn = clickedDirection === 'up' ? upBtn : downBtn;
    triggerEmojiBurst(btn, clickedDirection === 'up' ? '🤣' : '😡');
  } else {
    unmarkVoted(joke.id);
  }

  applyVoteResult(joke.id, optUpvotes, optDownvotes, optStatus);
  const optJoke = getCurrentJoke();
  updateVoteScore(optJoke);
  reflectVoteState(optJoke);

  // 2. Commit transaction asynchronously in background
  const result = await castVote(joke.id, actionType, directionDetails);

  if (result) {
    // Sync with exact server state
    applyVoteResult(joke.id, result.upvotes, result.downvotes, result.status);
    const syncJoke = getCurrentJoke();
    updateVoteScore(syncJoke);
    reflectVoteState(syncJoke);
  } else {
    // Rollback on network failure
    if (existingVote) {
      markVoted(joke.id, existingVote);
    } else {
      unmarkVoted(joke.id);
    }
    applyVoteResult(joke.id, oldUpvotes, oldDownvotes, oldStatus);
    const rollbackJoke = getCurrentJoke();
    updateVoteScore(rollbackJoke);
    reflectVoteState(rollbackJoke);
    showToast("Couldn't save your vote. Please check connection.");
  }
}

upBtn.addEventListener('click', () => handleVote('up'));
downBtn.addEventListener('click', () => handleVote('down'));


// Button click triggers smooth fly-out card animation
nextBtn.addEventListener('click', () => {
  flyOutAndTriggerNext(1);
});

// Initialize card swipe gesture with fly-out animation
// Initialize card swipe gesture with fly-out animation
if (jokeCard) {
  initCardSwipe(
    jokeCard,
    () => triggerNextCard(),   // swipe right triggerNextCard
    () => showPreviousJoke()   // swipe left triggerNextCard
  );
}

initSubmitForm();
loadInitialState();

// Handle keyboard navigation (left and right arrow keys)
document.addEventListener('keydown', (event) => {
  const activeElement = document.activeElement;
  if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
    return;
  }

  if (event.key === 'ArrowRight') {
    event.preventDefault();
    flyOutAndTriggerNext(1);
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    flyOutAndTriggerPrev(-1);
  }
});

let scrollTimeout = null;
let isScrolling = false;

document.addEventListener('wheel', (event) => {
  const activeElement = document.activeElement;
  if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
    return;
  }

  // Only hijack the scroll when it happens over the joke card itself.
  // Anywhere else on the page should scroll normally.
  const target = event.target;
  if (!target || !target.closest('.joke-card')) {
    return;
  }
  if (target.closest('.submit-form') || target.closest('.modal')) {
    return;
  }
  if (event.deltaY === 0) return;

  event.preventDefault();

  if (scrollTimeout) {
    clearTimeout(scrollTimeout);
    scrollTimeout = null;
  }

  if (isScrolling) return;
  isScrolling = true;

  if (event.deltaY > 0) {
    flyOutAndTriggerNext(1);   // scroll down -> next
  } else {
    flyOutAndTriggerPrev(-1);  // scroll up -> previous
  }

  setTimeout(() => {
    isScrolling = false;
  }, 500);
}, { passive: false });

// Optional: Handle upward scroll to go to previous joke (if you maintain history)
// You can expand this later if you want
document.addEventListener('wheel', (event) => {
  if (event.deltaY < 0) {
    const activeElement = document.activeElement;
    if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
      return;
    }
    // For now, we'll just ignore upward scroll
    // You could implement a "previous joke" feature later
  }
}, { passive: false });

// Show keyboard hint briefly when user first loads the page
function showKeyboardHint() {
  const hint = document.createElement('div');
  hint.className = 'keyboard-hint';
  hint.textContent = '← → Arrow keys or Scroll to navigate jokes';
  document.body.appendChild(hint);
  
  // Show hint
  setTimeout(() => {
    hint.classList.add('show');
  }, 500);
  
  // Hide after 3 seconds
  setTimeout(() => {
    hint.classList.remove('show');
    setTimeout(() => {
      hint.remove();
    }, 300);
  }, 3500);
}

// Call this after initial joke loads
// Add inside your loadInitialState function after joke renders:
// showKeyboardHint();