// ADR 0004 Phase 0 community auto-hide — the ONE pure predicate shared by every
// surface that must agree on "is this content community-hidden". It lives in this
// Firestore-free, React-free module so BOTH the read hooks (src/hooks/useData.ts,
// which re-exports it) and the deal path (src/data/api.ts's joinAndDeal, which
// must NOT import React) apply the identical test — a new Player's frozen card can
// no longer be dealt a Prompt the live pool hides (Codex P2, PR #107 finding 1).

/**
 * True iff `reportCount` has REACHED a POSITIVE `reportHideThreshold` — at OR
 * over, not just over. The threshold is only active when it is a number strictly
 * greater than zero:
 *
 * - `undefined` (the event doc still loading, or the setting unset) → NO filtering.
 * - `0`, a negative number, or `NaN` → NO filtering. A non-positive threshold would
 *   make `reportCount >= threshold` true for ALL content and blank every Player's
 *   Feed/pool from one admin typo (Codex P2, PR #107 finding 2); requiring
 *   `threshold > 0` closes that, and the same guard rejects `NaN` (`NaN > 0` is
 *   false) even though `typeof NaN === 'number'`.
 * - any non-number → NO filtering.
 *
 * The filter fails OPEN unless the threshold is positive, because wrongly blanking
 * the whole app for everyone is worse than briefly showing a heavily-reported item,
 * and the Admin report queue is the backstop either way. Pure so the at/over/below
 * boundary AND the non-positive boundary are unit-testable without a subscription.
 */
export function isReportHidden(reportCount: number, threshold: number | undefined): boolean {
  return typeof threshold === 'number' && threshold > 0 && reportCount >= threshold;
}
