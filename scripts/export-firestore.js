/**
 * Live Firestore -> D1 migration export.
 *
 * Reads the `jokes` and `memes` collections from Firestore (via the existing
 * scripts/service-account.json credentials) and writes:
 *
 *   - scripts/_d1_export/export.json      (full rows, for inspection)
 *   - scripts/_d1_export/insert_jokes.sql (INSERT OR IGNORE statements)
 *   - scripts/_d1_export/insert_memes.sql (INSERT OR IGNORE statements)
 *
 * Then apply with the Worker CLI from the `worker/` folder:
 *
 *   cd worker
 *   npx wrangler d1 execute chali-d1 --remote --file ../scripts/_d1_export/insert_jokes.sql
 *   npx wrangler d1 execute chali-d1 --remote --file ../scripts/_d1_export/insert_memes.sql
 *
 * The D1 schema keeps each Firestore document id as the PRIMARY KEY, so the
 * export is idempotent: re-running after fixes uses OR IGNORE and never
 * duplicates rows. `rand` is backfilled for every active joke so the public
 * random-walk works immediately.
 *
 * Setup: scripts/service-account.json already exists from seeding.
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const serviceAccountPath = path.join(__dirname, 'service-account.json');
const OUT_DIR = path.join(__dirname, '_d1_export');

if (!fs.existsSync(serviceAccountPath)) {
  console.error('Error: scripts/service-account.json not found!');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(serviceAccountPath)),
});

const db = admin.firestore();

// --- helpers ---------------------------------------------------------------

function toMillis(value, fallback = Date.now()) {
  if (!value) return fallback;
  if (value instanceof admin.firestore.Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value.toDate === 'function') {
    try { return value.toDate().getTime(); } catch { return fallback; }
  }
  return fallback;
}

function sqlStr(v) {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

function sqlInt(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function nl(v) {
  return v === null || v === undefined ? 'NULL' : sqlStr(v);
}

// --- collectors ------------------------------------------------------------

async function collectJokes() {
  const snap = await db.collection('jokes').get();
  const rows = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    const status = d.status && ['active', 'quarantine', 'deleted'].includes(d.status) ? d.status : 'quarantine';
    const rand = status === 'active' ? Math.random() : null;
    rows.push({
      id: doc.id,
      type: d.type === 'qna' ? 'qna' : 'single',
      question: d.question || '',
      answer: d.type === 'qna' ? (d.answer || null) : null,
      imageUrl: d.imageUrl || null,
      imagePublicId: d.imagePublicId || null,
      upvotes: sqlInt(d.upvotes),
      downvotes: sqlInt(d.downvotes),
      status,
      submittedBy: d.submittedBy || 'anonymous',
      rand,
      timestamp: toMillis(d.timestamp),
      createdAt: toMillis(d.createdAt, toMillis(d.timestamp)),
    });
  }
  return rows;
}

async function collectMemes() {
  const snap = await db.collection('memes').get();
  const rows = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    rows.push({
      id: doc.id,
      tag: d.tag || 'loading',
      url: d.url || '',
      publicId: d.publicId || null,
      originalFilename: d.originalFilename || null,
      format: d.format || null,
      resourceType: d.resourceType || null,
      createdAt: toMillis(d.createdAt),
    });
  }
  return rows;
}

function writeInsertSql(kind, rows, columns, params) {
  const lines = [];
  lines.push(`-- Exported ${rows.length} rows into ${kind}.`);
  for (const r of rows) {
    const values = params.map((p) => p(r)).join(', ');
    lines.push(`INSERT OR IGNORE INTO ${kind} (${columns.join(', ')}) VALUES (${values});`);
  }
  return lines.join('\n');
}

// --- main ------------------------------------------------------------------

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('Reading jokes from Firestore...');
  const jokes = await collectJokes();

  console.log('Reading memes from Firestore...');
  const memes = await collectMemes();

  const jokeColumns = [
    'id', 'type', 'question', 'answer', 'image_url', 'image_public_id',
    'upvotes', 'downvotes', 'status', 'submitted_by', 'rand', 'timestamp', 'created_at',
  ];
  const jokeParams = [
    (r) => sqlStr(r.id), (r) => sqlStr(r.type), (r) => sqlStr(r.question),
    (r) => nl(r.answer), (r) => nl(r.imageUrl), (r) => nl(r.imagePublicId),
    (r) => sqlInt(r.upvotes), (r) => sqlInt(r.downvotes), (r) => sqlStr(r.status),
    (r) => sqlStr(r.submittedBy), (r) => (r.rand === null ? 'NULL' : r.rand.toFixed(17)),
    (r) => sqlInt(r.timestamp), (r) => sqlInt(r.createdAt),
  ];

  const memeColumns = [
    'id', 'tag', 'url', 'public_id', 'original_filename', 'format', 'resource_type', 'created_at',
  ];
  const memeParams = [
    (r) => sqlStr(r.id), (r) => sqlStr(r.tag), (r) => sqlStr(r.url),
    (r) => nl(r.publicId), (r) => nl(r.originalFilename), (r) => nl(r.format),
    (r) => nl(r.resourceType), (r) => sqlInt(r.createdAt),
  ];

  fs.writeFileSync(path.join(OUT_DIR, 'export.json'), JSON.stringify({ jokes, memes }, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'insert_jokes.sql'), writeInsertSql('jokes', jokes, jokeColumns, jokeParams));
  fs.writeFileSync(path.join(OUT_DIR, 'insert_memes.sql'), writeInsertSql('memes', memes, memeColumns, memeParams));

  console.log(`\nExported ${jokes.length} jokes and ${memes.length} memes to ${OUT_DIR}/`);
  console.log('Apply with:');
  console.log('  cd worker');
  console.log('  npx wrangler d1 execute chali-d1 --remote --file ../scripts/_d1_export/insert_jokes.sql');
  console.log('  npx wrangler d1 execute chali-d1 --remote --file ../scripts/_d1_export/insert_memes.sql');
  process.exit(0);
}

main().catch((err) => {
  console.error('Export failed:', err);
  process.exit(1);
});