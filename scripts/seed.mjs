// Seed the event + prompt pool using the Firebase Admin SDK (bypasses security rules).
//
// One-time setup (Application Default Credentials — no committed key file):
//   1. npm i -D firebase-admin
//   2. gcloud auth application-default login
//   3. Find your Google UID: sign into the app once, then Firebase console > Authentication > Users.
//   4. ADMIN_UID=<your-uid> GOOGLE_CLOUD_PROJECT=gaycruisebingo node scripts/seed.mjs
//
// Falls back to a serviceAccountKey.json in the project root if one exists
// (gitignored — do NOT commit).
//
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const EVENT_ID = process.env.VITE_EVENT_ID || 'med-2026';
const ADMIN_UID = process.env.ADMIN_UID || '';

const keyUrl = new URL('../serviceAccountKey.json', import.meta.url);
initializeApp(
  existsSync(keyUrl) ? { credential: cert(JSON.parse(readFileSync(keyUrl))) } : { credential: applicationDefault() },
);
const db = getFirestore();

const ITEMS = [
  'Threesome',
  'Foursome',
  'Fivesome',
  'Propositioned by septuagenarians',
  'Suite orgy',
  'Domestic violence',
  'Dance-floor blowjob',
  'Locked in a bathroom',
  'Loses passport',
  'Make OnlyFans content on a boat',
  'Make LinkedIn content on a boat',
  'Make out with Patti LuPone',
  'Scabies',
  '3 loads in one day',
  'Bang a Dutch person',
  'Passaround party Norwegian',
  'Poppers spill',
  '30-year age gap',
  'Dance-floor k-hole',
  'Cafeteria k-hole',
  'Make out with a woman',
  '3-way kiss',
  'Cause an international incident',
  'Wear a sissy skirt',
  "Loudly announce you're going to bed early",
  'Karaoke "Fergalicious"',
  'Eat carbs',
  'Become Dick Deck famous',
  'Post butthole pic to Telegram',
  'Use a condom',
  'Mirror-hall selfie',
  'Snort powder off a cock',
];

const eventRef = db.doc(`events/${EVENT_ID}`);
await eventRef.set(
  {
    name: 'Atlantis Med — Trieste to Barcelona',
    sailStart: '2026-07-15',
    sailEnd: '2026-07-24',
    status: 'active',
    defaultTheme: 'neon-playground',
    claimMode: 'honor', // 'honor' | 'proof_required' | 'verified'
    admins: ADMIN_UID ? [ADMIN_UID] : [],
    settings: { reportHideThreshold: 4, blackoutEnabled: true },
  },
  { merge: true },
);

const col = eventRef.collection('items');
const now = Date.now();
const batch = db.batch();
for (const text of ITEMS) {
  // Deterministic doc id (content hash) so re-running the seed upserts the same
  // prompt docs instead of creating duplicates (boards sample distinct ids, so
  // dupes would surface the same prompt on multiple squares).
  const id = `seed-${createHash('sha1').update(text).digest('hex').slice(0, 20)}`;
  batch.set(
    col.doc(id),
    {
      text,
      createdBy: 'seed',
      createdAt: now,
      isFreeSpace: false,
      status: 'active',
      reportCount: 0,
    },
    { merge: true },
  );
}
await batch.commit();

console.log(`Seeded ${ITEMS.length} prompts into events/${EVENT_ID}.`);
console.log(ADMIN_UID ? `Admin: ${ADMIN_UID}` : 'No ADMIN_UID set — set one and re-run to grant admin.');
process.exit(0);
