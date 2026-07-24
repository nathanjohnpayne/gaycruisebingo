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

/** Pure: classify one board doc's cells shape. */
export function classifyCells(value) {
  if (Array.isArray(value)) return 'array';
  if (value != null && typeof value === 'object') return 'map';
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
  for (const staleDoc of toConvert) {
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(staleDoc.ref);
      if (!fresh.exists) return;
      const data = fresh.data();
      tx.update(staleDoc.ref, {
        ...(Array.isArray(data.cells) ? { cells: toCellsMap(data.cells) } : {}),
        markVersion: FieldValue.delete(),
      });
    });
    written += 1;
  }
  console.log(`Converted ${written} board(s) (fresh-read transactions).`);

  // VERIFY: re-enumerate; every board must now be map-shaped. This is the gate
  // that makes the rules deploy safe — do NOT deploy the #457 rules if it fails.
  const verify = await enumerateBoards(db);
  const stillArray = verify.filter((d) => classifyCells(d.data().cells) === 'array');
  if (stillArray.length > 0) {
    for (const d of stillArray) console.error(`  STILL ARRAY: ${d.ref.path}`);
    console.error(`VERIFY FAILED: ${stillArray.length} board(s) still array-shaped. Do not deploy the rules.`);
    process.exit(3);
  }
  console.log(`VERIFY OK: all ${verify.length} board(s) are map-shaped. Safe to deploy the #457 rules.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
