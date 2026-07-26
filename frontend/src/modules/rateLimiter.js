const COOLDOWN_MS = 1000;
let lastFetchTime = 0;
let cooldownInterval = null;

export function canFetch() {
  return Date.now() - lastFetchTime >= COOLDOWN_MS;
}

export function startCooldown(onComplete) {
  lastFetchTime = Date.now();
  clearInterval(cooldownInterval);

  const nextBtn = document.getElementById('next-btn');
  nextBtn.disabled = true;
  nextBtn.classList.add('cooling');

  cooldownInterval = setInterval(() => {
    const remaining = COOLDOWN_MS - (Date.now() - lastFetchTime);
    if (remaining <= 0) {
      clearInterval(cooldownInterval);
      nextBtn.disabled = false;
      nextBtn.classList.remove('cooling');
      nextBtn.textContent = 'Next Joke';
      onComplete?.();
    } else {
      nextBtn.textContent = `Wait ${Math.ceil(remaining / 1000)}s...`;
    }
  }, 100);
}
