import { initializeApp } from 'firebase/app';
import { getFirestore, enableIndexedDbPersistence } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// Best-effort offline cache. Fails silently in multi-tab scenarios or
// unsupported browsers - that's fine, it's a nice-to-have, not required.
enableIndexedDbPersistence(db).catch((err) => {
  console.warn('Firestore offline persistence not enabled:', err.code);
});

// NOTE: getAuth() is intentionally NOT called here. It's only imported
// inside src/admin/admin.js, so the public bundle never ships Auth SDK code.
