# Chali — Malayalam Joke App

What this is

Chali is a small web app for serving and moderating Malayalam jokes. It provides a public page that shows a random joke and an admin panel to review and approve user submissions. The app uses Firebase (Firestore + Auth + Cloud Functions) for data and Cloudflare Pages for static hosting.

Stack
- **Language(s):** JavaScript (frontend + Cloud Functions), CSS, HTML
- **Framework / runtime:** Vite (frontend), Firebase Cloud Functions (Node 20)
- **Notable libraries:** Firebase (firebase, firebase-admin, firebase-functions), Vite

How it's organized

```
frontend/        Vite app: public page (index.html) + admin panel (admin.html)
  public/        static assets
  src/           frontend source (JS/CSS/HTML entrypoints)
functions/       Firebase Cloud Functions (auto-quarantine logic on votes)
scripts/         one-off scripts (seed data)
firebase.json    Firebase project configuration
firestore.rules  Firestore security rules
firestore.indexes.json  Composite index for querying jokes
package.json     root npm scripts that proxy to frontend/scripts
```

How it fits together
- The frontend (Vite) is a static site deployed to Cloudflare Pages (or served locally with `npm run dev`). It reads/writes joke documents in Firestore and uses Firebase Auth for the admin panel.
- Cloud Functions run on vote updates and auto-quarantine jokes that fall below a score threshold.

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
- VITE_CLOUDINARY_CLOUD_NAME
- VITE_CLOUDINARY_UPLOAD_PRESET

Notes:
- Add your Cloudflare Pages domain (e.g. `your-project.pages.dev`) to Firebase Console → Authentication → Settings → Authorized domains for admin login to work.
- While testing locally, `localhost` is usually already allowed by Firebase Auth.

Seed the database (optional)

1. Download a Firebase service account key and save it as `scripts/service-account.json` (see the comment at the top of `scripts/seed.js`).
2. Run the seed script:

```bash
cd scripts
npm install
node seed.js
```

Deploy

- Deploy Cloud Functions

```bash
cd functions
npm install
npm run deploy
# or from repo root: npm run build && firebase deploy --only functions
```

- Deploy Firestore rules and indexes (if you edit them)

```bash
firebase deploy --only firestore:rules,firestore:indexes
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

What to test once it's running
- Public page loads a random joke
- QnA jokes reveal the answer on click; single jokes show text
- Upvote/downvote work once per user and then disable for that joke
- Submitting a joke creates a `quarantine` doc in Firestore
- Logging into `/admin.html` shows submissions in the queue
- Approving flips a joke to `active` and it appears on the public page
- Downvoting an active joke enough (net score < 3) auto-quarantines it (check Cloud Function logs with `firebase functions:log`)

Useful files
- `frontend/index.html`, `frontend/admin.html` — the two entry pages
- `frontend/.env.example` — environment template for the frontend
- `functions/index.js` (entry for Cloud Functions) — auto-quarantine logic
- `firestore.rules`, `firestore.indexes.json` — security and index configuration
- `scripts/seed.js` — seed test jokes

Contributing
- Open an issue for feature requests or bugs.
- Send a PR with a clear description and a short test plan.

Contact
- Repo owner: unnifans

---

(Updated README: improved structure, clearer setup + deploy steps.)
