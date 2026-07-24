// One-time cells-map migration (#457, specs/cells-map.md).
//
// Converts every Board's `cells` from the legacy ARRAY to the MAP keyed by
// canonical decimal index ('0'..'24'), and drops the retired `markVersion`
// field. The map is what lets a Mark be a per-cell `{ merge: true }` patch, so
// two devices marking different Squares merge instead of clobbering (the
// PR #447 review-loop class no version counter could close).
//
// DEPLOY ORDER (the whole point of this script): run this WITH --apply FIRST,
// THEN deploy the #457 firestore.rules + hosting bundle together, THEN run
// --apply ONCE MORE as a mop-up: a still-live pre-migration bundle can land a
// full-array write in the gap between the first pass and the rules deploy;
// the rules then deny any further array writes, so the mop-up converges the
// stragglers and its VERIFY green is the terminal state. Each pass ends with
// that VERIFY (re-enumerates every board, fails loudly unless 100% map).
//
// Scope: every `boards` collection-group doc — the day-scoped
// events/*/days/*/boards/* AND the legacy events/*/boards/* (read-consistency
// only; the legacy path has no live write rule). Touches ONLY `cells` (shape
// conversion, cell payloads byte-identical) and `markVersion` (deleted).
// Never touches marks/stats/tallies/proofs/moments semantics.
//
// Usage (dry-run is the DEFAULT — nothing is written without --apply):
//   GOOGLE_CLOUD_PROJECT=gaycruisebingo node scripts/migrate-cells-map.mjs
//   GOOGLE_CLOUD_PROJECT=gaycruisebingo node scripts/migrate-cells-map.mjs --apply
//
// Idempotent: already-map boards are skipped; a re-run reports 0 to convert.
// Credentials: gitignored repo-root serviceAccountKey.json (cert) if present,
// else Application Default Credentials — the same resolution as
// scripts/seed.mjs / scripts/migrate-schedule-2026-07-17.mjs.

import { pathToFileURL } from 'node:url';

/** Pure: the map conversion (mirrors src/game/cells.ts cellsToMap). */
export function toCellsMap(cells) {
  const map = {};
  for (const cell of cells) map[String(cell.index)] = cell;
  return map;
}

/** Pure: convert a legacy array to the CANONICAL map, or null when it cannot
 * become one (4b round-5 P1 on #458): an empty/short array, duplicate or
 * missing `index` values, or junk elements all convert to a non-canonical map
 * that the deployed rules would then reject on every future write — such a
 * board must be REPORTED and block the migration, never silently written. */
export function convertCells(value) {
  if (!Array.isArray(value)) return null;
  const map = toCellsMap(value.filter((c) => c != null && typeof c === 'object'));
  return classifyCells(map) === 'map' ? map : null;
}

/** Pure: classify one board doc's cells shape. A 'map' verdict requires the
 * CANONICAL shape — exactly the 25 decimal keys '0'..'24', each value carrying
 * the matching numeric `index` — mirroring the rules' canonicalCellsMap gate
 * (Phase 4b P1 on #458): a partial map (e.g. a one-cell patch that landed on a
 * still-array board in the migration gap) must read as 'malformed', never as
 * safe, so the VERIFY pass fails loudly instead of blessing a 24-cell loss. */
export function classifyCells(value) {
  if (Array.isArray(value)) return 'array';
  if (value != null && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length !== 25) return 'malformed';
    for (let i = 0; i < 25; i += 1) {
      const cell = value[String(i)];
      if (cell == null || typeof cell !== 'object' || cell.index !== i) return 'malformed';
    }
    return 'map';
  }
  return 'malformed';
}

async function initFirestore() {
  const { readFileSync, existsSync } = await import('node:fs');
  const adminAppModule = 'firebase-admin/app';
  const adminFirestoreModule = 'firebase-admin/firestore';
  let initializeApp, cert, applicationDefault, getFirestore, FieldValue;
  try {
    ({ initializeApp, cert, applicationDefault } = await import(/* @vite-ignore */ adminAppModule));
    ({ getFirestore, FieldValue } = await import(/* @vite-ignore */ adminFirestoreModule));
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND') {
      console.error('firebase-admin is not installed (dev-only). Run: npm i -D firebase-admin');
      process.exit(1);
    }
    throw err;
  }
  let projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '';
  if (!projectId) {
    const rcUrl = new URL('../.firebaserc', import.meta.url);
    if (existsSync(rcUrl)) {
      try {
        projectId = JSON.parse(readFileSync(rcUrl, 'utf8'))?.projects?.default || '';
      } catch {
        projectId = '';
      }
    }
  }
  if (!projectId) {
    throw new Error(
      'cells-map migration: no Firebase project resolved. Set GOOGLE_CLOUD_PROJECT/GCLOUD_PROJECT or .firebaserc projects.default.',
    );
  }
  const keyUrl = new URL('../serviceAccountKey.json', import.meta.url);
  initializeApp({
    ...(existsSync(keyUrl)
      ? { credential: cert(JSON.parse(readFileSync(keyUrl))) }
      : { credential: applicationDefault() }),
    projectId,
  });
  return { db: getFirestore(), FieldValue, projectId };
}

