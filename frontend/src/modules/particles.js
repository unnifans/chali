/**
 * Particle Emoji Burst Helper
 * Creates floating emoji particle bursts on button clicks for fun visual feedback.
 */

export function triggerEmojiBurst(targetElement, emojiSymbol = '🔥') {
  if (!targetElement) return;

  const rect = targetElement.getBoundingClientRect();
  const count = 4; // Number of floating particles

  for (let i = 0; i < count; i++) {
    const particle = document.createElement('span');
    particle.className = 'emoji-particle';
    particle.textContent = emojiSymbol;

    // Center starting coordinates around button
    const startX = rect.left + rect.width / 2 + (Math.random() * 24 - 12);
    const startY = rect.top + rect.height / 2 - 10;
    const driftX = (Math.random() * 50 - 25); // Random left/right drift
    const driftY = -(40 + Math.random() * 30); // Upward float

    particle.style.left = `${startX}px`;
    particle.style.top = `${startY}px`;
    particle.style.setProperty('--drift-x', `${driftX}px`);
    particle.style.setProperty('--drift-y', `${driftY}px`);
    particle.style.setProperty('--random-scale', (0.8 + Math.random() * 0.5).toString());

    document.body.appendChild(particle);

    // Clean up DOM after animation completes
    setTimeout(() => {
      if (particle.parentNode) {
        particle.parentNode.removeChild(particle);
      }
    }, 700);
  }
}
