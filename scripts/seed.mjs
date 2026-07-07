// Seed the event + prompt pool using the Firebase Admin SDK (bypasses security rules).
//
// One-time setup:
//   1. Firebase console > Project settings > Service accounts > Generate new private key.
//      Save it as serviceAccountKey.json in the project root (already gitignored — do NOT commit).
//   2. npm i -D firebase-admin
//   3. Find your Google UID: sign into the app once, then Firebase console > Authentication > Users.
//   4. ADMIN_UID=<your-uid> node scripts/seed.mjs
//
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const EVENT_ID = process.env.VITE_EVENT_ID || 'med-2026';
const ADMIN_UID = process.env.ADMIN_UID || '';

const key = JSON.parse(readFileSync(new URL('../serviceAccountKey.json', import.meta.url)));
initializeApp({ credential: cert(key) });
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
  batch.set(col.doc(), {
    text,
    createdBy: 'seed',
    createdAt: now,
    isFreeSpace: false,
    status: 'active',
    reportCount: 0,
  });
}
await batch.commit();

console.log(`Seeded ${ITEMS.length} prompts into events/${EVENT_ID}.`);
console.log(ADMIN_UID ? `Admin: ${ADMIN_UID}` : 'No ADMIN_UID set — set one and re-run to grant admin.');
process.exit(0);
