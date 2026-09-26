import { verifyIdToken, isAdminPayload, HttpError } from './auth.js';

// ---------------------------------------------------------------------------
// Chali API — replaces Firestore reads/writes. Public endpoints serve one row
// per request (cheap on D1); admin endpoints require a verified Firebase ID
// token. Vote statuses were previously reconciled by the onVoteUpdate Cloud
// Function — that logic now lives inline in the vote handler.
// ---------------------------------------------------------------------------

const QUARANTINE_THRESHOLD = 3;
const ORIGINAL_START_SCORE = 5; // public seeds matched the Firestore rule (up=5, down=0)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      let res;
      if (path === '/api/jokes/next' && request.method === 'GET') {
        res = await handleNextJoke(url, env);
      } else if (path === '/api/memes' && request.method === 'GET') {
        res = await handleMemes(url, env);
      } else if (path === '/api/votes' && request.method === 'POST') {
        res = await handleVote(request, env);
      } else if (path === '/api/submit' && request.method === 'POST') {
        res = await handleSubmit(request, env);
      } else if (path === '/api/uploads/presign' && request.method === 'POST') {
        res = await handlePresign(request, env);
      } else if (path === '/api/admin/jokes' && request.method === 'GET') {
        res = await requireAdmin(request, env).then((p) => handleListJokes(url, env));
      } else if (path === '/api/admin/jokes' && request.method === 'POST') {
        res = await requireAdmin(request, env).then((p) => handleCreateJoke(request, env));
      } else if (/^\/api\/admin\/jokes\/[^/]+\/status$/.test(path) && request.method === 'POST') {
        res = await requireAdmin(request, env).then(() => handleSetStatus(request, path, env));
      } else if (/^\/api\/admin\/jokes\/[^/]+$/.test(path) && request.method === 'PUT') {
        res = await requireAdmin(request, env).then((p) =>
          handleUpdateJoke(request, path, env));
      } else if (path === '/api/admin/stats' && request.method === 'GET') {
        res = await requireAdmin(request, env).then((p) => handleStats(env));
      } else {
        return json({ error: 'Not found' }, 404);
      }

      return withCors(res);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error('API error:', err);
      return withCors(json({ error: err.message || 'Internal error' }, status));
    }
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function withCors(res) {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch (err) {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

function str(v, max = 1000) {
  if (typeof v !== 'string' || v.length === 0) return null;
  return v.length <= max ? v : v.slice(0, max);
}

async function requireAdmin(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Missing admin token');

  const payload = await verifyIdToken(token, env);
  if (!isAdminPayload(payload, env)) {
    throw new HttpError(403, 'This account is not an admin');
  }
  return payload;
}

function isCloudinaryUrl(url) {
  return typeof url === 'string' && url.includes('res.cloudinary.com');
}

// Cloudinary is decommissioned (account disabled). Any image URL pointing at it
// must be treated as "no image" — never served, never stored.
function sanitizeImageUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('https://')) return null;
  if (isCloudinaryUrl(url)) return null;
  return url;
}

function mapJokeRow(r) {
  return {
    id: r.id,
    type: r.type,
    question: r.question,
    answer: r.answer,
    imageUrl: sanitizeImageUrl(r.image_url),
    imagePublicId: r.image_public_id,
    upvotes: r.upvotes,
    downvotes: r.downvotes,
    status: r.status,
    submittedBy: r.submitted_by,
    rand: r.rand,
    timestamp: r.timestamp,
    createdAt: r.created_at,
  };
}

function mapMemeRow(r) {
  return {
    id: r.id,
    tag: r.tag,
    url: r.url,
    publicId: r.public_id,
    originalFilename: r.original_filename,
    format: r.format,
    resourceType: r.resource_type,
    createdAt: r.created_at,
  };
}

// ---------------------------------------------------------------------------
// Public endpoints
// ---------------------------------------------------------------------------

