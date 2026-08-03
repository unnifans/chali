/**
 * Card Swipe & Transition Animation Module
 * Supports touch and mouse dragging gestures with rotation physics & smooth entry/exit animations.
 */

let isDragging = false;
let isTouchDevice = false;
let startX = 0;
let startY = 0;
let currentDeltaX = 0;
let currentDeltaY = 0;
let cardEl = null;
let onSwipeNextCallback = null;
let onSwipePrevCallback = null;
let isAnimating = false;

const SWIPE_THRESHOLD = 90; // Pixels required to trigger a swipe

// More reliable platform detection
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const isTouchOnlyDevice = isMobile || (hasTouch && window.innerWidth < 1024);

export function initCardSwipe(cardElement, onSwipeNext, onSwipePrev) {
  cardEl = cardElement;
  onSwipeNextCallback = onSwipeNext;
  onSwipePrevCallback = onSwipePrev;

  if (!cardEl) return;

  // Prevent default image drag behaviors
  cardEl.addEventListener('dragstart', (e) => e.preventDefault());

  // Separate touch and mouse events for better control
  cardEl.addEventListener('touchstart', handleTouchStart, { passive: true });
  cardEl.addEventListener('touchmove', handleTouchMove, { passive: false });
  cardEl.addEventListener('touchend', handleTouchEnd, { passive: true });

  // Mouse events for desktop
  cardEl.addEventListener('mousedown', handleMouseDown);
  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', handleMouseUp);
}

function handleTouchStart(e) {
  if (e.target.closest('button, input, textarea, a, label')) return;
  if (isAnimating) return;

  const touch = e.touches[0];
  if (!touch) return;

  isDragging = true;
  isTouchDevice = true;
  startX = touch.clientX;
  startY = touch.clientY;
  currentDeltaX = 0;
  currentDeltaY = 0;

  cardEl.style.transition = 'none';
  cardEl.classList.add('swiping');
}

function handleTouchMove(e) {
  if (!isDragging || !isTouchDevice || !cardEl) return;
  e.preventDefault();

  const touch = e.touches[0];
  if (!touch) return;

  currentDeltaX = touch.clientX - startX;
  currentDeltaY = touch.clientY - startY;

  const rotateDeg = currentDeltaX * 0.06;
  const opacity = Math.max(0.6, 1 - Math.abs(currentDeltaX) / 500);

  cardEl.style.transform = `translate3d(${currentDeltaX}px, ${currentDeltaY * 0.2}px, 0) rotate(${rotateDeg}deg)`;
  cardEl.style.opacity = opacity.toString();
}

function handleTouchEnd() {
  if (!isDragging || !isTouchDevice || !cardEl) {
    isDragging = false;
    isTouchDevice = false;
    return;
  }

  isDragging = false;
  isTouchDevice = false;
  cardEl.classList.remove('swiping');

  if (Math.abs(currentDeltaX) > SWIPE_THRESHOLD) {
    // On mobile: Left swipe -> Next, Right swipe -> Previous
    if (currentDeltaX < 0) {
      flyOutAndTriggerNext(-1); // Left swipe -> Next
    } else {
      flyOutAndTriggerPrev(1);  // Right swipe -> Previous
    }
  } else {
    // Spring back to center smoothly
    cardEl.style.transition = 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.2s ease';
    cardEl.style.transform = 'translate3d(0, 0, 0) rotate(0deg)';
    cardEl.style.opacity = '1';
    currentDeltaX = 0;
    currentDeltaY = 0;
  }
}

function handleMouseDown(e) {
  // Skip if it's actually a touch event disguised as mouse
  if (e.pointerType === 'touch') return;
  if (e.target.closest('button, input, textarea, a, label')) return;
  if (isAnimating) return;

  isDragging = true;
  isTouchDevice = false;
  startX = e.clientX;
  startY = e.clientY;
  currentDeltaX = 0;
  currentDeltaY = 0;

  cardEl.style.transition = 'none';
  cardEl.classList.add('swiping');
}

