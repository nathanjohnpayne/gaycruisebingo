---
spec_id: cells-map
status: accepted
---

# Cells as a map: per-cell Mark writes that merge across devices (`cells-map`)

Implements #457, the follow-up PR #447's review loop demanded (rounds 1 and 6 both landed on the same root cause). Guarded by `src/game/cells.test.ts` (the pure wire boundary), `tests/offline/cells-map.test.ts` (the two-device no-clobber proof against real emulators, rules, and persistence), the map-shape write assertions across `src/data/*.test.ts`, and the `cells is map` gate pins in `tests/rules/echo-marks.test.ts`.

## Problem

A Board's `cells` was one 25-element ARRAY, replaced wholesale by every Mark write — because ADR 0006 requires Marks to be offline-queueable batches (transactions reject offline), and an array can only be written whole. Two DEVICES of the same account writing from different cache states could therefore silently erase each other's Marks, and PR #447's review loop proved no version-counter scheme closes that: exactly-+1 breaks legitimate same-device queued drains, and both monotonic and claimed-base schemes collide on a stale device's second queued write. The interim `markVersion` guard narrowed the window; this spec retires it and closes the class structurally.

## Contract

**The WIRE shape of `BoardDoc.cells` is a MAP keyed by the canonical decimal cell index (`'0'`..`'24'`).** The APP-SIDE contract stays `Cell[]` — pure game logic, win masks, and rendering are untouched. `src/game/cells.ts` is the single boundary: `cellsFromData` normalizes ANY raw read (map, the legacy array still present in caches and pre-migration docs, or malformed → empty), `cellsToMap` emits the full map (deal, reshuffle, migration), and `cellsPatch(changedCells(before, after))` derives a partial write from any pure transform (every transform in this codebase returns untouched cells by reference, so identity inequality IS the change set). `boardConverter` routes reads and full-board writes through the same boundary.

**A Mark is a per-cell `{ merge: true }` patch.** `setMark`, the echo propagation (mark-time siblings, open-time reconcile), `attachProof`/`deleteProof`, and the claim resolves each write ONLY their changed cells, keyed by index. Firestore's merge semantics then make concurrent writes to DIFFERENT cells commute — the two-device clobber becomes structurally impossible — while a same-cell conflict collapses to last-write-wins on that one Square (same player, same square: self-evident, not data loss). A transform that changes nothing writes an EMPTY patch, which merges nothing. Deal and Reshuffle still write the full map (they replace the card by design), and every write keeps carrying `markSeed` — the post-Reshuffle stale-card guard is orthogonal and unchanged.

**An empty patch writes NO `cells` key.** An explicitly empty nested map in a `{ merge: true }` write is not a no-op — the field enters the write mask and would SET `cells` to `{}`, wiping every cell. `cellsPatchField` therefore omits the key entirely when a transform changed nothing, at every patch site (pinned by `src/game/cells.test.ts` and the no-flip resolve assertion in `src/data/w2-tally.test.ts`).

**Player stats are CONVERGENT projections; the board is the source of truth.** The aggregated player write stays an absolute projection of the writing device's cached view (ADR 0001's client-authoritative stats), so a stale device's drain can briefly record a projection missing another device's Mark. Three properties bound it: per-day buckets merge-scope to the ACTED day only (a cross-day clobber is impossible); root sums re-derive on every fold; and the next fold from a SYNCED cache — any later Mark, or the open-time reconcile — writes correct absolutes, so stats converge to the board. Proven end-to-end in `tests/offline/cells-map.test.ts`: after both devices' drains, a third Mark from a synced cache lands `squaresMarked: 3` covering all three Marks. Making stats transactionally consistent with per-cell merges would require server-side aggregation — the ADR 0001 recompute stance (repair, not integrity) applies.

**firestore.rules requires the map and drops the counter.** Every day-board create/update requires the RESULTING `cells is map` (cheap, unconditional — a legacy array write from a pre-migration bundle is denied), `boardPristine()` indexes the map (`cells['0']`…`cells['24']`), and `versionedMarkGuard`/`markVersion` are DELETED — the guard chain is now reshuffle-or-seedGuard-or-unchanged, evaluated with the same budget-lean ordering. `BoardDoc.markVersion` is gone from the type; the migration deletes the field from live docs.

**Migration before rules (`scripts/migrate-cells-map.mjs`).** Dry-run by default; `--apply` converts every `boards` collection-group doc (day-scoped and legacy) array→map, deletes `markVersion`, then runs a VERIFY pass that re-enumerates and fails loudly unless 100% of boards are map-shaped. Deploy order is load-bearing and the script says so: migrate with a green verify FIRST, then deploy the #457 rules + hosting together. Idempotent; same credential resolution as the sibling admin scripts.

## Decisions

**Why reference-identity diffing (`changedCells`) rather than deep comparison.** Every cell transform in the codebase (`computeMark`, `applyEchoes`, the claim mappers) maps the array and returns untouched cells by the same reference — so identity inequality is exact, free, and cannot false-negative on a real change. A deep diff would only re-derive what the transforms already encode.

**Why the retired `markVersion` retry/intent machinery is deleted, not kept dormant.** The `setMark`/`reconcileEchoes` refresh-and-retry paths and the mark-intent generations existed solely to recover from version-conflict rejections; the map schema removes the conflict, so the machinery is dead weight (and its tests asserted behavior that no longer exists — replaced by the structural patch-shape assertions and the two-device offline proof).

## Residuals (accepted)

**Same-cell cross-device conflict is last-write-wins.** The same player marking/unmarking the SAME Square from two devices resolves to the later write. That is the correct semantic for a single square owned by a single player, and no schema can do better without timestamps-per-field.

**A pre-migration PWA bundle's queued board writes are denied post-deploy.** Its full-array write fails the `cells is map` gate at drain and rolls back locally; the update prompt / next reload re-marks under the current bundle. Bounded by the deploy moment (post-cruise, traffic near zero) and strictly narrower than the alternative (keeping an array escape reopens the clobber).

**The legacy `events/{id}/boards/{uid}` path is migrated for read consistency only.** It has no live write rule (the day-scoped rules removed the path); its docs are converted so every reader of `cellsFromData` sees one shape family.

## Acceptance criteria

- Two devices marking DIFFERENT cells of one board from mutually stale offline caches: BOTH Marks stand on the server after both drains, in either drain order (`tests/offline/cells-map.test.ts` — the class PR #447 rounds 1/6 proved unclosable under the array schema).
- Every Mark-path write payload carries ONLY its changed cells, keyed by decimal index; a no-op transform writes an empty patch (`src/data/*.test.ts` map-shape assertions).
- A legacy ARRAY cells write is denied by rules; per-cell patches from two writers both land and both Marks read back (`tests/rules/echo-marks.test.ts`).
- `cellsFromData` round-trips the map losslessly, passes legacy arrays through by identity, sorts map values by index, and reads malformed values as empty (`src/game/cells.test.ts`).
- The migration converts every board, deletes `markVersion`, verifies 100% map-shaped, and is idempotent (`scripts/migrate-cells-map.mjs` dry-run/apply/verify contract).