// Serve a RANDOM active joke per request while reading only a handful of rows.
//
// Draw: pick a random seq in [MIN(seq), MAX(seq)] of active jokes and seek
// that exact seq through the (status, seq) index (~1-2 rows read). A miss only
// happens when the sampled slot holds a deleted/quarantined joke, so we re-roll
// (tiny index seeks). The forward seek from a random point is the guaranteed
// fallback, because MAX(seq) is itself active. Every active joke has equal
// probability, and there is no shared ordering for devices to converge on.
//
// This replaces ORDER BY RANDOM(), which scanned the entire active pool
// (~2.7k rows) per request and exhausted the D1 free-plan daily rows-read quota.
async function handleNextJoke(url, env) {
  const { lo, hi } = await env.DB.prepare(
    `SELECT
       (SELECT MIN(seq) FROM jokes WHERE status = 'active') AS lo,
       (SELECT MAX(seq) FROM jokes WHERE status = 'active') AS hi`
  ).first();

  if (lo == null) return json({ joke: null });

  const range = hi - lo + 1;
  const pick = () => lo + Math.floor(Math.random() * range);

  for (let attempt = 0; attempt < 10; attempt++) {
    const row = await env.DB.prepare(
      `SELECT * FROM jokes
         WHERE status = 'active' AND seq = ?
         LIMIT 1`
    ).bind(pick()).first();
    if (row) return json({ joke: mapJokeRow(row) });
  }

  const row = await env.DB.prepare(
    `SELECT * FROM jokes
       WHERE status = 'active' AND seq >= ?
       ORDER BY seq ASC
       LIMIT 1`
  ).bind(pick()).first();

  return json({ joke: row ? mapJokeRow(row) : null });
}

async function handleMemes(url, env) {
  const tag = url.searchParams.get('tag');
  if (tag) {
    const rows = await env.DB.prepare(
      `SELECT * FROM memes WHERE tag = ? ORDER BY created_at DESC`
    ).bind(tag).all();
    return json({ memes: rows.results.map(mapMemeRow) });
  }
  const rows = await env.DB.prepare(`SELECT * FROM memes ORDER BY created_at DESC`).all();
  return json({ memes: rows.results.map(mapMemeRow) });
}

// Vote = atomic read-free increment, then status reconciliation (the logic that
// used to live in the onVoteUpdate Cloud Function).
async function handleVote(request, env) {
  const body = await readJson(request);
  const { jokeId, upvoteDelta, downvoteDelta } = body || {};

  if (typeof jokeId !== 'string' || !jokeId) throw new HttpError(400, 'jokeId is required');
  const du = Number.isInteger(upvoteDelta) ? upvoteDelta : NaN;
  const dd = Number.isInteger(downvoteDelta) ? downvoteDelta : NaN;
  if (!Number.isFinite(du) || !Number.isFinite(dd)) throw new HttpError(400, 'Invalid vote deltas');
  if (du < -1 || du > 1 || dd < -1 || dd > 1 || (du === 0 && dd === 0)) {
    throw new HttpError(400, 'Vote deltas must be -1/0/+1 and non-zero');
  }

  const res = await env.DB.prepare(
    `UPDATE jokes
        SET upvotes   = MAX(0, upvotes + ?),
            downvotes = MAX(0, downvotes + ?)
      WHERE id = ? AND status = 'active'
      RETURNING id, upvotes, downvotes, status`
  ).bind(du, dd, jokeId).first();

  if (!res) throw new HttpError(404, 'Joke not available for voting');

  const net = res.upvotes - res.downvotes;
  const reconciled = net < QUARANTINE_THRESHOLD ? 'quarantine' : 'active';

  if (reconciled !== res.status) {
    await env.DB.prepare(
      `UPDATE jokes SET status = ? WHERE id = ?`
    ).bind(reconciled, res.id).run();
  }

  return json({
    upvotes: res.upvotes,
    downvotes: res.downvotes,
    status: reconciled,
  });
}

