---
spec_id: x-offline-cold-boot
status: accepted
---

# Offline cold boot: render the cached app without awaiting network-bound auth bootstrap

[ADR 0006](../docs/adr/0006-offline-resilience.md) makes the DATA layer offline-durable — the persistent IndexedDB cache renders the last-seen Board/Feed/Tally and Marks queue durably — but the BOOT path was online-only, inverting that promise. After an offline reload the app stuck on "Loading…" indefinitely: `AuthContext`'s `onAuthStateChanged` callback `await`ed `ensureUserProfile` (a Firestore **transaction**, which needs the network and never resolves offline — transactions do not queue) and then `readAdultAttestation` (a server point read) BEFORE it ever published `loading: false`. The service worker served the shell and the durable Mark queue survived, but the UI never rendered the cached Board. Worse, once the bootstrap had failed offline, post-reconnect recovery was nondeterministic (~1-in-3 flake in the #47 e2e diagnostics).

This ticket makes auth bootstrap a **connectivity/attestation state machine** whose organizing principle is: the persistent cache lifts the 18+ gate **provisionally while offline**, and the server read is **authoritative when it arrives**. It renders the cached app offline without ever awaiting a network-bound bootstrap, WITHOUT weakening the 18+ attestation gate (#23/#112).

## The state machine

- **Auth change (the render decision).** The callback publishes the User and re-arms the gate (`attested` UNKNOWN, `profileReady` false) synchronously, then splits on connectivity:
  - **Offline** → publish `loading: false` IMMEDIATELY so the cached Board paints now; the bootstrap is deferred.
  - **Online** → keep `loading: true` (stay gated on "Loading…") until the authoritative bootstrap settles the age gate — an un-attested returning User with a cached board must NOT view the Event during the read. `bootstrapUser` releases the hold with `loading: false` when it settles.
- **Bootstrap (off the render path).**
  - **Offline** → settle the gate CACHE-FIRST via `readAdultAttestationFromCache` (`getDocFromCache`): a cached stamp (or a same-session optimistic attest) lifts it to `true`; a cache miss or a definite-unstamped row leaves it UNKNOWN. It only ever lifts to `true` on a real stamp — cache-first can neither block render nor fail the age gate open — and never settles `false` offline (no re-prompt flash). `ensureUserProfile` (a transaction) and the server read are deferred to reconnect.
  - **Online** → run the AUTHORITATIVE bootstrap (`ensureUserProfile` + server `readAdultAttestation`). The server value is definitive: a present stamp settles `true`, a MISSING stamp settles `false` — DOWNGRADING even a provisional cache lift (e.g. a deleted/recreated `users/{uid}` row) to a re-prompt. The only sticky override is `attestedUidsRef` (this session's own optimistic attest, #112 Finding 3), never a stale cache value. A genuine network FAILURE (thrown despite `navigator.onLine`) is not authoritative: it surfaces the retryable `dealError` and leaves attestation as-is.
- **Reconnect.** A React `online` state, mirrored from the browser `online`/`offline` events, (a) re-runs `bootstrapUser` once under the `profileAttemptRef` guard to finish deferred work, and (b) flips the deal effect's dependency so the DEFERRED deal fires — a globally-attested User who cold-boots offline onto a FRESH Event (no cached board) deals exactly once when the network returns.
- **Deal gate.** The deal fires only when `attested === true` AND the reactive `online` state is true. It never fires offline; a returning boarded User re-runs `joinAndDeal` on reconnect but its board-exists early-return makes that a no-op.

## Design invariants preserved

- The `attested` tri-state (#112): `undefined` = UNKNOWN, `true` = attested, `false` = SETTLED-without-stamp → re-prompt. Cache-first only ever settles `true` (on a genuine stamp) offline; the authoritative `false` comes only from the server read.
- The `profileReady` bootstrap-settled signal (#77) re-arms per auth change and stays `false` until the bootstrap actually settles; offline it stays `false` (deferred, not settled).
- The `attestedUidsRef` sticky optimistic attestation (#112 Finding 3) still wins over any later settle — including a server read that has not yet seen the write.
- The deal side-effect gate (#112 Finding 1): the deal fires only for an attested User, never for a returning boarded User (board-exists early-return), never offline.

## Acceptance criteria → test cases

Unit tests: `src/auth/x-offline-cold-boot.test.tsx` (the REAL `AuthProvider` under jsdom, with the Firebase + data-layer boundary mocked and connectivity driven by hand via `navigator.onLine` + the `online` event). `loading` is asserted as the proxy for App.tsx's Board gate (App renders "Loading…" while `loading`, the Board only once it is false).

- **Given** a signed-in returning User and NO network, **when** the app cold-boots (the auth callback fires with the persisted User while `ensureUserProfile` — a transaction — would never resolve), **then** the User is published and `loading: false` settles immediately, the cached Board renders, and the transaction is never even reached. → `publishes the User and settles loading:false without awaiting the network transaction`.
- **Given** an ONLINE session for an un-attested returning User, **then** the app stays GATED on Loading (Board not rendered) while the server read is in flight, and only re-prompts once the authoritative read settles — never showing the Event during the read. → `finding B: an ONLINE un-attested session stays gated on Loading until the server read settles, THEN re-prompts`.
- **Given** an OFFLINE cold boot whose returning User has a CACHED attestation, **then** the cached Board renders immediately (loading released, no re-prompt, deal deferred). → `finding B (offline half): a cache-attested returning User renders the cached Board immediately offline`.
- **Given** a cache-attested User with NO board for the current Event (a globally-attested User joining a fresh sailing), booting offline, **then** the deal defers offline and fires exactly once on reconnect. → `finding C: a cache-attested User with no board for the Event defers the deal offline and fires it exactly once on reconnect`.
- **Given** an offline cold boot whose STALE cached stamp provisionally lifted the gate, **when** the network returns and the authoritative server read reports NO stamp, **then** the gate DOWNGRADES to a re-prompt (and never deals). → `finding D: an authoritative server read with NO stamp downgrades a stale cache lift to a re-prompt on reconnect`.
- **Given** the same provisional lift, **when** the authoritative read CONFIRMS the stamp, **then** the User stays attested and deals. → `finding D: an authoritative server read that CONFIRMS the stamp keeps the User attested`.
- **Given** a same-session optimistic attest (#112 Finding 3), **when** a later auth callback's server read does not yet see the write (returns no stamp), **then** the gate stays attested (sticky), NOT downgraded. → `#112 preserved: a same-session optimistic attest stays sticky even when the server read returns no stamp`.
- **Given** an offline cold boot with attestation absent everywhere, **then** it never assumes attested (UNKNOWN, held, no deal); and on reconnect a genuinely-un-attested server read settles a definite re-prompt, never a fail-open deal. → `does NOT fail the age gate open offline: no attestation anywhere means UNKNOWN, held, and never a deal`.
- **Given** an ONLINE genuinely-new attested User, **then** the deal still fires as before. → `online: a genuinely-new attested User still deals`.

The end-to-end proof that the cached Board actually RENDERS after an OFFLINE reload (not merely that the Mark is durable) lives in the #47 suite — see `specs/x-e2e-happy-path.md` (the offline case now asserts the cold-booted, offline-reloaded page renders the cached Mark), upgraded from the App-gap workaround this ticket closes.
