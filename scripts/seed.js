/**
 * One-off script to seed a few test jokes directly into Firestore using
 * the Admin SDK (bypasses security rules, so this must be run locally with
 * a service account, not from the browser).
 *
 * Setup:
 *   1. Firebase Console -> Project Settings -> Service Accounts ->
 *      Generate new private key. Save it as scripts/service-account.json
 *      (already in .gitignore - never commit this file).
 *   2. cd scripts && npm install firebase-admin
 *   3. node seed.js
 */
const admin = require('firebase-admin');
const serviceAccount = require('./service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const jokes = [
  {
    type: 'single',
    question: 'Malayalikal ellam onnu chേrnnal, oru IT company aavum. 😄',
    answer: null,
    imageUrl: null,
    imagePublicId: null,
    upvotes: 5,
    downvotes: 0,
    status: 'active',
    submittedBy: 'admin',
  },
  {
    type: 'qna',
    question: 'Enthinaanu Malayali laptop il coffee stain undakkunnathu?',
    answer: 'Bug fix cheyyumbo coffee spill cheyyaruthu ennu ariyilla athukondu!',
    imageUrl: null,
    imagePublicId: null,
    upvotes: 5,
    downvotes: 0,
    status: 'active',
    submittedBy: 'admin',
  },
  {
    type: 'single',
    question: 'Onam vannal ellavarum veetil, but WiFi illengil aarum varilla.',
    answer: null,
    imageUrl: null,
    imagePublicId: null,
    upvotes: 5,
    downvotes: 0,
    status: 'active',
    submittedBy: 'admin',
  },
];

async function seed() {
  for (const joke of jokes) {
    await db.collection('jokes').add({
      ...joke,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`Added: ${joke.question.slice(0, 40)}...`);
  }
  console.log(`Seeded ${jokes.length} jokes.`);
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
