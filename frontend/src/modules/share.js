import { getCurrentJoke } from './joke.js';
import { showToast } from './vote.js';

// One-tap sharing for the currently displayed joke.
//
// Canonical share links look like https://chali.in/j/<id> and always open
// that exact joke (see parseSharedJokeId / main.js boot handling).
// Image cards (for Instagram Stories etc.) are rendered locally on a
// <canvas> — no server round-trip — then handed to the OS share sheet when
// file sharing is supported, otherwise downloaded for manual upload.

function siteBase() {
  try {
    if (typeof location !== 'undefined' && /\.chali\.in$/.test(location.hostname)) {
      return location.origin;
    }
  } catch { /* fall through to canonical */ }
  return 'https://chali.in';
}

// Links shared to messaging apps go through the Worker's share page
// (SHARE_BASE/j/<id>), which serves per-joke og:* tags so pasted links
// unfurl with the actual joke — like an Amazon product link. Humans are
// bounced straight into the app. s.chali.in is a custom domain on the
// chali-api worker (dashboard → Domains & Routes).
const SHARE_BASE = 'https://s.chali.in';

export function jokeShareUrl(joke) {
  return `${siteBase()}/j/${encodeURIComponent(joke.id)}`;
}

export function jokeSharePageUrl(joke) {
  return `${SHARE_BASE}/j/${encodeURIComponent(joke.id)}`;
}

// Accept /j/<id> paths (preferred, canonical) and ?j=<id> fallbacks.
export function parseSharedJokeId() {
  try {
    const m = location.pathname.match(/^\/j\/([\w-]+)\/?$/);
    if (m) return m[1];
    const params = new URLSearchParams(location.search);
    const q = params.get('j') || params.get('joke');
    return q && /^[\w-]+$/.test(q) ? q : null;
  } catch {
    return null;
  }
}

// Keep the address bar pointing at the joke on screen so "copy link from
// the URL bar" just works. replaceState adds no history entries.
export function updateShareUrl(joke) {
  if (!joke || !joke.id) return;
  try {
    history.replaceState(null, '', `/j/${encodeURIComponent(joke.id)}`);
  } catch { /* file:// or sandboxed contexts */ }
}

function shareText(joke) {
  // The answer is never shared — it only reveals on the website.
  const teaser = joke.type === 'qna' && joke.answer
    ? '\n\n🤔 Answer hidden — tap the link to reveal 👇'
    : '';
  return `${joke.question}${teaser}`;
}

function openExternal(url) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      const ok = document.execCommand('copy');
      ta.remove();
      ok ? resolve() : reject(new Error('copy failed'));
    } catch (err) {
      ta.remove();
      reject(err);
    }
  });
}

function handleShareAction(kind, joke) {
  // Shared links use the preview page so pasted URLs unfurl with the joke.
  const url = jokeSharePageUrl(joke);
  const text = shareText(joke);
  const enc = encodeURIComponent;

  switch (kind) {
    case 'whatsapp':
      openExternal(`https://wa.me/?text=${enc(`${text}\n\n😂 — ${url}`)}`);
      break;
    case 'instagram':
      // No web intent API exists for Instagram: render the story card and
      // hand the PNG to the OS sheet — the user picks Instagram → Story.
      shareImageCard(joke, true);
      break;
    case 'x':
      openExternal(`https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}`);
      break;
    case 'facebook':
      openExternal(`https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`);
      break;
    case 'copy':
      copyText(url)
        .then(() => showToast('Link copied — paste it anywhere for a rich preview!'))
        .catch(() => showToast("Couldn't copy — long-press the URL bar instead."));
      break;
    case 'native':
      if (navigator.share) {
        navigator.share({ title: 'Chali joke', text, url }).catch(() => {});
      }
      break;
    default:
      break;
  }
}

// ---------- Story-card image (canvas) ----------

