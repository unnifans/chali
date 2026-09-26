/**
 * Upload the local `scripts/memes` meme files to a Cloudflare R2 bucket and
 * emit a SQL file that points the D1 `memes.url` columns at the R2 URLs.
 *
 * Setup (scripts/.env):
 *   R2_ENDPOINT=<https://<accountid>.r2.cloudflarestorage.com>
 *   R2_ACCESS_KEY_ID=...
 *   R2_SECRET_ACCESS_KEY=...
 *   R2_BUCKET=chali-media
 *   R2_PUBLIC_BASE=<https://media.chali.in  |  https://pub-<hex>.r2.dev>
 *
 * Run:
 *   cd scripts
 *   npm install
 *   node upload-memes-r2.js
 *   npx wrangler d1 execute chali-d1 --remote --file _meme_url_updates.sql
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

dotenv.config({ path: path.join(__dirname, '.env') });

const {
  R2_ENDPOINT,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
  R2_PUBLIC_BASE,
} = process.env;

for (const k of ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE']) {
  if (!process.env[k]) {
    console.error(`Missing ${k} in scripts/.env`);
    process.exit(1);
  }
}

const MEMES_DIR = path.join(__dirname, 'memes');
const ALLOWED_EXTS = new Set(['.gif', '.jpg', '.jpeg', '.png', '.webp', '.avif']);
const SQL_FILE = path.join(__dirname, '_meme_url_updates.sql');

const MIME = {
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
};

const client = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

async function objectExists(key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch (err) {
    return false;
  }
}

async function main() {
  if (!fs.existsSync(MEMES_DIR)) {
    console.error(`Memes directory not found: ${MEMES_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(MEMES_DIR).filter((f) => ALLOWED_EXTS.has(path.extname(f).toLowerCase()));
  if (files.length === 0) {
    console.error('No image files found in scripts/memes/');
    process.exit(1);
  }

  console.log(`Uploading ${files.length} file(s) to s3://${R2_BUCKET}/memes/ ...\n`);
  const updates = [];

  for (const file of files) {
    const key = `memes/${file}`;
    const filePath = path.join(MEMES_DIR, file);
    const existed = await objectExists(key);

    if (existed) {
      console.log(`  already in R2 (skipped upload): ${key}`);
    } else {
      await client.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
          Body: fs.readFileSync(filePath),
          ContentType: MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        })
      );
      console.log(`  uploaded: ${key}`);
    }

    const url = `${R2_PUBLIC_BASE.replace(/\/$/, '')}/${key}`;
    const safe = url.replace(/'/g, "''");
    updates.push(`UPDATE memes SET url = '${safe}' WHERE original_filename = '${file.replace(/'/g, "''")}';`);
  }

  fs.writeFileSync(SQL_FILE, updates.join('\n') + '\n');
  console.log(`\nWrote ${SQL_FILE} (${updates.length} UPDATE statements).`);
  console.log('Apply with:');
  console.log('  npx wrangler d1 execute chali-d1 --remote --file _meme_url_updates.sql\n');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});