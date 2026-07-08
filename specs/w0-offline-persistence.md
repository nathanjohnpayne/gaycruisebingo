# w0-offline-persistence — durable Firestore offline cache (ADR 0006)

Deliver the data half of ADR 0006: replace `getFirestore(app)` in `src/firebase.ts` with `initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) })` so the last-seen Board/Feed/Tally render offline and Marks made in a ship-wifi dead zone queue durably (in IndexedDB, in the browser) and sync on reconnect — instead of the default in-memory cache, which loses queued writes on reload. The Workbox shell precache is already wired; this adds the durable data cache the offline-durable Marks of `w1-board-mark-win` build on.

## The change

`src/firebase.ts` swaps the cache constructor and keeps the same `export const db` symbol, so no call site changes (the `src/data/paths.ts` refs and every consumer compile unchanged). The multi-tab manager coordinates the shared cache when a Player has the PWA open in several tabs.

## Claim → test

Every claim below maps to an assertion in the named test (no vacuous coverage), mirroring the layering `w0-test-harness` established.

### Source config — `src/firebase.ts` requests a persistent local cache

Runner: `npm test` (Vitest, jsdom project). Test: `src/firebase.test.ts`.

- `db` is a real Firestore instance (`db.type === 'firestore'`), so the unchanged export means no call site is edited — asserted alongside the cache kind. The `npm run build` + `npm run typecheck` gates confirm the existing consumers still compile against the same `db`.
- `db`'s configured local cache is persistent (internal `_settings.localCache.kind === 'persistent'`), not the default in-memory cache (`getFirestore` leaves `localCache` undefined; `'memory'` would be a regression to a queue that cannot survive a reload). This is the durable primitive: in a browser the persistent cache lives in IndexedDB across reloads.

### Offline behavior — queue while offline, sync on reconnect, survive a reload

Runner: `firebase emulators:exec --only auth,firestore "vitest run --config vitest.offline.config.ts"` (Node env, `vitest.offline.config.ts`, scoped to `tests/offline/**`). Test: `tests/offline/w0-offline-persistence.test.ts`.

- A Mark written while offline (`disableNetwork`) lands in the local cache and surfaces to a listener as a pending, from-cache write — `metadata.hasPendingWrites === true`, `metadata.fromCache === true` — with the marked Square set. (The `setDoc` promise itself is intentionally not awaited here: offline it only resolves after a server ack, so the write is observed via the cache snapshot instead.)
- On reconnect (`enableNetwork` + `waitForPendingWrites`), the queued Mark drains to Firestore: a server read (`getDocFromServer`) returns it fresh — `metadata.fromCache === false`, `metadata.hasPendingWrites === false` — with the Square still marked.
- After a simulated reload — terminate the client, then bring a fresh one up signed in as the same player — the reloaded client reads the Mark back, so it survived the restart.

## Scope and environment (honest bounds)

- Node has no IndexedDB, so under the emulator harness the SDK transparently falls back to an in-memory cache (logged: "Falling back to memory cache"). The offline → reconnect → reload round trip above is cache-agnostic and runs on that fallback; the durable-across-reload guarantee is carried by the source-config guard (the app *requests* persistentLocalCache, which is durable in a real browser). The one case that is IndexedDB-only — a reload while STILL offline, before any sync — is left to the browser e2e layer.
- Out of scope (per ADR 0006): the first-ever join needs connectivity (dealing reads the prompt pool), and proof media (Cloud Storage) still needs signal — an offline Mark queues and its media attaches on reconnect, which is `w2-proof-capture`. This ticket ships only the cache primitive.
- These app tests are not CI-run; they are recorded in the commit `Verified:` trailer.

## Acceptance criteria

- Given `persistentLocalCache` + the multi-tab manager, when a Player Marks a Square offline and reconnects, then the Mark persists locally as a pending write and syncs to Firestore (ADR 0006; PRD offline-mark-survives-reload) — `tests/offline/w0-offline-persistence.test.ts`.
- Given the swap keeps `export const db`, when the app builds, then no call site changes are required — `db.type === 'firestore'` in `src/firebase.test.ts`, plus green `npm run build` and `npm run typecheck`.
- Given the durable cache config, then `db`'s configured cache kind is `persistent`, not memory or the default — `src/firebase.test.ts`.