// Public submission — same rules as the old Firestore create rule.
async function handleSubmit(request, env) {
  const body = await readJson(request);
  const { type, question, answer, imageUrl, imagePublicId } = body || {};

  if (!['single', 'qna'].includes(type)) throw new HttpError(400, 'Invalid type');
  const q = str(question, 1000);
  if (!q) throw new HttpError(400, 'Joke text is required');
  if (type === 'qna') {
    if (typeof answer !== 'string' || answer.trim().length === 0) {
      throw new HttpError(400, 'Answer is required for QnA jokes');
    }
  }
  const a = type === 'qna' ? str(answer, 1000) : null;

  let img = null;
  if (imageUrl !== null && imageUrl !== undefined) {
    if (typeof imageUrl !== 'string' || !imageUrl.startsWith('https://')) {
      throw new HttpError(400, 'imageUrl must be an https URL or null');
    }
    img = sanitizeImageUrl(imageUrl);
  }
  const pid = typeof imagePublicId === 'string' || imagePublicId === null ? imagePublicId : null;

  const id = crypto.randomUUID();
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO jokes
       (id, type, question, answer, image_url, image_public_id,
        upvotes, downvotes, status, submitted_by, rand, seq, timestamp, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'quarantine', 'anonymous', NULL,
             (SELECT COALESCE(MAX(seq), 0) + 1 FROM jokes), ?, ?)`
  ).bind(id, type, q, a, img, pid, ORIGINAL_START_SCORE, 0, now, now).run();

  return json({ id }, 201);
}

// ---------------------------------------------------------------------------
// R2 image uploads (presigned PUT)
//
// The client POSTs { filename, contentType, size } and receives a 5-minute
// SigV4-presigned PUT URL for a fresh `jokes/<uuid>.<ext>` object plus the
// public URL to store on the row. The browser PUTs the file straight to R2,
// then submits the joke with `imageUrl = finalUrl`. Content-Length is signed so
// R2 rejects anything larger than the size we capped at issuance time.
// ---------------------------------------------------------------------------

const R2_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function extForContentType(contentType, filename) {
  const map = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/avif': 'avif',
  };
  if (map[contentType]) return map[contentType];
  const fromName = /\.([a-z0-9]{2,5})$/i.exec(filename || '');
  return fromName ? fromName[1].toLowerCase() : 'bin';
}

async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}

async function sha256Hex(data) {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function presignR2Put(env, key, contentType, contentLength, expiresSec = 300) {
  const endpoint = String(env.R2_ENDPOINT || '').replace(/\/$/, '');
  const { R2_BUCKET: bucket, R2_ACCESS_KEY_ID: accessKey, R2_SECRET_ACCESS_KEY: secret } = env;
  if (!endpoint || !bucket || !accessKey || !secret) {
    throw new HttpError(500, 'R2 is not configured');
  }

  // R2's S3 API is virtual-hosted: https://<bucket>.<account>.r2.cloudflarestorage.com/<key>
  const accountHost = new URL(endpoint).host;
  const host = `${bucket}.${accountHost}`;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const datestamp = amzDate.slice(0, 8);
  const scope = `${datestamp}/auto/s3/aws4_request`;
  const payloadHash = 'UNSIGNED-PAYLOAD';
  const signedHeaders = 'content-length;host';

  const encodedKey = key.split('/').map((seg) =>
    encodeURIComponent(seg).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
  ).join('/');

  const canonicalQuery = [
    'X-Amz-Algorithm=AWS4-HMAC-SHA256',
    `X-Amz-Credential=${encodeURIComponent(`${accessKey}/${scope}`).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`,
    `X-Amz-Date=${amzDate}`,
    `X-Amz-Expires=${expiresSec}`,
    `X-Amz-SignedHeaders=${encodeURIComponent(signedHeaders)}`,
  ].join('&');

  const canonicalHeaders =
    `content-length:${contentLength}\n` +
    `host:${host}\n`;

  const canonicalRequest = [
    'PUT',
    `/${encodedKey}`,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    await sha256Hex(new TextEncoder().encode(canonicalRequest)),
  ].join('\n');

  const kSecret = new TextEncoder().encode('AWS4' + secret);
  const kDate = await hmac(kSecret, new TextEncoder().encode(datestamp));
  const kRegion = await hmac(kDate, new TextEncoder().encode('auto'));
  const kService = await hmac(kRegion, new TextEncoder().encode('s3'));
  const kSigning = await hmac(kService, new TextEncoder().encode('aws4_request'));
  const signature = [...await hmac(kSigning, new TextEncoder().encode(stringToSign))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');

  return `https://${host}/${encodedKey}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

async function handlePresign(request, env) {
  const body = await readJson(request);
  const { filename, contentType, size } = body || {};

  if (typeof size !== 'number' || !(size > 0)) throw new HttpError(400, 'size is required');
  if (size > R2_MAX_IMAGE_BYTES) throw new HttpError(400, 'Image must be under 5MB');
  if (typeof contentType !== 'string' || !contentType.startsWith('image/')) {
    throw new HttpError(400, 'contentType must be an image');
  }

  const key = `jokes/${crypto.randomUUID()}.${extForContentType(contentType, filename)}`;
  const base = String(env.R2_PUBLIC_BASE || '').replace(/\/$/, '');
  const finalUrl = `${base}/${key}`;
  const url = await presignR2Put(env, key, contentType, size, 300);

  return json({ url, finalUrl, key });
}

// ---------------------------------------------------------------------------
// Admin endpoints (Firebase ID token required)
// ---------------------------------------------------------------------------

async function handleListJokes(url, env) {
  const status = url.searchParams.get('status') || 'all';
  const allowed = new Set(['all', 'active', 'quarantine', 'deleted']);
  if (!allowed.has(status)) throw new HttpError(400, 'Invalid status filter');

  let rows;
  if (status === 'all') {
    rows = await env.DB.prepare(
      `SELECT * FROM jokes ORDER BY timestamp DESC, id DESC LIMIT 5000`
    ).all();
  } else {
    rows = await env.DB.prepare(
      `SELECT * FROM jokes WHERE status = ? ORDER BY timestamp DESC, id DESC LIMIT 5000`
    ).bind(status).all();
  }
  return json({ jokes: rows.results.map(mapJokeRow) });
}

async function handleCreateJoke(request, env) {
  const body = await readJson(request);
  const { type, question, answer, status, imageUrl, imagePublicId } = body || {};

  if (!['single', 'qna'].includes(type)) throw new HttpError(400, 'Invalid type');
  const q = str(question, 1000);
  if (!q) throw new HttpError(400, 'Joke text is required');
  const a = type === 'qna' ? str(answer, 1000) : null;
  const st = ['active', 'quarantine', 'deleted'].includes(status) ? status : 'active';
  const img = sanitizeImageUrl(imageUrl);
  const pid = typeof imagePublicId === 'string' ? imagePublicId : null;
  const rand = st === 'active' ? Math.random() : null;

  const id = crypto.randomUUID();
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO jokes
       (id, type, question, answer, image_url, image_public_id,
        upvotes, downvotes, status, submitted_by, rand, seq, timestamp, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin', ?,
             (SELECT COALESCE(MAX(seq), 0) + 1 FROM jokes), ?, ?)`
  ).bind(id, type, q, a, img, pid, ORIGINAL_START_SCORE, 0, st, rand, now, now).run();

  return json({ id }, 201);
}

async function handleUpdateJoke(request, path, env) {
  const id = decodeURIComponent(path.split('/').pop());
  const body = await readJson(request);

  const sets = [];
  const params = [];

  const type = body.type;
  if (['single', 'qna'].includes(type)) {
    sets.push('type = ?'); params.push(type);
    const q = str(body.question, 1000);
    if (q) { sets.push('question = ?'); params.push(q); }
    const a = type === 'qna' ? str(body.answer, 1000) : null;
    sets.push('answer = ?'); params.push(a);
  }

  if (body.status !== undefined) {
    if (!['active', 'quarantine', 'deleted'].includes(body.status)) {
      throw new HttpError(400, 'Invalid status');
    }
    sets.push('status = ?'); params.push(body.status);
  }

  if (body.imageUrl !== undefined) {
    const img = sanitizeImageUrl(body.imageUrl);
    sets.push('image_url = ?'); params.push(img);
  }
  if (body.imagePublicId !== undefined) {
    sets.push('image_public_id = ?'); params.push(body.imagePublicId);
  }

  if (sets.length === 0) throw new HttpError(400, 'Nothing to update');

  // Keep the random-walk key populated for anything that can be served.
  sets.push('rand = COALESCE(rand, CASE WHEN status = ? THEN ? END)');
  params.push('active', Math.random());

  sets.push('timestamp = ?'); params.push(Date.now());

  const res = await env.DB.prepare(
    `UPDATE jokes SET ${sets.join(', ')} WHERE id = ? RETURNING id`
  ).bind(...params, id).first();

  if (!res) throw new HttpError(404, 'Joke not found');
  return json({ ok: true });
}

async function handleSetStatus(request, path, env) {
  const id = decodeURIComponent(path.split('/')[4]);
  const body = await readJson(request);

  if (!['active', 'quarantine', 'deleted'].includes(body.status)) {
    throw new HttpError(400, 'Invalid status');
  }

  // A joke only becomes reachable by the public walk once it is active — that
  // is the moment it must receive its rand key.
  const rand = body.status === 'active' ? Math.random() : null;

  const res = await env.DB.prepare(
    `UPDATE jokes
        SET status = ?,
            rand   = COALESCE(rand, ?)
      WHERE id = ?
      RETURNING id`
  ).bind(body.status, rand, id).first();

  if (!res) throw new HttpError(404, 'Joke not found');
  return json({ ok: true });
}

async function handleStats(env) {
  const counts = {};
  for (const status of [null, 'active', 'quarantine', 'deleted']) {
    const res = status
      ? await env.DB.prepare(`SELECT COUNT(*) AS c FROM jokes WHERE status = ?`).bind(status).first()
      : await env.DB.prepare(`SELECT COUNT(*) AS c FROM jokes`).first();
    if (!status) counts.total = res.c;
    else counts[status] = res.c;
  }
  return json(counts);
}