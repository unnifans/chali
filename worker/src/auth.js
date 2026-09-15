import { createRemoteJWKSet, jwtVerify } from 'jose';

// Firebase ID-token verification for the Worker. Firebase Auth mints JWTs whose
// issuer/audience are derived from the project id, and their keys live on a
// public JWKS endpoint. jose caches the rotated keys for us, so this costs a
// tiny network call on the first request and is otherwise local.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const FIREBASE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

let jwks = null;

function getJwks() {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(FIREBASE_JWKS_URL));
  }
  return jwks;
}

// Returns the verified token payload, or throws HttpError(401).
export async function verifyIdToken(token, env) {
  const projectId = env.FIREBASE_PROJECT_ID || env.VITE_FIREBASE_PROJECT_ID;
  if (!projectId) throw new HttpError(500, 'FIREBASE_PROJECT_ID is not configured');

  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
    });
    return payload;
  } catch (err) {
    throw new HttpError(401, 'Invalid or expired token');
  }
}

// Admin allowlist via ADMIN_EMAILS (comma-separated). Empty = any verified
// Firebase user is accepted — convenient locally, set it in production.
export function isAdminPayload(payload, env) {
  if (!payload) return false;
  const admins = (env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (admins.length === 0) return true;
  return admins.includes(payload.email || '');
}