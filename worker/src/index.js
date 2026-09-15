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

function mapJokeRow(r) {
  return {
    id: r.id,
    type: r.type,
    question: r.question,
    answer: r.answer,
    imageUrl: r.image_url,
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

// Random-walk in SQL: serve exactly ONE active joke per request.
// cursor = { rand, id } of the last served joke; the worker walks the
// (status, rand, id) ordering and wraps when it runs past the end.
async function handleNextJoke(url, env) {
  const cursorRand = url.searchParams.get('cursorRand');
  const cursorId = url.searchParams.get('cursorId');

  let rows;
  if (cursorRand !== null) {
    const r = Number(cursorRand);
    const id = String(cursorId || '');
    rows = await env.DB.prepare(
      `SELECT * FROM jokes
         WHERE status = 'active'
           AND (rand > ? OR (rand = ? AND id > ?))
         ORDER BY rand, id
         LIMIT 1`
    ).bind(r, r, id).all();
  } else {
    rows = await env.DB.prepare(
      `SELECT * FROM jokes
         WHERE status = 'active'
         ORDER BY rand, id
         LIMIT 1`
    ).all();
  }

  let joke = rows.results[0] || null;

  // Walked past the highest rand — wrap back to the start of the pool.
  if (!joke && cursorRand !== null) {
    const wrapped = await env.DB.prepare(
      `SELECT * FROM jokes
         WHERE status = 'active'
         ORDER BY rand, id
         LIMIT 1`
    ).all();
    joke = wrapped.results[0] || null;
  }

  return json({ joke: joke ? mapJokeRow(joke) : null });
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
    img = imageUrl;
  }
  const pid = typeof imagePublicId === 'string' || imagePublicId === null ? imagePublicId : null;

  const id = crypto.randomUUID();
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO jokes
       (id, type, question, answer, image_url, image_public_id,
        upvotes, downvotes, status, submitted_by, rand, timestamp, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'quarantine', 'anonymous', NULL, ?, ?)`
  ).bind(id, type, q, a, img, pid, ORIGINAL_START_SCORE, 0, now, now).run();

  return json({ id }, 201);
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
  const img = typeof imageUrl === 'string' && imageUrl.startsWith('https://') ? imageUrl : null;
  const pid = typeof imagePublicId === 'string' ? imagePublicId : null;
  const rand = st === 'active' ? Math.random() : null;

  const id = crypto.randomUUID();
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO jokes
       (id, type, question, answer, image_url, image_public_id,
        upvotes, downvotes, status, submitted_by, rand, timestamp, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin', ?, ?, ?)`
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
    const img = typeof body.imageUrl === 'string' && body.imageUrl.startsWith('https://') ? body.imageUrl : null;
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
  const id = decodeURIComponent(path.split('/')[3]);
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