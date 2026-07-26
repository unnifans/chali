# The Malayalam Joke App

## What's already done
- Firestore database created (project: `jokeymalayalam`)
- Authentication enabled (Email/Password)
- Security rules deployed (`firestore.rules` in this repo matches what you already have live)
- Composite index created (`status` asc, `rand` asc) — matches `firestore.indexes.json` here

## What's in this repo
```
firebase.json / .firebaserc / firestore.rules / firestore.indexes.json   -> Firebase project config
functions/       -> Cloud Function: auto-quarantine on vote updates
frontend/        -> Vite app: public page (index.html) + admin panel (admin.html)
scripts/seed.js  -> one-off script to add a few test jokes
```

## 1. Fill in your config

Copy the env template:
```bash
cd frontend
cp .env.example .env
```

Open `.env` and fill in:
- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_APP_ID` —
  find these at **Firebase Console → Project Settings (gear icon) → General → Your apps**.
  If you don't have a Web App registered yet, click **Add app → Web** first — it'll
  give you a config block with these exact values. `VITE_FIREBASE_PROJECT_ID` is
  already filled in as `jokeymalayalam`.
- `VITE_CLOUDINARY_CLOUD_NAME` — Cloudinary Console dashboard, top left.
- `VITE_CLOUDINARY_UPLOAD_PRESET` — Cloudinary Console → Settings → Upload →
  scroll to "Upload presets" → Add upload preset → set **Signing Mode: Unsigned**,
  restrict allowed formats to `jpg,png,webp`, set a max file size. Copy the preset name.

## 2. Create an admin account

You don't build a sign-up form for this — just add yourself directly:
**Firebase Console → Authentication → Users tab → Add user** → enter an email + password.
That's the login you'll use at `/admin`.

## 3. Run the frontend locally

```bash
cd frontend
npm install
npm run dev
```
Visit the printed localhost URL for the public page, and `/admin.html` for the admin panel.

Note: while testing locally, Firebase Auth needs `localhost` in its authorized
domains list — it's there by default, so this should just work.

## 4. Seed a few test jokes (your Firestore is currently empty)

```bash
cd scripts
npm install
# Download a service account key first (see comment at top of seed.js),
# save it as scripts/service-account.json, then:
node seed.js
```
This adds 3 sample jokes with `status: "active"` so the public page has something
to show immediately, without needing to go through the admin approval flow.

## 5. Deploy the Cloud Function

```bash
npm install -g firebase-tools   # if you don't have it
firebase login
firebase deploy --only functions
```
Rules and indexes are already live, but if you ever edit `firestore.rules` or
`firestore.indexes.json` in this repo, redeploy with:
```bash
firebase deploy --only firestore:rules,firestore:indexes
```

## 6. Deploy the frontend to Cloudflare Pages

**Git-connected (recommended):**
1. Push this repo to GitHub.
2. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git.
3. Build settings: Framework preset **Vite**, build command `npm run build`,
   build output directory `frontend/dist`, root directory `frontend`.
4. Add the same env vars from your `.env` file under Settings → Environment variables.

**Or via CLI:**
```bash
cd frontend
npm run build
npx wrangler pages deploy dist --project-name=malayalam-joke-app
```

Once it's live, add the Cloudflare Pages domain (e.g. `your-project.pages.dev`)
to **Firebase Console → Authentication → Settings → Authorized domains**, or
admin login will fail with `auth/unauthorized-domain`.

## What to test once it's running
- [ ] Public page loads a random joke
- [ ] QnA jokes reveal the answer on click; single jokes just show text
- [ ] Upvote/downvote work once, then the buttons disable for that joke
- [ ] Clicking "Next" too fast shows the cooldown timer
- [ ] Submitting a joke creates a `quarantine` doc (check Firestore console)
- [ ] Logging into `/admin.html` shows that submission in the queue
- [ ] Approving it flips it to `active` and it starts showing up on the public page
- [ ] Downvoting an active joke enough times (net score < 3) auto-quarantines it
      — check Cloud Function logs with `firebase functions:log`
