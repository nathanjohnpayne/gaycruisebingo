import { collection, doc, getDocFromCache, setDoc } from 'firebase/firestore';
import { db, EVENT_ID } from '../firebase';
import { markerDisplayName } from './attribution';
import { track } from '../analytics';
import type { DoubtDoc, ProofDoc } from '../types';

// Doubts (ADR 0001): a Doubt is one Player publicly asking another to back up a
// specific marked Prompt — "pics or it didn't happen". It is the honor-system
// "the group is the verification" principle applied in-app: SOCIAL PRESSURE,
// NEVER A GATE. A Doubt never blocks, unmarks, or discounts the Mark, and never
// touches the Leaderboard — there is no Claim-like pending state. Attaching a
// Proof merely SATISFIES it, a social resolution the count reflects as open vs
// answered. `DoubtDoc` + the `doubts` rules block ship from #16/#18; this module
// is the create + read-derivation half.
//
// Raw (converter-free) doubts ref for writes, matching api.ts's rawPlayer/rawBoard,
// proofs.ts's rawProof, and moments.ts's rawMoment — the read side attaches
// `doubtConverter` via `doubtsCol`/`doubtRef` (src/data/paths.ts).
const rawDoubts = () => collection(db, 'events', EVENT_ID, 'doubts');
// Raw player-row ref for the cached-identity fallback (Codex P2, PR #106 round 2
// finding 3) — the same doc setMark reads its fallback attribution from (api.ts).
const rawPlayer = (uid: string) => doc(db, 'events', EVENT_ID, 'players', uid);

/**
 * The deterministic Doubt doc id — ONE slot per (doubter, target, Prompt) triple
 * (Codex P2, PR #106 round 2 finding 2). Cross-client duplicates (two tabs/devices
 * that each passed the local `currentlyOpen` check before either write echoed)
 * collapse onto this one doc: the second write is a doc-exists `update`, which the
 * rules deny for the doubter (only the target may touch `satisfied*`; only an
 * admin more), so the open count can never inflate. `_` joins the triple — it
 * appears in no Firebase-minted uid or Firestore auto-id (the repo's own uid
 * fixtures contain `-`), echoing the `first_bingo` singleton — and the id is
 * CONSTRUCTED, never parsed. The create rule BINDS the id to the payload triple
 * (firestore.rules § doubts, mirroring the moments id↔kind binding #103/#105), so
 * another Player cannot squat this doubter's slot and deny their raise.
 */
export function doubtDocId(fromUid: string, targetUid: string, itemId: string): string {
  return `${fromUid}_${targetUid}_${itemId}`;
}

/**
 * The denormalized display name on the CACHED player row (a local, never-network
 * read) — the SAME fallback attribution `setMark` uses (src/data/api.ts): when the
 * caller could not supply a KNOWN identity, the saved row on this device is still
 * the right public name, and only a genuine cache miss falls through to
 * `markerDisplayName`'s 'Anonymous'. Never rejects.
 */
async function cachedPlayerName(uid: string): Promise<unknown> {
  try {
    const snap = await getDocFromCache(rawPlayer(uid));
    return snap.exists() ? (snap.data() as { displayName?: unknown }).displayName : undefined;
  } catch {
    return undefined; // not cached on this device
  }
}