async function enumerateBoards(db) {
  const snap = await db.collectionGroup('boards').get();
  return snap.docs;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const { db, FieldValue, projectId } = await initFirestore();
  console.log(`cells-map migration against project ${projectId} — ${apply ? 'APPLY' : 'dry-run'}`);

  const docs = await enumerateBoards(db);
  let arrays = 0;
  let maps = 0;
  let malformed = 0;
  const toConvert = [];
  for (const doc of docs) {
    const data = doc.data();
    const shape = classifyCells(data.cells);
    if (shape === 'array') {
      if (convertCells(data.cells) == null) {
        malformed += 1;
        console.error(`UNCONVERTIBLE array (would not yield a canonical 25-key map): ${doc.ref.path}`);
        continue;
      }
      arrays += 1;
      toConvert.push(doc);
    } else if (shape === 'map') {
      maps += 1;
      if ('markVersion' in data) toConvert.push(doc); // cleanup-only write
    } else {
      malformed += 1;
      console.error(`MALFORMED cells (neither array nor map): ${doc.ref.path}`);
    }
  }
  console.log(`boards: ${docs.length} total — ${arrays} array, ${maps} map, ${malformed} malformed`);
  if (malformed > 0) {
    console.error('Refusing to proceed with malformed boards present — inspect them first.');
    process.exit(2);
  }
  if (toConvert.length === 0) {
    console.log('Nothing to convert — already migrated.');
    return;
  }
  if (!apply) {
    for (const doc of toConvert) console.log(`  would convert: ${doc.ref.path}`);
    console.log(`Dry-run complete: ${toConvert.length} board(s) would be written. Re-run with --apply.`);
    return;
  }

  // Per-doc TRANSACTIONS, not a batch from the enumeration snapshot
  // (CodeRabbit Major on #458): a still-live pre-migration client can write a
  // full array BETWEEN enumeration and this write, and converting from the
  // stale snapshot would clobber that Mark. Each transaction re-reads the doc
  // and converts whatever is CURRENT — a doc that turned map-shaped in the
  // meantime gets only the markVersion cleanup.
  let written = 0;
  let refused = 0;
  for (const staleDoc of toConvert) {
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(staleDoc.ref);
      if (!fresh.exists) return;
      const data = fresh.data();
      if (Array.isArray(data.cells)) {
        // Re-validate against the FRESH read — the doc can have changed since
        // enumeration, and only a canonical conversion may be written (4b
        // round-5 P1: writing a non-canonical map here would strand the board
        // behind the deployed canonicalCellsMap gate).
        const converted = convertCells(data.cells);
        if (converted == null) {
          refused += 1;
          console.error(`REFUSED (fresh read no longer canonically convertible): ${staleDoc.ref.path}`);
          return;
        }
        tx.update(staleDoc.ref, { cells: converted, markVersion: FieldValue.delete() });
      } else {
        tx.update(staleDoc.ref, { markVersion: FieldValue.delete() });
      }
      written += 1;
    });
  }
  console.log(`Converted ${written} board(s) (fresh-read transactions)${refused ? `, REFUSED ${refused}` : ''}.`);

  // VERIFY: re-enumerate; every board must now classify as the CANONICAL map —
  // still-array AND malformed (partial/non-canonical maps from the deploy gap)
  // both fail (4b round-5 P1). This is the gate that makes the rules deploy
  // safe — do NOT deploy the #457 rules unless it is green.
  const verify = await enumerateBoards(db);
  const notCanonical = verify.filter((d) => classifyCells(d.data().cells) !== 'map');
  if (notCanonical.length > 0 || refused > 0) {
    for (const d of notCanonical) console.error(`  NOT CANONICAL (${classifyCells(d.data().cells)}): ${d.ref.path}`);
    console.error(`VERIFY FAILED: ${notCanonical.length} board(s) not canonical-map-shaped (${refused} refused writes). Do not deploy the rules.`);
    process.exit(3);
  }
  console.log(`VERIFY OK: all ${verify.length} board(s) are canonical-map-shaped. Safe to deploy the #457 rules.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
