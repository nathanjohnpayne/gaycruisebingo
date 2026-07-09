---
spec_id: w1-attestation
status: accepted
---

# Persist the 18+ attestation as a timestamped profile attestation (w1-attestation)

Feature (#23): the 18+ acknowledgement was a local-only checkbox (`SignIn.tsx` `ack`) that gated only the sign-in button, was never written to Firestore, and so did not survive a reload or gate re-entry. It becomes a persisted `users/{uid}.attestedAdultAt` (ms-epoch) timestamp that gates first Event entry and re-prompts any signed-in User whose settled profile lacks it. Per ADR 0001 this is an honor-system self-attestation — we record the User's OWN statement, we never verify IDs.

## What already landed (staleness)

Two dependencies shipped before this ticket, so this ticket adds only the client persistence + the gate:

- **The type** — `UserDoc.attestedAdultAt?: number` already exists (`src/types.ts`, added by #16 and pinned by `src/data/w0-type-contract.test.ts`). This ticket consumes it and does not re-declare it.
- **The rule** — `users/{uid}` is already owner-writable and the owner self-write already shape-checks `attestedAdultAt` as a number (`firestore.rules`, the `allow create, update` block, from #18 and pinned by `tests/rules/w0-firestore-rules.test.ts`). The self-write is allowed BY DESIGN (ADR 0001): recording your own attestation is a self-statement, not identity verification. So **no firestore.rules change is required or made** — this ticket delivers the client half gated on the existing allowance, and `tests/rules/w1-attestation.test.ts` pins that allowance under this ticket's slug so a future "lock-down" of the self-write trips a named test.

## Contract

- `src/data/api.ts` (profile region only) adds two small functions and leaves `ensureUserProfile` (the #77-pinned create-only bootstrap) and the whole Mark path untouched:
  - `attestAdult(uid, now = Date.now())` persists the attestation inside a `runTransaction`, **create-only for the field**: it reads `users/{uid}`, and only when no numeric `attestedAdultAt` is already present does it `set({ attestedAdultAt: now }, { merge: true })`. An existing EARLIER stamp is never overwritten, so re-attesting keeps the first timestamp; the merge leaves the profile's other fields intact, and an absent row is created minimally (the owner may write it).
  - `readAdultAttestation(uid)` point-reads `users/{uid}` and returns the numeric `attestedAdultAt` when present, else `null` for a profile DEFINITIVELY without one (missing doc or missing field). It never writes.
- `src/auth/AuthContext.tsx` owns the gate/re-prompt (protected `src/auth/**` path — the change is minimal):
  - It tracks a **tri-state** `attested` for the current User: `undefined` = UNKNOWN (bootstrap unsettled or an indeterminate read), `true` = attested, `false` = a settled profile with no stamp. On every auth change the attestation re-arms to UNKNOWN, mirroring `profileReady` (#77); after `ensureUserProfile` settles it reads `readAdultAttestation`, and a thrown read stays UNKNOWN (never a re-prompt). Only the latest auth change settles it, and a value the User just attested optimistically is never downgraded.
  - `needsAttestation = user != null && profileReady && attested === false`. Because it is gated on `profileReady`, a missing stamp DURING load is UNKNOWN, not absent, so the prompt never flashes mid-bootstrap (the `knownFirstBingoAt` tri-state discipline). When `needsAttestation`, the provider renders the `SignIn` re-prompt in place of its children — full-screen, mirroring the signed-out gate `App` renders on `!user` — so the User is re-prompted BEFORE they reach the Board.
  - `attest()` persists the current User's attestation (`attestAdult(auth.currentUser.uid)`) and optimistically flips `attested` true so the gate lifts at once; a failed write stays optimistically attested for the session and re-attempts on the next sign-in (honor-system, never a hard gate). `signIn()` calls `attest()` after the Google popup, because the 18+ checkbox gated the sign-in — so a first-time User is not re-prompted for the box they just ticked.
- `src/components/SignIn.tsx` binds the one 18+ acknowledgement to a PERSISTED write in both entry points, so the ephemeral `ack` no longer gates entry on its own: signed OUT the checkbox gates Google sign-in (which persists after the popup); signed IN but un-attested (the re-prompt) the checkbox records the persisted self-attestation via `attest()` before the Board. It reads `user` from context to pick the mode and relabels its button accordingly ("Continue with Google" vs "Enter the event"). `DealError` is unchanged.

## Acceptance criteria

- Given a first-time User, when they attest 18+ and sign in, then `users/{uid}.attestedAdultAt` is persisted (via `signIn` → `attest`) and survives a reload — the gate reads it back and lets them through. (Tests: "attesting persists the timestamp" data-layer; "lets an already-attested User pass straight through to the Board" gate.)
- Given a User whose settled profile has no `attestedAdultAt`, when they return, then they are re-prompted before entering the Event. (Test: "re-prompts a signed-in User whose settled profile lacks attestedAdultAt".)
- Given the profile bootstrap is still in flight, when the attestation is not yet known, then the prompt is NOT shown (UNKNOWN ≠ absent), and it appears only once the bootstrap settles without a stamp. (Test: "does not flash the prompt while the profile bootstrap is still in flight".)
- Given a User who already attested earlier, when they attest again, then the earlier timestamp is preserved (create-only for the field). (Test: "never overwrites an existing EARLIER attestation".)
- Given the owner records their own numeric `attestedAdultAt`, then the existing self-write allows it, while a cross-user write or a non-numeric value is denied. (Tests: the `tests/rules/w1-attestation.test.ts` owner/non-owner/shape cases.)
- Attestation is a User-level self-write (ADR 0001), not a verification check; no firestore.rules change ships with this ticket.

## Test coverage

- `src/data/w1-attestation.test.ts` (Vitest, Firestore boundary mocked) drives the REAL `attestAdult` and `readAdultAttestation`: attesting stamps `attestedAdultAt`; an existing earlier stamp is never overwritten; a missing row is created; the read reports the stamp or `null`.
- `tests/rules/w1-attestation.test.ts` (Vitest, Firestore emulator) pins the EXISTING owner self-write: the owner may create/update their own `attestedAdultAt` as a number, a non-owner may not write another User's, and a non-numeric value is denied by the shape guard.
- `src/components/w1-attestation.test.tsx` (Vitest RTL-jsdom) mounts the real `AuthProvider` + `SignIn` with the Firebase/data boundary mocked: a no-attestation User is re-prompted after settle; an attested User passes straight through; the loading state does not flash the prompt; and attesting from the re-prompt lifts the gate.