/**
 * Raise a Doubt against another Player's marked Prompt.
 *
 * Attribution reuses the SAME saved-player pattern the Tally marker + Moment use
 * (`markerDisplayName`, src/data/attribution.ts — not forked): the caller passes
 * the resolved public identity (Board runs the saved player-row name through
 * `resolveDisplayName`, the validated resolver `joinAndDeal` uses), bounded here
 * to the rules' non-empty ≤100 contract so a name can never poison the write.
 * When the caller has NO known identity (Board's `identityKnown` gate passes
 * `undefined` during the player-row loading window), the fallback is the CACHED
 * player row's denormalized name — the same fallback `setMark` uses — before
 * 'Anonymous', never a possibly-stale auth name (Codex P2, PR #106 round 2
 * finding 3; the UI additionally disables the affordance until identity is known,
 * because a Doubt is a public, PERMANENT accusation record). The target's name is
 * already known from the Tally marker row the Doubt is raised against.
 *
 * Offline-queueable, fire-and-forget, mirroring the mark path's style (`setMark`
 * in src/data/api.ts, `broadcast` in src/data/moments.ts): a plain `setDoc` —
 * NOT a `runTransaction`, which needs a server round-trip and rejects offline —
 * pends durably in the persistent cache when offline (ADR 0006) and drains on
 * reconnect, and the promise is intentionally NOT awaited so raising never blocks
 * the UI. An ONLINE rejection is logged (never silently swallowed) rather than
 * surfaced as a retry — a Doubt is low-stakes social pressure, not a gate.
 *
 * A self-doubt (fromUid === targetUid) is a no-op here — the rules deny it too
 * (`targetUid != request.auth.uid`) — so the UI never offers it and a stray call
 * neither writes nor fires analytics. The doc id is the DETERMINISTIC
 * `doubtDocId` slot (round 2 finding 2; the converter pins `id` on read), so
 * nothing stores `id`; `satisfied*` is left absent because satisfaction is
 * DERIVED from Proofs (see `isDoubtSatisfied`), not written here.
 *
 * Fires the `demand_proof` GA4/PostHog event via `track()` on a genuine raise —
 * one of the two PRD events the pre-Doubt catalog was missing. A skipped
 * duplicate (local guard, cache pre-check, or the rules' once-only denial) fires
 * nothing, so the event count cannot inflate either.
 */
export interface RaiseDoubtArgs {
  fromUid: string;
  // The doubter's resolved public identity (saved player-row name + auth). Passed
  // only when KNOWN (Board's `identityKnown` gate); undefined falls back to
  // 'Anonymous' via `markerDisplayName`, never a possibly-stale auth name.
  fromDisplayName?: string;
  targetUid: string;
  // The doubted Player's public name — known from the Tally marker row.
  targetDisplayName?: string;
  itemId: string;
  // The Square the Doubt was raised from (the doubter's own board cellIndex for
  // the Prompt). Kept for context + the rules' `cellIndex is number` shape check;
  // satisfaction is derived on (targetUid, Prompt), never on this index — the
  // target's own cellIndex is private to their Board (firestore.rules), so a
  // cross-board index match is neither available nor needed.
  cellIndex: number;
  // Belt-and-braces duplicate guard (Codex P2, PR #106 finding 1): the caller may
  // pass the Prompt's currently-OPEN Doubts (the same set the Tally sheet already
  // derives). If one from THIS doubter against THIS target for THIS Prompt is
  // already present, the raise is a no-op — no duplicate doc, no second
  // `demand_proof`. This backstops the UI's synchronous per-target pending guard
  // for a duplicate that slips through only AFTER the first Doubt has echoed into
  // the subscription; the immediate double-tap is stopped in the component, and
  // the deterministic `doubtDocId` slot (round 2 finding 2) is the STRUCTURAL
  // backstop beneath both for whatever remains (cross-tab/device races).
  currentlyOpen?: readonly Pick<DoubtDoc, 'fromUid' | 'targetUid' | 'itemId'>[];
}

/**
 * Returns the settle promise of the raise — already `.catch`-logged, so it
 * RESOLVES even on an online rejection and never rejects — so the caller can
 * clear its per-target pending state when the write settles (Codex P2, PR #106
 * finding 1); a no-op raise (self-doubt, an existing open duplicate, or a slot
 * already in the local cache) resolves without writing. Still fire-and-forget:
 * the caller does not await it, so raising never blocks the UI.
 */
