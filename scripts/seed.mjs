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
import { createHash } from 'node:crypto';
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
  // NOTE: `bannedUids` (#113) is deliberately NOT seeded. This payload is written
  // with { merge: true } and the seed is documented as safe to re-run (to add
  // admins / refresh prompts), so writing bannedUids here would clobber a live ban
  // list back to [] on every reseed once #108 starts populating it — silent data
  // loss (unbanning everyone) on a routine op. A brand-new event never carries the
  // field and reads as [] via eventConverter's missing-field default (converters.ts),
  // and a reseed leaves the existing bannedUids untouched because this merge write
  // never mentions it. The follow-up (#108) fills it via banUser/unbanUser
  // (arrayUnion/arrayRemove) on the admin-writable event doc, never users/{uid}.
  // reportHideThreshold is load-bearing (ADR 0004 reactive moderation: auto-hide
  // at 4 distinct reports; value pending final confirmation via #15).
  // spicyRatio is the target share of spicy (🔞) Prompts among a Board's 24
  // non-free Squares for `dealBoard`'s stratified sampling (w1-seed-and-composition);
  // 0.4 matches `dealBoard`'s own default, kept explicit here so the seeded Event
  // doc is self-describing rather than relying on the app-side fallback. ADR 0004
  // removed the event's other Phase-0 flag as dead config (type-side removal:
  // w0-type-contract), so no other key is seeded here.
  settings: { reportHideThreshold: 4, spicyRatio: 0.4 },
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
    settings: {
      ...EVENT_SEED.settings,
      blackoutEnabled: deleteBlackoutEnabled,
    },
    ...(admins.length ? { admins } : {}),
  };
}

// Canonical 87-entry Prompt pool (24 spicy / 63 tame — w1-seed-and-composition),
// the SAME content as `SEED_ITEMS` in `src/data/seed.ts`; kept as a separate
// literal here (rather than imported) so this plain-JS script has no
// cross-module import into the TS app source. `src/data/seed-and-composition.test.ts`
// asserts the two stay in sync.
export const ITEMS = [
  { text: `Threesome`, spicy: true },
  { text: `Foursome`, spicy: true },
  { text: `Fivesome`, spicy: true },
  { text: `Propositioned by septuagenarians`, spicy: true },
  { text: `Suite orgy`, spicy: true },
  { text: `Domestic violence`, spicy: false },
  { text: `Dance floor blowjob`, spicy: true },
  { text: `Locked in a bathroom`, spicy: false },
  { text: `Loose passport`, spicy: false },
  { text: `Make OnlyFans content on a boat`, spicy: true },
  { text: `Make LinkedIn content on a boat`, spicy: false },
  { text: `Selfie with Patti LuPone`, spicy: false },
  { text: `Selfie with Bianca Del Rio`, spicy: false },
  { text: `Selfie with HAYLA`, spicy: false },
  { text: `Scabies`, spicy: false },
  { text: `Three loads in one day`, spicy: true },
  { text: `Bang a Dutch person`, spicy: true },
  { text: `Bang an Aussie`, spicy: true },
  { text: `Sex with four gays, each from a different continent`, spicy: true },
  { text: `Passaround party Norwegian`, spicy: true },
  { text: `Poppers spill`, spicy: true },
  { text: `30-year age gap`, spicy: true },
  { text: `Dance floor k-hole`, spicy: false },
  { text: `Cafeteria k-hole`, spicy: false },
  { text: `Make out with a woman`, spicy: true },
  { text: `Three-way kiss`, spicy: true },
  { text: `Cause an international incident`, spicy: false },
  { text: `Wear a sissy skirt`, spicy: true },
  { text: `Loudly announce that you're going to bed early`, spicy: false },
  { text: `Karaoke "Fergalicious"`, spicy: false },
  { text: `Eat carbs`, spicy: false },
  { text: `Become Dick Deck famous`, spicy: true },
  { text: `Post butthole pic to Telegram`, spicy: true },
  { text: `Use a condom`, spicy: true },
  { text: `Mirror hall selfie`, spicy: false },
  { text: `Snort powder off a cock`, spicy: true },
  { text: `Hear Madonna's "Danceteria" on the dance floor`, spicy: false },
  { text: `Get read by Bianca Del Rio`, spicy: false },
  { text: `Get bred by Bianca Del Rio`, spicy: true },
  { text: `Drink three dirty martinis`, spicy: false },
  { text: `Matching Speedos spotted`, spicy: false },
  { text: `Sunset selfie`, spicy: false },
  { text: `Someone loses their room key`, spicy: false },
  { text: `Dramatic outfit change before dinner`, spicy: false },
  { text: `Feather, mesh, or sequins before noon`, spicy: false },
  { text: `"I'm just having one drink"`, spicy: false },
  { text: `Pool-chair territory dispute`, spicy: false },
  { text: `Overpacked toiletries`, spicy: false },
  { text: `Cruise crush acquired`, spicy: false },
  { text: `Cruise crush immediately disappears`, spicy: false },
  { text: `Accidental matching outfits`, spicy: false },
  { text: `Elevator outfit complement`, spicy: false },
  { text: `New best friend from another city`, spicy: false },
  { text: `Late-night pizza`, spicy: false },
  { text: `Breakfast in sunglasses`, spicy: false },
  { text: `Someone naps through the main event`, spicy: false },
  { text: `"Where are you from?" conversation`, spicy: false },
  { text: `Someone knows the DJ`, spicy: false },
  { text: `Poolside caftan moment`, spicy: false },
  { text: `Too many group chats`, spicy: false },
  { text: `"I need electrolytes"`, spicy: false },
  { text: `Emergency fan deployment`, spicy: false },
  { text: `Cabaret hands during karaoke`, spicy: false },
  { text: `Someone gets adopted by a friend group`, spicy: false },
  { text: `Themed-party costume escalation`, spicy: false },
  { text: `Someone forgets which deck they're on`, spicy: false },
  { text: `Ship photographer ambush`, spicy: false },
  { text: `Formal night, but make it gay`, spicy: false },
  { text: `"This is my vacation personality"`, spicy: false },
  { text: `Unexpected Broadway sing-along`, spicy: false },
  { text: `Someone becomes briefly ship-famous`, spicy: false },
  { text: `Matching tank tops`, spicy: false },
  { text: `Someone complains about the music`, spicy: false },
  { text: `Someone reappears two hours after "going to bed"`, spicy: false },
  { text: `Suspiciously perfect tan`, spicy: false },
  { text: `"I'm never drinking again"`, spicy: false },
  { text: `"I need a vacation from my vacation"`, spicy: false },
  { text: `Caftan receives sincere applause`, spicy: false },
  { text: `Someone brought a garment steamer`, spicy: false },
  { text: `Group dinner reservation drama`, spicy: false },
  { text: `Bathroom mirror selfie`, spicy: false },
  { text: `Someone finds their cruise husband`, spicy: false },
  { text: `Someone books next year's cruise before leaving`, spicy: false },
  {
    text: `"I'm going to be homophobic for a week after this cruise"`,
    spicy: false,
  },
  { text: `Danced to the Total Eclipse of the Heart remix`, spicy: false },
  { text: `Fuck a drag queen out of drag`, spicy: true },
  { text: `Fuck a drag queen IN drag`, spicy: true },
];

