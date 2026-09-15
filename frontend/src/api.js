// Central API wrapper for the Chali Worker backend. All reads/writes that used
// to hit Firebase Firestore now go through /api/* routes on a Cloudflare Worker.

const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

let authToken = null;

export function setAuthToken(token) {
  authToken = token || null;
}

function buildUrl(path, params) {
  if (!API_BASE) {
    throw new Error('VITE_API_BASE is not configured (Cloudflare Worker URL)');
  }
  const url = new URL(API_BASE + path);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    }
  }
  return url;
}

async function request(path, { method = 'GET', body, params, admin = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (admin && authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const res = await fetch(buildUrl(path, params), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const err = await res.json();
      if (err && err.error) message = err.error;
    } catch { /* keep default message */ }
    throw new Error(message);
  }

  return res.json();
}

// ---------- Public ----------

export const api = {
  getNextJoke: (cursor) =>
    request('/api/jokes/next', {
      params: cursor ? { cursorRand: cursor.rand, cursorId: cursor.id } : {},
    }),

  getMemes: (tag) => request('/api/memes', { params: { tag } }),

  castVote: (jokeId, upvoteDelta, downvoteDelta) =>
    request('/api/votes', { method: 'POST', body: { jokeId, upvoteDelta, downvoteDelta } }),

  submitJoke: (payload) =>
    request('/api/submit', { method: 'POST', body: payload }),

  // ---------- Admin (Firebase token attached) ----------

  adminList: (status) => request('/api/admin/jokes', { params: { status }, admin: true }),
  adminCreate: (payload) => request('/api/admin/jokes', { method: 'POST', body: payload, admin: true }),
  adminUpdate: (id, payload) => request(`/api/admin/jokes/${encodeURIComponent(id)}`, { method: 'PUT', body: payload, admin: true }),
  adminSetStatus: (id, status) => request(`/api/admin/jokes/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status }, admin: true }),
  adminStats: () => request('/api/admin/stats', { admin: true }),
};