---
spec_id: x-offline-cold-boot
status: accepted
---

# Offline cold boot: render the cached app without awaiting network-bound auth bootstrap

[ADR 0006](../docs/adr/0006-offline-resilience.md) makes the DATA layer offline-durable — the persistent IndexedDB cache renders the last-seen Board/Feed/Tally and Marks queue durably — but the BOOT path was online-only, inverting that promise. After an offline reload the app stuck on "Loading…" indefinitely: `AuthContext`'s `onAuthStateChanged` callback `await`ed `ensureUserProfile` (a Firestore **transaction**, which needs the network and never resolves offline — transactions do not queue) and then `readAdultAttestation` (a server point read) BEFORE it ever published `loading: false`. The service worker served the shell and the durable Mark queue survived, but the UI never rendered the cached Board. Worse, once the bootstrap had failed offline, post-reconnect recovery was nondeterministic (~1-in-3 flake in the #47 e2e diagnostics).

This ticket moves the network-bound bootstrap OFF the render-critical path: the signed-in User (restored by Firebase from its own IndexedDB persistence, which works offline) is published and `loading: false` settled IMMEDIATELY, the 18+ gate settles cache-first, and the transaction + server read run non-blocking and offline-tolerant — deferred while offline and re-run deterministically on reconnect. It does this WITHOUT weakening the 18+ attestation gate (#23/#112): cache-first can only ever LIFT the gate on a real cached stamp, never assume-attested.

## Design invariants preserved

- The `attested` tri-state (#112): `undefined` = UNKNOWN, `true` = attested, `false` = a SETTLED profile with no stamp → re-prompt. Offline cache-first only ever settles `true` (on a genuine stamp) or leaves UNKNOWN — it NEVER settles `false` and NEVER assumes `true`.
- The `profileReady` bootstrap-settled signal (#77) re-arms per auth change and stays `false` until the bootstrap actually settles; offline it stays `false` (the bootstrap is deferred, not settled), so a profile-writing consumer still waits and the re-prompt never flashes mid-load.
- The `attestedUidsRef` sticky optimistic attestation (#112 Finding 3) still wins over any later settle.
- The deal side-effect gate (#112 Finding 1): the deal fires only when `attested === true`; it is additionally gated on connectivity so it never fires offline (a deal is a network-bound create path), and never for a returning boarded User (their board is cached; `joinAndDeal` early-returns).

## Acceptance criteria → test cases

Unit tests: `src/auth/x-offline-cold-boot.test.tsx` (the REAL `AuthProvider` under jsdom, with the Firebase + data-layer boundary mocked and connectivity driven by hand via `navigator.onLine` + the `online` event).

- **Given** a signed-in returning User and NO network, **when** the app cold-boots (the auth callback fires with the persisted User while `ensureUserProfile` — a transaction — would never resolve), **then** the User is published and `loading: false` settles immediately, the cached Board renders, and the transaction is never even reached (deferred, not awaited). → `publishes the User and settles loading:false without awaiting the network transaction`.
- **Given** an offline cold boot whose returning User has a CACHED 18+ attestation, **then** the gate settles from cache (no re-prompt, Board renders) and the deal defers; and cache-first settled it genuinely `true` — a later reconnect whose server read (contrived) reports NO stamp still shows no re-prompt, proving the cache value settled `true` rather than leaving it UNKNOWN. → `settles the 18+ gate offline from a cached attestation, and cache-first never fails it open on the server's word`.
- **Given** an offline cold boot with NO cached attestation, **then** the gate stays UNKNOWN — the Board renders (never blocked), no re-prompt flashes, the deal defers — and on reconnect the deferred bootstrap runs exactly once, the server settles the attestation, and the deferred deal fires (deterministic recovery, no pending transaction racing the supersede logic). → `leaves attestation UNKNOWN with no cached stamp — the gate holds, the deal defers, and reconnect recovers deterministically`.
- **Given** an offline cold boot with attestation absent everywhere, **when** the network returns and the server reports a genuinely UN-attested profile, **then** the gate HOLDS as a definite re-prompt and never fails open into a deal — proving offline cache-first never assumed attested. → `does NOT fail the age gate open offline: with no attestation anywhere, reconnect settles the re-prompt and never deals`.
- **Given** an ONLINE genuinely-new attested User, **then** the deal still fires as before. → `online: a genuinely-new attested User still deals`.

The end-to-end proof that the cached Board actually RENDERS after an OFFLINE reload (not merely that the Mark is durable) lives in the #47 suite — see `specs/x-e2e-happy-path.md` (the offline case now asserts the cold-booted, offline-reloaded page renders the cached Mark), upgraded from the App-gap workaround this ticket closes.
