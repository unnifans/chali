import { initializeApp } from 'firebase/app';

// Firebase is now used ONLY for admin authentication. All data reads/writes
// go through the Cloudflare Worker API (see src/api.js), so Firestore is no
// longer imported anywhere.

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);

// NOTE: getAuth() is intentionally NOT called here. It's only imported
// inside src/admin/admin.js, so the public bundle never ships Auth SDK code.