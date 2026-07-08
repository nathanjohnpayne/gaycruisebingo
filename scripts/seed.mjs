// Seed the event + prompt pool using the Firebase Admin SDK (bypasses security rules).
//
// One-time setup (Application Default Credentials — no committed key file):
//   1. npm i -D firebase-admin
//   2. gcloud auth application-default login
//   3. Find each Admin's Google UID: sign into the app once, then Firebase console > Authentication > Users.
//   4. ADMIN_UID=<uid>[,<uid>,...] GOOGLE_CLOUD_PROJECT=gaycruisebingo node scripts/seed.mjs
//
// Admin roster: Admin is the only privileged role, and `events/{id}.admins` is the
// roster the app trusts. ADMIN_UID takes a comma-separated list of uids; the target
// roster is 2–4 Admins including Nathan's seed uid (the concrete co-admin uids are
// the #15 decision). The event write merges, and when ADMIN_UID is unset the write
// omits `admins` entirely — so re-running the seed never wipes a granted roster, and
// re-running with the final roster once #15 lands is safe.
//
// Falls back to a serviceAccountKey.json in the project root if one exists
// (gitignored — do NOT commit).
//
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Seed payload — importable with no side effects (Firebase is only touched when
// the script is executed directly, below). `src/test/w1-event-seed.test.ts`
// asserts this shape per specs/w1-event-seed.md.
// ---------------------------------------------------------------------------

export const EVENT_SEED = {
  name: 'Atlantis Med — Trieste to Barcelona',
  sailStart: '2026-07-15',
  sailEnd: '2026-07-24',
  status: 'active',
  defaultTheme: 'neon-playground',
  claimMode: 'honor', // 'honor' | 'proof_required' | 'admin_confirmed'
  // reportHideThreshold is the only settings key — it is load-bearing (ADR 0004
  // reactive moderation: auto-hide at 4 distinct reports; value pending final
  // confirmation via #15). ADR 0004 removed the event's other Phase-0 flag as dead
  // config (type-side removal: w0-type-contract), so nothing else is seeded here.
  settings: { reportHideThreshold: 4 },
};

// Parse the ADMIN_UID env var (comma-separated uids) into the events/{id}.admins roster.
export function adminRoster(raw = '') {
  return raw
    .split(',')
    .map((uid) => uid.trim())
    .filter(Boolean);
}

// The exact object written to events/{id}: `admins` is omitted when the roster is
// empty so a `merge: true` re-run without ADMIN_UID leaves the existing roster alone.
//
// `deleteBlackoutEnabled` is a Firestore delete-field sentinel (`FieldValue.delete()`
// from firebase-admin/firestore), injected by the caller rather than imported at module
// scope so this function stays import-safe without the dev-only firebase-admin install
// (see the dynamic import in `seed()` below). It is written at `settings.blackoutEnabled`
// because a `{ merge: true }` write only touches leaf paths present in the payload:
// re-running this seed against an Event doc the previous seed already wrote —
// which included `blackoutEnabled` — would otherwise leave that stale ADR 0004 field in
// place forever. The sentinel actively deletes it instead of merely omitting it.
export function eventWritePayload(admins, deleteBlackoutEnabled) {
  return {
    ...EVENT_SEED,
    settings: { ...EVENT_SEED.settings, blackoutEnabled: deleteBlackoutEnabled },
    ...(admins.length ? { admins } : {}),
  };
}

// Dense pre-cruise Prompt pool (ADR 0003): keep this ~30–50 strong so `dealBoard`
// always has its ≥ 24 sample and a late joiner can still be dealt a Board.
export const ITEMS = [
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

// ---------------------------------------------------------------------------
// Seeding — runs only when executed directly (`node scripts/seed.mjs`), so
// importing the payload above never requires the dev-only firebase-admin install.
// ---------------------------------------------------------------------------

async function seed() {
  const { readFileSync, existsSync } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  // firebase-admin is a run-directly-only dependency (`npm i -D firebase-admin`
  // before seeding) that is absent from the app install. The specifiers are
  // computed + @vite-ignore so Vite (which transforms this module when the
  // test imports the payload builders) never tries to resolve them at
  // transform time — Node resolves them normally when the seed actually runs.
  const adminAppModule = 'firebase-admin/app';
  const adminFirestoreModule = 'firebase-admin/firestore';
  const { initializeApp, cert, applicationDefault } = await import(/* @vite-ignore */ adminAppModule);
  const { getFirestore, FieldValue } = await import(/* @vite-ignore */ adminFirestoreModule);

  const EVENT_ID = process.env.VITE_EVENT_ID || 'med-2026';
  const admins = adminRoster(process.env.ADMIN_UID);

  const keyUrl = new URL('../serviceAccountKey.json', import.meta.url);
  initializeApp(
    existsSync(keyUrl) ? { credential: cert(JSON.parse(readFileSync(keyUrl))) } : { credential: applicationDefault() },
  );
  const db = getFirestore();

  const eventRef = db.doc(`events/${EVENT_ID}`);
  await eventRef.set(eventWritePayload(admins, FieldValue.delete()), { merge: true });

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
  // Redacted on purpose (CodeQL js/clear-text-logging, alert #2): report that the
  // roster was set — and how many uids parsed — without echoing the env-sourced uids.
  console.log(
    admins.length
      ? `Admins: set (${admins.length})`
      : 'No ADMIN_UID set — set the roster (comma-separated uids) and re-run to grant admin.',
  );
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await seed();
}
