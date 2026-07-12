import { collection, doc, increment, runTransaction, updateDoc } from 'firebase/firestore';
import { db, EVENT_ID } from '../firebase';
import { uploadProofMedia, deleteStoragePath } from './storage';
import { markerDisplayName } from './attribution';
import { completedLines, countMarked, isBlackout, foldDayStat, type DayStats } from '../game/logic';
import type { Cell, ClaimMode, ProofDoc, ProofType } from '../types';

const rawProofs = () => collection(db, 'events', EVENT_ID, 'proofs');
const rawProof = (id: string) => doc(db, 'events', EVENT_ID, 'proofs', id);
const rawClaims = () => collection(db, 'events', EVENT_ID, 'claims');
const rawBoard = (uid: string) => doc(db, 'events', EVENT_ID, 'boards', uid);
// The day-scoped Board write ref (#246, daily-cards-spec § "Data model"): one
// Board per Player per Day at events/{eventId}/days/{dayIndex}/boards/{uid}.
// `String(dayIndex)` is the canonical decimal segment the rules gate accepts (#201).
const rawDayBoard = (dayIndex: number, uid: string) =>
  doc(db, 'events', EVENT_ID, 'days', String(dayIndex), 'boards', uid);
const rawPlayer = (uid: string) => doc(db, 'events', EVENT_ID, 'players', uid);

/**
 * The `{ merge: true }` player-stats write a proofed Mark / proof deletion
 * commits: in daily-cards mode (#246) the per-Board result is ONE Day Card's
 * bucket, folded into `players/{uid}.dayStats[dayIndex]` with the cruise-wide
 * root aggregates re-derived (`foldDayStat`) — exactly what the honor-Mark path
 * (`setMark` → `foldDayStat`) writes, so both paths share the scoring shape and a
 * proofed win on Day N credits Day N alone. In legacy mode it is the pre-1.5
 * flat root write. `tutorialDayIndexes` scopes the cruise-wide First-to-BINGO
 * exclusion (spec § "Resolved decisions" #2); absent excludes nothing.
 */
function playerStatWrite(params: {
  daily: boolean;
  dayIndex: number;
  priorDayStats: DayStats | undefined;
  bingoCount: number;
  squaresMarked: number;
  firstBingoAt: number | null;
  blackout: boolean;
  tutorialDayIndexes?: number[];
}) {
  const { daily, dayIndex, priorDayStats, bingoCount, squaresMarked, firstBingoAt, blackout } = params;
  if (!daily) return { squaresMarked, bingoCount, firstBingoAt, blackout };
  return foldDayStat({
    priorDayStats,
    dayIndex,
    bucket: { bingoCount, squaresMarked, firstBingoAt },
    blackout,
    isTutorialDay: params.tutorialDayIndexes
      ? (i: number) => params.tutorialDayIndexes!.includes(i)
      : undefined,
  });
}
// A per-Prompt Tally marker: events/{EVENT_ID}/tally/{itemId}/markers/{uid} (ADR
// 0002) — the SAME path setMark's honor-Mark marker uses. Raw ref (converter-free),
// matching the board/player/proof writes in these transactions and setMark's write.
const rawMarker = (itemId: string, markerUid: string) =>
  doc(db, 'events', EVENT_ID, 'tally', itemId, 'markers', markerUid);

export interface AttachProofArgs {
  uid: string;
  displayName: string;
  photoURL: string | null;
  cells: Cell[];
  cellIndex: number;
  // The backing cell's Prompt id, for the per-Prompt Tally marker (ADR 0002).
  // `null` for the free centre — which never opens ProofSheet, so this is
  // defensive; a null itemId simply publishes no marker.
  itemId: string | null;
  itemText: string;
  claimMode: ClaimMode;
  currentFirstBingoAt: number | null;
  // Which affordance produced a photo — 📷 camera or 🖼️ library (#190). Stamped
  // from the ProofSheet input, NOT inferred from EXIF; the Feed badges 🖼️.
  source?: 'camera' | 'library';
  // The Day this Proof belongs to, so the Feed reads "Day 2 · Get Sporty".
  dayIndex?: number;
  // Daily-cards mode (#246): write the DAY-SCOPED board + fold the player stats
  // into `dayStats[dayIndex]` (see `playerStatWrite`). Absent/false keeps the
  // pre-1.5 single-board flat write. `tutorialDayIndexes` scopes the cruise-wide
  // First-to-BINGO exclusion.
  daily?: boolean;
  tutorialDayIndexes?: number[];
  // Strip EXIF/GPS from a photo before upload (event `stripPhotoExif`, default
  // true); threaded straight to uploadProofMedia — this layer never reads the blob.
  stripExif?: boolean;
  proof: { type: ProofType; blob?: Blob; text?: string };
}

