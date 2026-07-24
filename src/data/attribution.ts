/**
 * A rules-valid attributed name for a Tally marker, shared by the honor-Mark
 * (`setMark`) and proofed-Mark (`attachProof`) paths. Prefers the caller-resolved
 * `displayName` — production (Board.tsx) resolves the saved player-row identity +
 * auth fallback via `resolveDisplayName` (the SAME validated pattern joinAndDeal
 * uses) — falling back to the already-cached/looked-up player row's denormalized
 * name (so a direct caller like the offline durability harness still attributes),
 * then 'Anonymous'. Always a non-empty string within the 100-char cap the
 * tally-marker rule enforces, so a marker write can NEVER violate the rule and
 * poison the atomic board+player+marker batch (setMark) or the
 * proof+board+player+marker transaction (attachProof).
 *
 * Lives in its own Firestore-free module (Codex P2, PR #87 round 2) so that
 * importing it — e.g. proofs.ts sharing the helper with api.ts — never pulls
 * the full mark API's `firebase/firestore` import surface into a test module
 * graph that mocks only the exports it uses itself.
 */
export function markerDisplayName(preferred: string | undefined, cachedPlayerName: unknown): string {
  const candidate =
    typeof preferred === 'string' && preferred.trim().length > 0
      ? preferred
      : typeof cachedPlayerName === 'string' && cachedPlayerName.trim().length > 0
        ? cachedPlayerName
        : 'Anonymous';
  return candidate.slice(0, 100);
}

/** A permanent public honor must wait for a resolved Player identity. */
export function honorDisplayName(preferred: string | undefined, cachedPlayerName: unknown): string | null {
  const name = markerDisplayName(preferred, cachedPlayerName);
  return name === 'Anonymous' ? null : name;
}
