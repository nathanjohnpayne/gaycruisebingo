// One-time Phase-1 ROLLOUT sweep (#43 F2, Codex R2): server-hide content that
// already crossed the report threshold under Phase 0.
//
// The per-write auto-hide and the threshold-decrease backfill both fire on a
// change; content that was ALREADY over the (unchanged) threshold when the
// functions first deploy never crosses again, so it would stay `status: 'active'`
// and directly readable despite meeting the server-hide bar. Run this once,
// AFTER the first `op-firebase-deploy --only functions`, to hide that backlog.
// See docs/app/phase-1-deploy.md § 1b.
//
// It reuses the deployed backfill core (functions/src/autohide.ts) verbatim —
// same active-only gate and same TRANSACTIONAL re-read guard — so it is
// idempotent (a second run hides nothing) and cannot undo an admin Clear-reports
// mid-sweep. firebase-admin is resolved from functions/node_modules (all imports
// there are lazy), so this needs only the built + installed functions package,
// no root install:
//
//   cd functions && npm install && npm run build && cd ..
//   GOOGLE_CLOUD_PROJECT=gaycruisebingo node scripts/backfill-hide.mjs           # every event
//   GOOGLE_CLOUD_PROJECT=gaycruisebingo node scripts/backfill-hide.mjs <eventId> # one event
//
// Credentials: a gitignored repo-root serviceAccountKey.json if present (cert),
// else Application Default Credentials (`gcloud auth application-default login`) —
// the SAME resolution as scripts/seed.mjs.
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

async function main() {
  // `/* @vite-ignore */` + a variable specifier keep this file import-safe: nothing
  // resolves the built functions bundle until it is actually run.
  const autohideModule = '../functions/lib/autohide.js';
  const { ensureAdminApp, runRolloutSweep } = await import(/* @vite-ignore */ autohideModule);

  // Mirror scripts/seed.mjs: read the repo-root serviceAccountKey.json when it
  // exists and authenticate with it; otherwise fall back to ADC. Parsing here (and
  // passing the object to ensureAdminApp) keeps the admin app initialized INSIDE
  // the functions package, so its getFirestore() sees the credential we set.
  const keyUrl = new URL('../serviceAccountKey.json', import.meta.url);
  const serviceAccountKey = existsSync(keyUrl) ? JSON.parse(readFileSync(keyUrl)) : undefined;
  await ensureAdminApp(serviceAccountKey);

  const eventId = process.argv[2] || undefined;
  const { events, hidden } = await runRolloutSweep(eventId);
  console.log(
    `rollout-hide: hid ${hidden} already-over-threshold doc(s) across ${events} event(s)` +
      `${eventId ? ` (event ${eventId})` : ''}.`,
  );
}

// Only run when executed directly (mirrors scripts/seed.mjs) — the `process.argv[1] &&`
// guard keeps this import-safe when argv[1] is undefined (e.g. `node --input-type=module
// -e "import(...)"`), so tooling/tests can import the module without it throwing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('rollout-hide failed', err);
    process.exit(1);
  });
}