export async function raiseDoubt(args: RaiseDoubtArgs): Promise<void> {
  const { fromUid, targetUid, itemId, cellIndex, currentlyOpen } = args;
  // No self-doubt (ADR 0001 + rules `targetUid != auth.uid`): a no-op, so neither
  // a write nor the analytics event fires for a nonsensical raise.
  if (fromUid === targetUid) return;
  // Idempotence backstop (finding 1): an OPEN Doubt by this doubter against this
  // target for this Prompt already exists in the subscription — raising again
  // would only be denied by the once-only slot below, so skip the write and the
  // analytics event without any cache read.
  if (
    currentlyOpen?.some(
      (d) => d.fromUid === fromUid && d.targetUid === targetUid && d.itemId === itemId,
    )
  ) {
    return;
  }

  const ref = doc(rawDoubts(), doubtDocId(fromUid, targetUid, itemId));
  // Write-once cache pre-check (round 2 finding 2), mirroring writeMomentOnce
  // (src/data/moments.ts): the rules deny a duplicate slot server-side, but
  // Firestore applies latency compensation FIRST — a duplicate setDoc would
  // locally overwrite the cached Doubt with a refreshed `createdAt` (flipping a
  // satisfied Doubt back to open until the denial rolls it back — indefinitely
  // while offline, where no denial ever arrives). If the slot is already in the
  // LOCAL cache, skip the write entirely: the designed once-only path doing its
  // job, not an error — debug log, no `demand_proof`.
  try {
    const cached = await getDocFromCache(ref);
    if (cached.exists()) {
      console.debug('[doubts] raise skipped — Doubt already in local cache', {
        fromUid,
        targetUid,
        itemId,
      });
      return;
    }
  } catch {
    // Not in the local cache — no duplicate to protect; proceed with the write.
  }

  const payload: Omit<DoubtDoc, 'id'> = {
    itemId,
    cellIndex,
    fromUid,
    // The cached player row is the fallback identity (round 2 finding 3) — the
    // same second argument setMark passes markerDisplayName (api.ts): preferred
    // saved name first, this device's cached row next, 'Anonymous' last.
    fromDisplayName: markerDisplayName(args.fromDisplayName, await cachedPlayerName(fromUid)),
    targetUid,
    targetDisplayName: markerDisplayName(args.targetDisplayName, undefined),
    createdAt: Date.now(),
  };

  const settled = setDoc(ref, payload).catch((err: unknown) => {
    // Not the offline case: offline the write PENDS in the persistent cache and
    // drains on reconnect (ADR 0006). A permission denial here is, by
    // construction, the once-only slot doing its job — a COLD-cache cross-client
    // duplicate landing on the doc-exists `update` rule (round 2 finding 2): this
    // module's payload satisfies the create rule by construction (own fromUid,
    // bound id, bounded names, near-now createdAt), so the only other deny on
    // this path is the documented >24h offline-drain residual. Benign either
    // way — debug, not error, mirroring writeMomentOnce's skip log. Anything
    // else is a genuine online failure and must not vanish silently, yet it is
    // never a retry surface — a Doubt is social pressure, not a gate.
    if ((err as { code?: unknown } | null)?.code === 'permission-denied') {
      console.debug('[doubts] raise denied — slot already raised (once-only backstop)', {
        fromUid,
        targetUid,
        itemId,
      });
      return;
    }
    console.error('[doubts] raiseDoubt rejected', { fromUid, targetUid, itemId }, err);
  });

  // The Doubt-flow GA4/PostHog event (#33), fired at the single raise call site —
  // a GENUINE raise only (every skipped duplicate above fires nothing).
  track('demand_proof', { itemId });
  return settled;
}

// ---- Satisfied-by-Proof: PURE DERIVATION (ADR 0001) ----
//
// A Doubt is SATISFIED when the doubted Player attaches a Proof for the same
// Prompt at or after the Doubt was raised. This is derived from the Proofs the
// Feed already subscribes to — no write is added to `attachProof`, and the Doubt
// docs are never mutated on satisfaction (`satisfied*` stays absent). Deriving,
// not gating, is the whole point: an open Doubt applies social heat; an answered
// one cools it; NEITHER ever blocks, unmarks, or discounts the Mark.
//
// The join key is (target Player, Prompt), NOT cellIndex: a ProofDoc is keyed by
// (uid, cellIndex, itemText) with no itemId, and the target's cellIndex is on
// their PRIVATE Board (firestore.rules) — unknowable to the doubter — so a
// cross-board cellIndex match is impossible. The Prompt is matched by `itemText`
// (the caller passes the Prompt's text, which it always has on the Square/Tally),
// which is stable because items are immutable once created (only `reportCount`
// changes). Residual: two distinct Prompts sharing identical text on one Player's
// Board would alias — vanishingly rare, and harmless for a social count that
// never gates play (documented in specs/w2-doubts.md).

