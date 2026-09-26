// Generates frontend/public/chalis.html — a static, no-JS "Best Malayalam
// Chali Jokes" page built from the top-rated *active* jokes in D1.
//
// Usage (requires wrangler auth, e.g. same OAuth you use for deploys):
//   node scripts/generate-seo-chalis.js
//
// Writes: frontend/public/chalis.html  (commit/redeploy it to ship)

const { execSync } = require('node:child_process');
const { writeFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');

const DB = 'chali-d1';
const LIMIT = 40;
const SITE = 'https://chali.in';
const OUT = path.join(__dirname, '..', 'frontend', 'public', 'chalis.html');

const SQL = `SELECT id, question, answer, image_url, upvotes, downvotes, (upvotes - downvotes) AS score, timestamp FROM jokes WHERE status = 'active' AND type = 'qna' AND question IS NOT NULL AND TRIM(question) <> '' ORDER BY score DESC, upvotes DESC LIMIT ${LIMIT}`;

function queryD1() {
  const cmd = `npx wrangler d1 execute ${DB} --remote --json --command "${SQL.trim().replace(/"/g, '\\"')}"`;
  const out = execSync(cmd, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    shell: true,
    timeout: 120000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Find the first valid JSON array in stdout (wrangler may print warnings).
  const start = out.indexOf('[');
  if (start === -1) throw new Error('No JSON array found in wrangler output:\n' + out.slice(0, 500));
  const parsed = JSON.parse(out.slice(start));
  const batch = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!batch || !batch.success) throw new Error('wrangler query failed: ' + JSON.stringify(batch));
  return batch.results || [];
}

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function render(jokes) {
  const items = jokes
    .map((j, i) => {
      const img = j.image_url
        ? `<img class="joke-img" src="${esc(j.image_url)}" alt="Malayalam chali joke illustration" loading="lazy" referrerpolicy="no-referrer" />`
        : '';
      return `
      <article class="joke">
        <span class="joke-num">${i + 1}</span>
        <div class="joke-body">
          <p class="joke-q">${esc(j.question)}</p>
          ${j.answer ? `<p class="joke-a">${esc(j.answer)}</p>` : ''}
          ${img}
          <p class="joke-score">♨ score ${j.score}</p>
        </div>
      </article>`;
    })
    .join('\n');

  const generated = new Date().toISOString().slice(0, 10);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="Best Malayalam chali jokes (ചളി തമാശകൾ) — read and vote the top-rated jokes from the Chali community." />
  <link rel="canonical" href="${SITE}/chalis.html" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${SITE}/chalis.html" />
  <meta property="og:site_name" content="Chali" />
  <meta property="og:locale" content="ml_IN" />
  <meta property="og:title" content="Best Malayalam Chali Jokes (ചളി തമാശകൾ)" />
  <meta property="og:description" content="The top-rated Malayalam chali jokes from the Chali community." />
  <meta property="og:image" content="${SITE}/og-1200x630.png" />
  <title>Best Malayalam Chali Jokes (ചളി തമാശകൾ)</title>
  <style>
    :root { --paper:#EDE1C2; --card:#F7F0DC; --ink:#221B12; --muted:#7C7057; --rust:#A32F22; --blue:#1F4E79; --border:#C9B583; }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; background:var(--paper); color:var(--ink); font-family:'Noto Sans Malayalam','Manjari',system-ui,sans-serif; padding:32px 16px 64px; }
    .wrap { max-width:680px; margin:0 auto; }
    h1 { font-size:1.9rem; line-height:1.35; margin:0 0 6px; font-family:'Baloo Chettan 2','Noto Sans Malayalam',sans-serif; }
    .intro { color:var(--muted); line-height:1.7; margin:0 0 8px; font-size:1.05rem; }
    .meta { font-size:.85rem; color:var(--muted); margin-bottom:28px; }
    .joke { display:flex; gap:16px; background:var(--card); border:2px solid var(--border); border-radius:12px; padding:18px 20px; margin-bottom:16px; box-shadow:3px 3px 0 var(--border); }
    .joke-num { font-family:'Special Elite',monospace; font-size:1.4rem; color:var(--rust); line-height:1.2; flex-shrink:0; }
    .joke-body { flex:1; min-width:0; }
    .joke-q { font-size:1.15rem; line-height:1.6; margin:0 0 8px; white-space:pre-wrap; }
    .joke-a { background:#EADFC2; border-left:4px solid var(--blue); padding:10px 12px; border-radius:8px; margin:0 0 8px; line-height:1.6; white-space:pre-wrap; }
    .joke-img { max-width:220px; max-height:180px; object-fit:cover; border-radius:8px; margin-top:4px; }
    .joke-score { font-size:.8rem; color:var(--muted); margin:6px 0 0; }
    .cta { display:block; text-align:center; background:var(--rust); color:#fff; text-decoration:none; font-size:1.05rem; padding:14px; border-radius:12px; margin-top:28px; font-family:'Baloo Chettan 2','Noto Sans Malayalam',sans-serif; }
    .home { text-align:center; margin-top:16px; color:var(--muted); font-size:.9rem; }
    .home a { color:var(--blue); }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Best Malayalam Chali Jokes (ചളി തമാശകൾ)</h1>
    <p class="intro">ഈ പേജിൽ നമ്മുടെ ചളി കമ്മ്യൂണിറ്റി ഏറ്റവും ഇഷ്ടപ്പെട്ട തമാശകൾ — the top-rated jokes, as voted by readers. Pick your favourite, and if you have a better one, submit it on Chali!</p>
    <p class="meta">Updated: ${generated} · ${jokes.length} jokes shown</p>

    ${items}

    <a class="cta" href="${SITE}/">Join Chali → vote &amp; submit your own joke</a>
    <p class="home"><a href="${SITE}/">chali.in</a> — The Malayalam Joke App</p>
  </div>
</body>
</html>
`;
}

function main() {
  const jokes = queryD1();
  if (!jokes.length) {
    console.error('No active jokes found in D1 — nothing to render.');
    process.exit(1);
  }
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, render(jokes), 'utf8');
  console.log(`Wrote ${OUT} (${jokes.length} jokes)`);
}

main();