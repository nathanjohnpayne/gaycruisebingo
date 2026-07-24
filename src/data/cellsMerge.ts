// The per-cell WRITE options boundary (#458 4b round 8). A per-cell patch
// must NOT be written with `{ merge: true }`: Firestore deep-merges nested
// maps recursively, so a patched cell would merge FIELD-BY-FIELD into the
// stored cell and any field a transform removed by OMISSION — the destructured
// `echo`/`echoOptOut` strips in attachProof/deleteProof/manual unmark — would
// silently survive on the server (a deleted proof's cell keeping `echo: true`,
// a proofed Echo staying reshuffle-exempt). `mergeFields` with one FieldPath
// per changed cell REPLACES each `cells.<i>` wholesale while still leaving
// every sibling cell untouched — the commuting-writes property the map schema
// exists for is unchanged.

import { FieldPath } from 'firebase/firestore';
import type { CellsMap } from '../game/cells';

/**
 * Build the `[data, options]` pair for a per-cell board `set()`: the changed
 * cells (omitted entirely when the patch is empty — the write-mask discipline
 * formerly in `cellsPatchField`) plus any top-level extras (`markSeed`), with
 * a `mergeFields` mask that replaces each changed cell wholesale. Spread into
 * the call: `batch.set(ref, ...cellsMergeSet(patch, extras))`.
 */
export function cellsMergeSet(
  patch: CellsMap,
  extras: Record<string, unknown> = {},
): [Record<string, unknown>, { mergeFields: Array<string | FieldPath> }] {
  const keys = Object.keys(patch);
  return [
    { ...(keys.length > 0 ? { cells: patch } : {}), ...extras },
    {
      mergeFields: [...keys.map((k) => new FieldPath('cells', k)), ...Object.keys(extras)],
    },
  ];
}