// Deterministic doc id (content hash of the text only) so re-running the seed
// upserts the same prompt docs instead of creating duplicates (boards sample
// distinct ids, so dupes would surface the same prompt on multiple squares).
export function seedItemDocId(text) {
  return `seed-${createHash('sha1').update(text).digest('hex').slice(0, 20)}`;
}

export function seedItemMutations(existingDocs, now = Date.now()) {
  return {
    deleteIds: existingDocs.filter((doc) => doc.createdBy === 'seed').map((doc) => doc.id),
    writes: ITEMS.map(({ text, spicy }) => ({
      id: seedItemDocId(text),
      data: {
        text,
        createdBy: 'seed',
        createdAt: now,
        isFreeSpace: false,
        status: 'active',
        reportCount: 0,
        spicy,
      },
    })),
  };
}

// ---------------------------------------------------------------------------
// Seeding — runs only when executed directly (`node scripts/seed.mjs`), so
// importing the payload above never requires the dev-only firebase-admin install.
// ---------------------------------------------------------------------------

async function seed() {
  const { readFileSync, existsSync } = await import('node:fs');
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
    existsSync(keyUrl)
      ? { credential: cert(JSON.parse(readFileSync(keyUrl))) }
      : { credential: applicationDefault() },
  );
  const db = getFirestore();

  const eventRef = db.doc(`events/${EVENT_ID}`);
  await eventRef.set(eventWritePayload(admins, FieldValue.delete()), {
    merge: true,
  });

  const col = eventRef.collection('items');

  // Replace semantics, not append (w1-seed-and-composition): every SEED-OWNED
  // item doc is deleted and the current ITEMS are (re)written in ONE atomic
  // batch (Codex P2, PR #135) — not a delete batch committed separately from
  // the write batch, which would leave events/{id}/items with no seed prompts
  // (and joinAndDeal short of MIN_POOL) if the process died or the write
  // batch failed between the two commits. A doc whose id is unchanged across
  // reseeds (same text) gets a delete followed by a set within the same
  // batch; Firestore applies per-document batch ops in order, so the set is
  // what lands. The delete pass is scoped to `createdBy === 'seed'`
  // (CodeRabbit Major, PR #135) — addItem writes live Player-submitted
  // prompts into this SAME collection with their own uid as createdBy, so an
  // unscoped delete-everything would erase user content on every reseed.
  const existing = await col.get();
  const { deleteIds, writes } = seedItemMutations(
    existing.docs.map((doc) => ({
      id: doc.id,
      createdBy: doc.data().createdBy,
    })),
    Date.now(),
  );
  const batch = db.batch();
  for (const id of deleteIds) batch.delete(col.doc(id));
  for (const { id, data } of writes) batch.set(col.doc(id), data, { merge: true });
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