/**
 * The win verdict a proofed Mark reports back to Board — the SAME shape `setMark`
 * returns (issue #104 / PR #110 round 2 finding 1), so both completing-mark paths
 * feed one broadcast helper. `bingo`/`blackout` are the STANDING state of the
 * folded board; the transitions are the rising EDGE this attach crossed
 * (no-win → win), computed against the LIVE prior cells the transaction read.
 * In `admin_confirmed` mode the attached cell goes `pending`, and the win mask
 * (game/logic: `marked && status !== 'pending'`) excludes it — so an
 * admin-confirmed attach structurally crosses NO transition and broadcasts no
 * Moment at attach time. That is a decision, not an accident: a pending claim
 * can be REJECTED, and a Moment is IMMUTABLE (delete-only moderation) — an
 * attach-time broadcast would leave a permanent win announcement for a claim an
 * admin then rejects. The tally-marker analogy (which does publish at attach,
 * #87) does not carry: `rejectClaim` deletes the marker on rejection, but no
 * automatic cleanup path exists for a Moment. The admin-confirmed win (and its
 * Moment) materialize at admin confirm — the #41 deferral. `cells` is the folded
 * post-attach board, for fire-time revalidation in the drain.
 */
export interface AttachProofResult {
  cells: Cell[];
  bingo: boolean;
  blackout: boolean;
  bingoTransition: boolean;
  blackoutTransition: boolean;
}

/**
 * Mark a square and attach a playful proof (ADR 0002: the Proof IS the Feed
 * entry — a bare Mark posts nothing, an attached Proof posts here). In
 * admin_confirmed mode the square goes pending (doesn't count) and a claim is
 * created for an admin/peer to confirm. A Proof is flavour, never enforcement
 * (ADR 0001): it enriches the Feed, it does not make the Mark more trustworthy.
 *
 * Online-only, by design AND by rule (ADR 0006) — unlike a bare honor Mark
 * (`setMark`), attachProof does NOT queue offline:
 *   - it runs in a `runTransaction`, which needs a server round-trip and REJECTS
 *     offline (the read-modify-write folds onto the LIVE board/player so a
 *     concurrent admin resolve / another of the owner's tabs isn't clobbered),
 *     and
 *   - a photo/audio proof is unwritable before its media exists: firestore.rules
 *     pins `storagePath`/`mediaURL` to the EXACT uploaded Storage object, and a
 *     Storage upload needs signal — so a media proof doc can't be queued ahead of
 *     its upload. (A text proof carries no media, but still rides the same
 *     rejecting transaction.)
 * The offline-durable path is therefore the bare honor Mark; the Proof and its
 * media attach when connectivity returns (ADR 0006: "marks queue, proof media
 * doesn't"). Capture-then-retry lives in `ProofSheet`: a failed submit keeps the
 * captured blob/text in component state so the Player retries without
 * re-capturing — durable for the session, NOT across a reload (only the honor
 * Mark survives a reload).
 *
 * The proof→cell link is authoritative in the proof DOC (`uid` + `cellIndex`),
 * which this writes; `cells[i].proofId` is only a denormalized projection a
 * queued bare-Mark drain can wholesale-replace and drop
 * (specs/w1-board-mark-win.md § cross-writer). This is what discharges that
 * constraint for proof-capture: the Feed (`ProofFeed`/`useProofFeed`) renders
 * every entry from this doc, never from `cells`, so a dropped `proofId` never
 * removes a Proof from the Feed. `deleteProof` looks the backing cell up by
 * this same `cellIndex` rather than scanning for `proofId` — equivalent to the
 * scan given `proofId`'s uniqueness, so this is a clarity change, not a new
 * protection; see its own comment for what it does and does not do once a
 * drain has actually clobbered the projection.
 */
