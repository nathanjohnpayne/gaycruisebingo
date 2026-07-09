import { collection, doc, setDoc } from 'firebase/firestore';
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

/**
 * Raise a Doubt against another Player's marked Prompt.
 *
 * Attribution reuses the SAME saved-player pattern the Tally marker + Moment use
 * (`markerDisplayName`, src/data/attribution.ts — not forked): the caller passes
 * the resolved public identity (Board runs the saved player-row name through
 * `resolveDisplayName`, the validated resolver `joinAndDeal` uses), bounded here
 * to the rules' non-empty ≤100 contract so a name can never poison the write. The
 * target's name is already known from the Tally marker row the Doubt is raised
 * against; both fall back to 'Anonymous' when unknown, never to a stale value.
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
 * neither writes nor fires analytics. The doc's `id` is the auto-generated doc id
 * (the converter pins it on read), so nothing stores `id`; `satisfied*` is left
 * absent because satisfaction is DERIVED from Proofs (see `isDoubtSatisfied`),
 * not written here.
 *
 * Fires the `demand_proof` GA4/PostHog event via `track()` on a genuine raise —
 * one of the two PRD events the pre-Doubt catalog was missing.
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
}

export function raiseDoubt(args: RaiseDoubtArgs): void {
  const { fromUid, targetUid, itemId, cellIndex } = args;
  // No self-doubt (ADR 0001 + rules `targetUid != auth.uid`): a no-op, so neither
  // a write nor the analytics event fires for a nonsensical raise.
  if (fromUid === targetUid) return;

  const ref = doc(rawDoubts());
  const payload: Omit<DoubtDoc, 'id'> = {
    itemId,
    cellIndex,
    fromUid,
    fromDisplayName: markerDisplayName(args.fromDisplayName, undefined),
    targetUid,
    targetDisplayName: markerDisplayName(args.targetDisplayName, undefined),
    createdAt: Date.now(),
  };

  void setDoc(ref, payload).catch((err: unknown) => {
    // Not the offline case: offline the write PENDS in the persistent cache and
    // drains on reconnect (ADR 0006). A rejection is a genuine online failure
    // (permission/auth, or a rules-rejected shape). It must not vanish silently
    // (a Doubt is fire-and-forget, but observability matters), yet it is never a
    // retry surface — a Doubt is social pressure, not a gate.
    console.error('[doubts] raiseDoubt rejected', { fromUid, targetUid, itemId }, err);
  });

  // The Doubt-flow GA4/PostHog event (#33), fired at the single raise call site.
  track('demand_proof', { itemId });
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
 * Whether `doubt` has been answered by one of `proofs`: the doubted Player
 * (`targetUid`) has a Proof for the same Prompt (`itemText`) created at or after
 * the Doubt. Pure — no Firestore, no clock — so the truth table is unit-testable
 * and the count/status derivations below share one definition of "answered".
 */
export function isDoubtSatisfied(
  doubt: Pick<DoubtDoc, 'targetUid' | 'createdAt'>,
  itemText: string,
  proofs: readonly Pick<ProofDoc, 'uid' | 'itemText' | 'createdAt'>[],
): boolean {
  return proofs.some(
    (p) => p.uid === doubt.targetUid && p.itemText === itemText && p.createdAt >= doubt.createdAt,
  );
}

/**
 * The OPEN (unanswered) Doubts among `doubts` for a Prompt whose text is
 * `itemText`, given the Feed's `proofs`. The Square badge + Tally-sheet summary
 * both read `.length` of this — the single per-Prompt open-Doubt total (ADR 0002:
 * the count surfaces identically in both places).
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