function wrapLines(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const trial = line ? `${line} ${word}` : word;
    if (ctx.measureText(trial).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = trial;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function ensureCardFonts() {
  try {
    await Promise.allSettled([
      document.fonts.load('800 100px "Baloo Chettan 2"'),
      document.fonts.load('700 64px "Manjari"'),
      document.fonts.load('400 40px "Special Elite"'),
      document.fonts.load('700 56px "Noto Sans Malayalam"'),
    ]);
    await document.fonts.ready;
  } catch { /* fall back to system fonts */ }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Best-effort load of the joke's own photo for the card. Needs the image
// host to allow cross-origin reads; on failure we resolve null and render
// a text-only card.
function loadCardImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawCover(ctx, img, x, y, w, h, r) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

async function renderShareCard(joke) {
  await ensureCardFonts();

  const W = 1080;
  const H = 1350;
  const M = 84; // margin
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // paper background + double frame
  ctx.fillStyle = '#EDE1C2';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#221B12';
  ctx.lineWidth = 6;
  ctx.strokeRect(28, 28, W - 56, H - 56);
  ctx.strokeStyle = '#C9B583';
  ctx.lineWidth = 2;
  ctx.strokeRect(48, 48, W - 96, H - 96);

  let y = 170;

  // brand header
  ctx.fillStyle = '#A32F22';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '800 130px "Baloo Chettan 2", "Noto Sans Malayalam", sans-serif';
  ctx.fillText('ചളി', W / 2, y);
  y += 66;
  ctx.fillStyle = '#7C7057';
  ctx.font = '400 38px "Special Elite", monospace';
  ctx.fillText('T H E   M A L A Y A L A M   J O K E   A P P', W / 2, y);
  y += 60;

  // divider
  ctx.strokeStyle = '#C9B583';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(M + 60, y);
  ctx.lineTo(W - M - 60, y);
  ctx.stroke();
  y += 90;

  // the joke's own photo, neat and cropped, when the joke has one
  const photo = await loadCardImage(joke.imageUrl);
  if (photo) {
    const ph = 400;
    ctx.strokeStyle = '#221B12';
    ctx.lineWidth = 4;
    drawCover(ctx, photo, M, y, W - M * 2, ph, 22);
    roundRect(ctx, M, y, W - M * 2, ph, 22);
    ctx.stroke();
    y += ph + 44;
  }

  // question (shrink-to-fit, then cap so extra-long jokes can't overflow)
  ctx.fillStyle = '#221B12';
  let qSize = 72;
  let qLines = [];
  while (qSize >= 40) {
    ctx.font = `700 ${qSize}px "Manjari", "Noto Sans Malayalam", sans-serif`;
    qLines = wrapLines(ctx, joke.question, W - M * 2);
    if (qLines.length * qSize * 1.45 <= 560) break;
    qSize -= 6;
  }
  if (qLines.length > 10) {
    qLines = qLines.slice(0, 10);
    qLines[9] += '…';
  }
  const lineH = qSize * 1.45;
  for (const line of qLines) {
    ctx.fillText(line, W / 2, y);
    y += lineH;
  }
  y += 30;

  // The answer is never printed on the card — a teaser box instead.
  // The reveal only happens on the website.
  if (joke.type === 'qna' && joke.answer) {
    ctx.font = '700 54px "Manjari", "Noto Sans Malayalam", sans-serif';
    let aLines = wrapLines(ctx, '🤔 Answer hidden — tap the link to reveal 👇', W - M * 2 - 120);
    if (aLines.length > 8) {
      aLines = aLines.slice(0, 8);
      aLines[7] += '…';
    }
    const boxH = aLines.length * 54 * 1.45 + 64;
    const boxY = y;
    ctx.fillStyle = '#E7D9B4';
    roundRect(ctx, M, boxY, W - M * 2, boxH, 26);
    ctx.fill();
    ctx.fillStyle = '#1F4E79';
    ctx.fillRect(M, boxY, 12, boxH);
    ctx.fillStyle = '#7C7057';
    let ay = boxY + 54 * 1.45;
    for (const line of aLines) {
      ctx.fillText(line, W / 2, ay);
      ay += 54 * 1.45;
    }
    y = boxY + boxH + 30;
  }

  // footer link
  ctx.fillStyle = '#1F4E79';
  ctx.font = '400 40px "Special Elite", monospace';
  ctx.fillText(`chali.in/j/${joke.id}`, W / 2, H - 120);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('render failed'))), 'image/png');
  });
}

async function shareImageCard(joke, forInstagram) {
  showToast(forInstagram ? 'Making your card — pick Instagram → Story 📸' : 'Making your story card…');
  try {
    const blob = await renderShareCard(joke);
    const file = new File([blob], `chali-${joke.id}.png`, { type: 'image/png' });
    // On Android Chrome this opens the OS sheet: pick Instagram → Story.
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Chali joke' });
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chali-${joke.id}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    showToast('Image saved — post it to your Story 📸');
  } catch (err) {
    console.error('Share card failed:', err);
    showToast("Couldn't make the image. Copy the link instead?");
  }
}

// ---------- Sheet wiring ----------

export function initShare() {
  const openBtn = document.getElementById('share-btn');
  const sheet = document.getElementById('share-sheet');
  if (!openBtn || !sheet) return;

  const backdrop = document.getElementById('share-backdrop');
  const closeBtn = document.getElementById('share-close');
  const nativeBtn = document.getElementById('share-native-btn');

  if (nativeBtn && navigator.share) nativeBtn.classList.remove('hidden');

  const open = () => {
    if (!getCurrentJoke()) return;
    sheet.classList.remove('hidden');
    // the fixed GitHub tab would float above the sheet — hide it meanwhile
    document.body.classList.add('sharing-open');
  };
  const close = () => {
    sheet.classList.add('hidden');
    document.body.classList.remove('sharing-open');
  };

  openBtn.addEventListener('click', open);
  if (backdrop) backdrop.addEventListener('click', close);
  if (closeBtn) closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheet.classList.contains('hidden')) close();
  });

  sheet.querySelectorAll('[data-share]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const joke = getCurrentJoke();
      if (!joke) return;
      close();
      handleShareAction(btn.dataset.share, joke);
    });
  });
}