export async function attachProof(args: AttachProofArgs): Promise<AttachProofResult> {
  const { uid, displayName, photoURL, cells, cellIndex, itemId, itemText, claimMode, currentFirstBingoAt, source, dayIndex, daily, tutorialDayIndexes, stripExif, proof } =
    args;
  const now = Date.now();
  const pRef = doc(rawProofs());
  const proofId = pRef.id;

  let storagePath: string | null = null;
  let mediaURL: string | null = null;
  if ((proof.type === 'photo' || proof.type === 'audio') && proof.blob) {
    // Only photos carry EXIF/GPS; the strip flag is inert for audio.
    const up = await uploadProofMedia(uid, proofId, proof.blob, proof.type, { stripExif });
    storagePath = up.path;
    mediaURL = up.url;
  }

  const pending = claimMode === 'admin_confirmed';

  // Recompute cells from the live board inside a transaction so a concurrent
  // mark from another tab/device isn't clobbered by this caller's stale snapshot.
  // The transaction callback RETURNS the win verdict (PR #110 round 2 finding 1 —
  // return-shape only; the write set is untouched): on a retry the callback
  // re-runs against fresh reads, so the verdict always describes the COMMITTED
  // attempt's fold. runTransaction resolves with the callback's return value.
  return await runTransaction(db, async (tx): Promise<AttachProofResult> => {
    // Daily mode (#246): the Mark lives on the DAY-SCOPED board and its stats fold
    // into that Day's bucket — the SAME routing the honor Mark (`setMark`) uses, so
    // a proofed claim on the viewed Day never writes the (now rules-denied) legacy
    // board nor double-credits another Day. Legacy mode is unchanged.
    const boardRef = daily === true ? rawDayBoard(dayIndex ?? 0, uid) : rawBoard(uid);
    const playerRef = rawPlayer(uid);
    const markerRef = itemId ? rawMarker(itemId, uid) : null;
    // Read board + player before any write — a Firestore transaction requires ALL
    // reads before the FIRST write. The existing Tally marker is read HERE with
    // them (never down at its write below): attaching a Proof to an ALREADY-marked
    // square must preserve the marker's original markedAt (Codex P2, PR #87), and
    // that needs a read the transaction contract forbids once anything is written.
    const boardSnap = await tx.get(boardRef);
    const playerSnap = await tx.get(playerRef);
    const markerSnap = markerRef ? await tx.get(markerRef) : null;
    const liveCells = (boardSnap.data()?.cells as Cell[] | undefined) ?? cells;
    const next: Cell[] = liveCells.map((c) =>
      c.index === cellIndex
        ? { ...c, marked: true, markedAt: now, proofId, status: pending ? 'pending' : 'confirmed' }
        : c,
    );

    const bingoCount = completedLines(next).length;
    const squares = countMarked(next);
    const blackout = isBlackout(next);
    // Derive firstBingoAt from the live player row, not the caller's stale prop,
    // so a concurrent proof/mark can't overwrite an earlier first-bingo stamp;
    // clear it when no bingo stands (mirrors setMark/deleteProof).
    const existingFirst =
      (playerSnap.data()?.firstBingoAt as number | null | undefined) ?? currentFirstBingoAt ?? null;
    const firstBingoAt = bingoCount > 0 ? (existingFirst ?? now) : null;

    tx.set(pRef, {
      uid,
      displayName,
      photoURL,
      type: proof.type,
      cellIndex,
      itemText,
      storagePath,
      mediaURL,
      thumbURL: null,
      text: proof.text ?? null,
      createdAt: now,
      reportCount: 0,
      // Admin-confirmed-mode proofs stay 'pending' (admin-only readable) until an admin
      // confirms the claim; otherwise the proof is public immediately.
      status: pending ? 'pending' : 'active',
      visionFlag: null,
      // #190: stamp which affordance produced a photo so the Feed badges a
      // library pick 🖼️; null for audio/text and camera picks that pass none.
      source: source ?? null,
      // The Day this claim belongs to, so the Feed reads "Day 2 · Get Sporty".
      dayIndex: typeof dayIndex === 'number' ? dayIndex : null,
    });
    tx.set(boardRef, { cells: next }, { merge: true });
    tx.set(
      playerRef,
      playerStatWrite({
        daily: daily === true,
        dayIndex: dayIndex ?? 0,
        priorDayStats: playerSnap.data()?.dayStats as DayStats | undefined,
        bingoCount,
        squaresMarked: squares,
        firstBingoAt,
        blackout,
        tutorialDayIndexes,
      }),
      { merge: true },
    );
    // Per-Prompt Tally (ADR 0002): a proofed Mark self-publishes the SAME attributed
    // marker a bare honor Mark does (setMark) — EVERY Mark, proofed or not, tallies.
    // The cell above is set marked:true in BOTH claim modes (proof_required →
    // 'confirmed', admin_confirmed → 'pending'), so the marker publishes here under
    // the SAME condition as the cell becoming marked — exactly as setMark writes it
    // on `nextMarked` regardless of pending/confirmed status. The marker doc id IS
    // the marker uid so firestore.rules keeps a forged attribution out; the name is
    // bounded to the rule's non-empty ≤100 contract via `markerDisplayName` (shared
    // with setMark), falling back to the live player row already read above. The free
    // centre never opens ProofSheet (no itemId), but guard defensively. Because it
    // rides this runTransaction, the marker is ONLINE-only like the proof itself (ADR
    // 0006): a transaction rejects offline and never queues. The marked→unmarked
    // symmetry is kept by every unmark path: setMark (bare unmark), deleteProof
    // (below), and rejectClaim (src/data/admin.ts) when an admin rejects a pending
    // claim — wherever a cell flips marked→unmarked, that cell's marker is deleted.
    //
    // A Proof attached to an ALREADY-marked square (the cell's proofbtn) must not
    // re-stamp the marker: the who-list is chronological by FIRST mark, and
    // overwriting markedAt with `now` would reorder it by proof-attach time (Codex
    // P2, PR #87). Preserve an existing marker's original markedAt — refreshing
    // uid/displayName is fine — and stamp `now` only when no marker exists yet (a
    // fresh mark, or a legacy pre-Tally mark that never had one).
    if (markerRef) {
      const priorMarkedAt = (markerSnap?.data() as { markedAt?: unknown } | undefined)?.markedAt;
      tx.set(markerRef, {
        uid,
        displayName: markerDisplayName(displayName, playerSnap.data()?.displayName),
        markedAt: typeof priorMarkedAt === 'number' ? priorMarkedAt : now,
      });
    }
    if (pending) {
      tx.set(doc(rawClaims()), {
        uid,
        displayName,
        cellIndex,
        itemText,
        proofId,
        status: 'pending',
        createdAt: now,
        resolvedBy: null,
        // In daily mode the pending mark lives on the DAY-SCOPED board, so the
        // Claim carries its `dayIndex` — `confirmClaim`/`rejectClaim` resolve
        // against that board + fold `dayStats[dayIndex]` (#246, Codex #247 P2).
        // Omitted (not `undefined`, which Firestore rejects) in legacy mode.
        ...(daily === true ? { dayIndex: dayIndex ?? 0 } : {}),
      });
    }
    // The verdict (see AttachProofResult): standing state from the fold, rising
    // edges against the LIVE prior cells this transaction read. In
    // admin_confirmed the folded cell is `pending` and the win mask excludes it,
    // so both transitions are structurally false — no Moment fires at attach.
    return {
      cells: next,
      bingo: bingoCount > 0,
      blackout,
      bingoTransition: completedLines(liveCells).length === 0 && bingoCount > 0,
      blackoutTransition: blackout && !isBlackout(liveCells),
    };
  });
}

