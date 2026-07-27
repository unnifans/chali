/**
 * Script to seed meme/gif images from the local `scripts/memes` directory to Cloudinary
 * and record their URLs and tags into a Firestore collection (`memes`).
 *
 * Setup:
 *   1. Place your image/gif files inside `scripts/memes/` directory.
 *   2. Ensure `scripts/service-account.json` exists for Firebase Admin access.
 *   3. Set environment variables in `scripts/.env`:
 *        CLOUDINARY_CLOUD_NAME=your_cloud_name
 *        CLOUDINARY_API_KEY=your_api_key
 *        CLOUDINARY_API_SECRET=your_api_secret
 *   4. Run:
 *        cd scripts
 *        npm install
 *        npm run seed-memes
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const admin = require('firebase-admin');
const cloudinary = require('cloudinary').v2;

const serviceAccountPath = path.join(__dirname, 'service-account.json');

if (!fs.existsSync(serviceAccountPath)) {
  console.error('Error: scripts/service-account.json not found!');
  console.error('Please generate a Firebase admin service account key from the Firebase Console and save it to scripts/service-account.json');
  process.exit(1);
}

// Configure Cloudinary
const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

if (!cloudName || !apiKey || !apiSecret) {
  console.error('\nError: Cloudinary credentials missing!');
  console.error('Please add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET to scripts/.env\n');
  process.exit(1);
}

cloudinary.config({
  cloud_name: cloudName,
  api_key: apiKey,
  api_secret: apiSecret,
  secure: true,
});

// Configure Firebase Admin
const serviceAccount = require(serviceAccountPath);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const MEMES_DIR = path.join(__dirname, 'memes');
const ALLOWED_EXTS = new Set(['.gif', '.jpg', '.jpeg', '.png', '.webp', '.avif']);

async function seedMemes() {
  if (!fs.existsSync(MEMES_DIR)) {
    console.error(`Memes directory not found at: ${MEMES_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(MEMES_DIR).filter((f) => {
    const ext = path.extname(f).toLowerCase();
    return ALLOWED_EXTS.has(ext);
  });

  if (files.length === 0) {
    console.log('\nNo image files found in scripts/memes/');
    console.log('Supported extensions:', Array.from(ALLOWED_EXTS).join(', '));
    console.log('Please place your meme GIFs or images in scripts/memes/ and run this script again.\n');
    process.exit(0);
  }

  console.log(`Found ${files.length} image file(s) in scripts/memes/. Starting upload...\n`);

  let successCount = 0;

  for (const file of files) {
    const filePath = path.join(MEMES_DIR, file);
    try {
      console.log(`Uploading ${file} to Cloudinary...`);
      const uploadResult = await cloudinary.uploader.upload(filePath, {
        folder: 'malayalam_joke_app/loading_memes',
        resource_type: 'auto',
      });

      console.log(`  Uploaded! Cloudinary URL: ${uploadResult.secure_url}`);

      // Save to Firestore 'memes' collection
      const memeDoc = {
        url: uploadResult.secure_url,
        publicId: uploadResult.public_id,
        tag: 'loading', // Default tag set to "loading"
        originalFilename: file,
        format: uploadResult.format,
        resourceType: uploadResult.resource_type,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      const docRef = await db.collection('memes').add(memeDoc);
      console.log(`  Saved to Firestore collection 'memes' [Doc ID: ${docRef.id}]\n`);
      successCount++;
    } catch (err) {
      console.error(`  Failed to process ${file}:`, err.message || err);
    }
  }

  console.log(`Finished processing! Successfully uploaded and recorded ${successCount}/${files.length} memes.`);
  process.exit(0);
}

seedMemes().catch((err) => {
  console.error('Fatal error during seeding:', err);
  process.exit(1);
});