/**
 * How much a Proof may PREDATE a Doubt and still answer it: exactly the forward
 * clock-skew the rules grant every client-set `createdAt` (+60s of request.time —
 * firestore.rules, the doubts/proofs/moments bound). A doubter clock fast by up
 * to 60s stores a future stamp the rules ACCEPT; the target's immediate, honest
 * Proof (normal clock) then lands numerically BEFORE it, and without this
 * tolerance the Doubt stays open until a SECOND Proof (Codex P2, PR #106 round 2
 * finding 1). Within the skew window the true order of two stamps is unknowable
 * anyway, so a Proof up to 60s "older" than the Doubt satisfies — the honest
 * reading of "at or after" under bounded clocks.
 */
export const DOUBT_SATISFACTION_SKEW_MS = 60_000;

/**
 * Whether `doubt` has been answered by one of `proofs`: the doubted Player
 * (`targetUid`) has a Proof for the same Prompt (`itemText`) created at or after
 * the Doubt, within the rules' clock-skew tolerance. Two guards shape the cutoff:
 * it is CLAMPED to no-later-than `now` (Codex P2, PR #106 finding 3 — the rules
 * bound a Doubt's `createdAt` near request.time, but as defense-in-depth a Doubt
 * that somehow carries a far-future stamp, e.g. a doc written before that bound
 * shipped, must not be rendered permanently UNANSWERABLE: any Proof from `now`
 * onward answers it, while a normal past-dated Doubt is unaffected since `min` is
 * its own stamp); and the comparison tolerates `DOUBT_SATISFACTION_SKEW_MS` of
 * doubter-clock skew (round 2 finding 1 — a Proof at or after `cutoff - skew`
 * satisfies, so an immediate Proof against a fast-but-rules-legal Doubt stamp is
 * not rejected). `now` is injected (defaulting to the wall clock) purely so the
 * truth table stays deterministic; the derivations below share this one
 * definition of "answered".
 */
export function isDoubtSatisfied(
  doubt: Pick<DoubtDoc, 'targetUid' | 'createdAt'>,
  itemText: string,
  proofs: readonly Pick<ProofDoc, 'uid' | 'itemText' | 'createdAt'>[],
  now: number = Date.now(),
): boolean {
  const cutoff = Math.min(doubt.createdAt, now);
  return proofs.some(
    (p) =>
      p.uid === doubt.targetUid &&
      p.itemText === itemText &&
      p.createdAt >= cutoff - DOUBT_SATISFACTION_SKEW_MS,
  );
}

/**
 * The OPEN (unanswered) subset of `doubts`, matched against `itemText` + `proofs`.
 * Generic over whatever `doubts` the caller passes in — it does not itself decide
 * "open count for whom". The Square badge (Board.tsx `DoubtBadge`) pre-filters its
 * input to Doubts targeting the Square's own marker before calling this, so an
 * un-doubted Player's Square never shows another marker's open Doubt on the same
 * shared-pool Prompt (ADR 0002); the Tally-sheet header instead passes the FULL
 * per-Prompt set for a Prompt-wide heat summary. Both then read `.length`.
 */
export function openDoubts<T extends Pick<DoubtDoc, 'targetUid' | 'createdAt'>>(
  doubts: readonly T[],
  itemText: string,
  proofs: readonly Pick<ProofDoc, 'uid' | 'itemText' | 'createdAt'>[],
): T[] {
  return doubts.filter((d) => !isDoubtSatisfied(d, itemText, proofs));
}

export type DoubtStatus = 'none' | 'open' | 'satisfied';

/**
 * One Player's Doubt status for a Prompt, for their Tally-sheet row: `'open'` if
 * ANY Doubt against them is still unanswered, `'satisfied'` if they have Doubt(s)
 * all answered by a Proof, `'none'` if no one has doubted them. The sheet renders
 * open vs satisfied distinctly — social pressure applied, then visibly cooled —
 * without ever gating the Mark.
 */
export function doubtStatusFor(
  uid: string,
  doubts: readonly Pick<DoubtDoc, 'targetUid' | 'createdAt'>[],
  itemText: string,
  proofs: readonly Pick<ProofDoc, 'uid' | 'itemText' | 'createdAt'>[],
): DoubtStatus {
  const against = doubts.filter((d) => d.targetUid === uid);
  if (against.length === 0) return 'none';
  const anyOpen = against.some((d) => !isDoubtSatisfied(d, itemText, proofs));
  return anyOpen ? 'open' : 'satisfied';
}