export async function reportProof(id: string): Promise<void> {
  await updateDoc(rawProof(id), { reportCount: increment(1) });
}

export async function deleteProof(
  id: string,
  storagePath?: string | null,
  // Daily-cards mode (#246): unmark the backing cell on the DAY-SCOPED board for
  // the Proof's OWN `dayIndex` and fold the owner's stats into that Day's bucket,
  // mirroring `attachProof`. Absent/false keeps the pre-1.5 flat single-board
  // unmark. `tutorialDayIndexes` scopes the cruise-wide First-to-BINGO exclusion.
  opts?: { daily?: boolean; tutorialDayIndexes?: number[] },
): Promise<void> {
  // Storage first (ordering preserved): if the blob delete throws we keep the
  // doc so the media isn't orphaned.
  if (storagePath) await deleteStoragePath(storagePath);

  await runTransaction(db, async (tx) => {
    const proofRef = rawProof(id);
    const proofSnap = await tx.get(proofRef);
    const proof = proofSnap.data() as ProofDoc | undefined;

    if (proof) {
      // A deleted proof must not leave its square marked-but-uncredited (in
      // proof_required mode a marked cell is backed by this proof). Unmark the
      // backing cell and recompute the owner's derived stats in the same txn.
      const daily = opts?.daily === true;
      const proofDayIndex = typeof proof.dayIndex === 'number' ? proof.dayIndex : 0;
      const boardRef = daily ? rawDayBoard(proofDayIndex, proof.uid) : rawBoard(proof.uid);
      const playerRef = rawPlayer(proof.uid);
      const boardSnap = await tx.get(boardRef);
      const cells = boardSnap.data()?.cells as Cell[] | undefined;
      // Resolve the backing cell from the proof's OWN cellIndex — the
      // authoritative proof→cell link (specs/w1-board-mark-win.md § cross-writer)
      // — rather than scanning for `cells[i].proofId === id`. Given `proofId`'s
      // uniqueness and that a proof's `cellIndex` never changes after creation,
      // the two lookups pick out the same cell in every reachable state: this is
      // a clarity/consistency change, not a new protection, and it does NOT
      // recover a clobbered projection. A queued bare-Mark drain does a
      // whole-array { merge:true } replace of `cells` and can drop the
      // `proofId` at `cellIndex`; once that has happened, this lookup sees the
      // same dropped value a `cells.some(c => c.proofId === id)` scan would have
      // seen, so the guard below no-ops identically either way. We gate the
      // unmark on `proofId === id` so we never fight a bare Mark that has since
      // taken the cell over — if the projection was dropped, the drained bare
      // Mark owns the cell and deleteProof leaves it (accepted residual, ADR
      // 0001) rather than un-marking a live Mark. What DOES discharge the PR #75
      // constraint for proof-capture is that the Feed resolves a Proof from this
      // doc's own `uid`/`cellIndex`, never solely from `cells[i].proofId` — see
      // `ProofFeed`/`useProofFeed`.
      const backing = cells?.find((c) => c.index === proof.cellIndex);
      if (cells && backing && backing.proofId === id) {
        const playerSnap = await tx.get(playerRef);
        const existingFirst = (playerSnap.data()?.firstBingoAt as number | null | undefined) ?? null;
        const next: Cell[] = cells.map((c) =>
          c.index === proof.cellIndex
            ? { ...c, marked: false, markedAt: null, proofId: null, status: 'confirmed' }
            : c,
        );
        const bingoCount = completedLines(next).length;
        const squares = countMarked(next);
        const blackout = isBlackout(next);
        const firstBingoAt = bingoCount > 0 ? existingFirst : null;
        tx.set(boardRef, { cells: next }, { merge: true });
        tx.set(
          playerRef,
          playerStatWrite({
            daily,
            dayIndex: proofDayIndex,
            priorDayStats: playerSnap.data()?.dayStats as DayStats | undefined,
            bingoCount,
            squaresMarked: squares,
            firstBingoAt,
            blackout,
            tutorialDayIndexes: opts?.tutorialDayIndexes,
          }),
          { merge: true },
        );
        // Unmarking removes exactly that Player's per-Prompt Tally entry (ADR 0002),
        // mirroring the cell flip — reached only when the cell is still backed by
        // THIS proof (a genuine unmark), and only for a non-free Prompt. Same marker
        // path setMark writes; the owner is the proof's uid.
        if (backing.itemId) tx.delete(rawMarker(backing.itemId, proof.uid));
      }
    }

    tx.delete(proofRef);
  });
}
