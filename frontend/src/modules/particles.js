/**
 * Particle & Full-Screen Emoji Shower Helper
 * Triggers full screen emoji showers and mobile haptic vibration feedback.
 */

export function triggerEmojiBurst(targetElement, emojiSymbol = '🤣') {
  triggerFullEmojiShower(emojiSymbol);
}

export function triggerFullEmojiShower(emojiSymbol = '🤣') {
  // Mobile haptic vibration feedback if supported
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate([40, 30, 40]);
    } catch {
      // Ignore unsupported vibration permission restrictions
    }
  }

  const count = 28; // Number of floating screen emojis
  const screenWidth = window.innerWidth || document.documentElement.clientWidth;

  for (let i = 0; i < count; i++) {
    const particle = document.createElement('span');
    particle.className = 'full-screen-emoji';
    particle.textContent = emojiSymbol;

    // Distribute randomly across screen width
    const startX = Math.random() * screenWidth;
    const startY = (window.innerHeight || 800) + Math.random() * 60;
    const swayX = (Math.random() * 160 - 80);
    const rotation = (Math.random() * 60 - 30);
    const scale = (0.9 + Math.random() * 0.9).toFixed(2);
    const delay = (Math.random() * 0.3).toFixed(2);

    particle.style.left = `${startX}px`;
    particle.style.top = `${startY}px`;
    particle.style.setProperty('--sway-x', `${swayX}px`);
    particle.style.setProperty('--rot', `${rotation}deg`);
    particle.style.setProperty('--scale', scale);
    particle.style.animationDelay = `${delay}s`;

    document.body.appendChild(particle);

    setTimeout(() => {
      if (particle.parentNode) {
        particle.parentNode.removeChild(particle);
      }
    }, 1600);
  }
}