function handleMouseMove(e) {
  if (!isDragging || isTouchDevice || !cardEl) return;

  currentDeltaX = e.clientX - startX;
  currentDeltaY = e.clientY - startY;

  const rotateDeg = currentDeltaX * 0.06;
  const opacity = Math.max(0.6, 1 - Math.abs(currentDeltaX) / 500);

  cardEl.style.transform = `translate3d(${currentDeltaX}px, ${currentDeltaY * 0.2}px, 0) rotate(${rotateDeg}deg)`;
  cardEl.style.opacity = opacity.toString();
}

function handleMouseUp() {
  if (!isDragging || isTouchDevice || !cardEl) {
    isDragging = false;
    return;
  }

  isDragging = false;
  cardEl.classList.remove('swiping');

  if (Math.abs(currentDeltaX) > SWIPE_THRESHOLD) {
    // Left swipe -> Next, Right swipe -> Previous (same convention as touch)
    if (currentDeltaX < 0) {
      flyOutAndTriggerNext(-1); // Left swipe -> Next
    } else {
      flyOutAndTriggerPrev(1);  // Right swipe -> Previous
    }
  } else {
    // Spring back to center smoothly
    cardEl.style.transition = 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.2s ease';
    cardEl.style.transform = 'translate3d(0, 0, 0) rotate(0deg)';
    cardEl.style.opacity = '1';
    currentDeltaX = 0;
    currentDeltaY = 0;
  }
}

/**
 * Shared fly-out/fly-in animation. direction: +1 flies right, -1 flies left.
 * callback fires once the old card is offscreen, before the new one animates in.
 */
function flyOutCard(direction, callback) {
  if (!cardEl || isAnimating) return;
  isAnimating = true;

  const flyX = direction * (window.innerWidth || 500);
  const rotate = direction * 25;
  const deltaY = currentDeltaY || 0;

  cardEl.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.2s ease-out';
  cardEl.style.transform = `translate3d(${flyX}px, ${deltaY}px, 0) rotate(${rotate}deg)`;
  cardEl.style.opacity = '0';

  setTimeout(() => {
    // Reset card transform position instantly offscreen/hidden
    cardEl.style.transition = 'none';
    cardEl.style.transform = 'translate3d(0, 15px, 0) scale(0.96)';
    currentDeltaX = 0;
    currentDeltaY = 0;

    if (typeof callback === 'function') {
      callback();
    }

    // Smoothly animate new card entry
    requestAnimationFrame(() => {
      cardEl.style.transition = 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.3s ease';
      cardEl.style.transform = 'translate3d(0, 0, 0) scale(1)';
      cardEl.style.opacity = '1';
      setTimeout(() => {
        isAnimating = false;
        cardEl.style.transform = 'translate3d(0, 0, 0) scale(1)';
      }, 300);
    });
  }, 220);
}

/**
 * Animates the card flying off and triggers the "next" callback.
 */
export function flyOutAndTriggerNext(direction = 1) {
  // Reset delta values before flying out
  currentDeltaX = 0;
  currentDeltaY = 0;
  flyOutCard(direction, onSwipeNextCallback);
}

/**
 * Animates the card flying off and triggers the "previous" callback.
 */
export function flyOutAndTriggerPrev(direction = -1) {
  // Reset delta values before flying out
  currentDeltaX = 0;
  currentDeltaY = 0;
  flyOutCard(direction, onSwipePrevCallback);
}

/**
 * Trigger a card entry animation without flyout (for initial state or reset).
 */
export function animateCardEntry() {
  if (!cardEl) return;
  cardEl.style.transition = 'none';
  cardEl.style.transform = 'translate3d(0, 15px, 0) scale(0.96)';
  cardEl.style.opacity = '0';

  requestAnimationFrame(() => {
    cardEl.style.transition = 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.3s ease';
    cardEl.style.transform = 'translate3d(0, 0, 0) scale(1)';
    cardEl.style.opacity = '1';
  });
}

/**
 * Triggers a subtle left-right nudge/wiggle to hint to users that the card is swipable.
 */
export function triggerSwipeHint(cardElement) {
  const target = cardElement || cardEl;
  if (!target) return;
  target.classList.remove('card-swipe-hint');
  void target.offsetWidth; // force reflow
  target.classList.add('card-swipe-hint');
  setTimeout(() => {
    target.classList.remove('card-swipe-hint');
  }, 1600);
}