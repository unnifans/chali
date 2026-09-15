# Chali — Malayalam Joke App

What this is

Chali is a small web app for serving and moderating Malayalam jokes. It provides a public page that shows a random joke and an admin panel to review and approve user submissions. Data lives in **Cloudflare D1** (SQLite) behind a **Cloudflare Worker API**; Firebase is used only for admin authentication, and Cloudflare Pages serves the static frontend.

Stack
- **Language(s):** JavaScript (frontend + Worker), CSS, HTML
- **Framework / runtime:** Vite (frontend), Cloudflare Workers (Node-compatible runtime), Cloudflare D1 (SQLite)
- **Notable libraries:** jose (Firebase ID-token verification in the Worker), firebase/auth (admin login only), Vite

How it's organized

```
frontend/        Vite app: public page (index.html) + admin panel (admin.html)
  public/        static assets (incl. ads.txt)
  src/           frontend source (JS/CSS/HTML entrypoints)
worker/          Cloudflare Worker API (src/index.js, src/auth.js) + D1 migrations
scripts/         one-off scripts (seed data, Firestore -> D1 export)
functions/       RETIRED: old Firebase Cloud Functions; kept for reference only
firebase.json    Firebase project configuration (auth only now)
package.json     root npm scripts that proxy to frontend/scripts/worker
```

How it fits together
- The frontend (Vite) is a static site deployed to Cloudflare Pages. Every read/write goes through the Worker API (`src/api.js` wraps all `/api/*` routes) into D1.
- The Worker authenticates admin requests by verifying a Firebase ID token (jose + JWKS) and checking the `ADMIN_EMAILS` allowlist. Public endpoints need no login.
- Vote status reconciliation (auto-quarantine below a score threshold) happens inside the Worker's vote handler — this code used to live in the `onVoteUpdate` Cloud Function, which is now retired.

How to run it (shortest path)

1. Clone the repo

```bash
git clone https://github.com/unnifans/chali.git
cd chali
```

2. Frontend: copy env and run dev server

```bash
cd frontend
cp .env.example .env
# Edit .env and add the values described below
npm install
npm run dev
```

Open the printed localhost URL for the public page and visit `/admin.html` for the admin panel.

Required environment variables (frontend/.env)
- VITE_FIREBASE_API_KEY
- VITE_FIREBASE_AUTH_DOMAIN
- VITE_FIREBASE_APP_ID
- VITE_FIREBASE_PROJECT_ID  (the repo uses `jokeymalayalam` by default)
- VITE_API_BASE             (Worker URL, no trailing slash; leave empty for same-origin `/api`)

Notes:
- Add your Cloudflare Pages domain (e.g. `your-project.pages.dev`) to Firebase Console → Authentication → Settings → Authorized domains for admin login to work.
- While testing locally, `localhost` is usually already allowed by Firebase Auth.

Run the Worker locally (optional, needs `wrangler`)

```bash
cd worker
npm install
copy .dev.vars.example .dev.vars  # Windows; or `cp .dev.vars.example .dev.vars`
npm run migrate:local              # apply worker/migrations to a local D1
npm run dev                        # http://localhost:8787
```

Point the frontend at it with `VITE_API_BASE=http://localhost:8787` in `frontend/.env`.

Worker environment
- `FIREBASE_PROJECT_ID` — required; used to verify Firebase ID tokens (JWKS from `securetoken@system.gserviceaccount.com`).
- `ADMIN_EMAILS` — comma-separated allowlist of admin emails. Empty means any authenticated Firebase user is treated as admin (for local dev). Set these in production via `wrangler secret put` or `[vars]` in the dashboard.
- D1 binding name: `DB`.

Seed or migrate data

The tables are jokes and memes. Existing Firestore data can be moved to D1 directly:

```bash
# 1. From repo root: export Firestore -> JSON + INSERT SQL
npm run export-d1            # needs scripts/service-account.json (see scripts/export-firestore.js header)

# 2. Apply the SQL to D1 from the worker folder
cd worker
npm run migrate:remote       # apply schema (worker/migrations) to the D1 database
npx wrangler d1 execute chali-d1 --remote --file ../scripts/_d1_export/insert_jokes.sql
npx wrangler d1 execute chali-d1 --remote --file ../scripts/_d1_export/insert_memes.sql
```

The D1 schema keeps Firestore document IDs as primary keys, so re-exporting and re-running the inserts is safe (`INSERT OR IGNORE`).

Deploy

- Deploy the Worker + run D1 migrations

```bash
cd worker
npm install
npm run migrate:remote        # applies worker/migrations to the remote D1
npm run deploy               # wrangler deploy — uses worker/wrangler.jsonc
```

- Deploy frontend to Cloudflare Pages (Git-connected recommended)
  - Cloudflare Pages build settings: Framework preset **Vite**, build command `npm run build`, output directory `frontend/dist`, root `frontend`.
  - Add the same environment variables in the Cloudflare Pages dashboard.

Or deploy via Wrangler CLI:

```bash
cd frontend
npm run build
npx wrangler pages deploy dist --project-name=malayalam-joke-app
```

Read efficiency (critical at viral scale)

The public page never pulls a list of jokes. `GET /api/jokes/next` runs a random-walk over the D1 `(status, rand, id)` index and returns exactly **one row per request**. The frontend keeps a small cursor (`{ rand, id }`) and the Worker wraps around when the walk reaches the end. Jokes receive their `rand` key only when they become `active`, so quarantined/deleted rows are never part of the walk. Loading memes are cached in localStorage for 24h and votes are handled by the Worker as atomic `UPDATE ... + delta` writes (read-free), followed by status reconciliation.

What to test once it's running
- Public page loads a random joke
- QnA jokes reveal the answer on click; single jokes show text
- Upvote/downvote work once per user and then disable for that joke
- Submitting a joke creates a `quarantine` row in D1
- Logging into `/admin.html` shows submissions in the queue (Firebase Auth + Worker token)
- Approving flips a joke to `active` and it appears on the public page
- Downvoting an active joke enough (net score < 3) auto-quarantines it (Worker vote handler)

Useful files
- `frontend/index.html`, `frontend/admin.html` — the two entry pages
- `frontend/.env.example` — environment template for the frontend
- `frontend/src/api.js` — single wrapper for every Worker `/api/*` route
- `worker/src/index.js` — the Worker API (public + admin endpoints)
- `worker/migrations/0001_init.sql` — D1 schema (jokes, memes)
- `scripts/export-firestore.js` — one-time Firestore -> D1 export
- `scripts/seed.js` — seed test jokes

Contributing
- Open an issue for feature requests or bugs.
- Send a PR with a clear description and a short test plan.

Contact
- Repo owner: unnifans