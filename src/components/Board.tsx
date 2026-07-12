import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useBoard, useMyPlayer, useEventDoc, useItems, useTally, useLeaderboard, useDoubts, useMyProofs, useProofsForItemText } from '../hooks/useData';
import { setMark, resolveDisplayName } from '../data/api';
import { eventTitle } from '../format';
import { raiseDoubt, openDoubts, doubtStatusFor } from '../data/doubts';
import {
  broadcastBingo,
  broadcastBlackout,
  broadcastFirstBingo,
  hasPriorBingoWitness,
  enqueueWinMoments,
  enqueueFirstBingoMoment,
  peekPendingMoments,
  clearPendingMoment,
  dropPendingWins,
  pendingActionGeneration,
  firstBingoCandidateCurrent,
} from '../data/moments';
// Type-only (erased at runtime — pulls no module into suites that stub proofs):
// the proofed-mark completion verdict ProofSheet reports back (PR #110 round 2
// finding 1), same shape as setMark's return.
import type { AttachProofResult } from '../data/proofs';
import { hasBingo, isBlackout, winningCells, countMarked, MIN_POOL, bingoLineEdge } from '../game/logic';
import { track } from '../analytics';
import Celebration from './Celebration';
import ProofSheet from './ProofSheet';
import type { Cell, ClaimMode, DayDef, PlayerDoc, ProofDoc, TallyEntry } from '../types';
import LoadingState from './LoadingState';
import DaySwitcher, { defaultViewedIndex } from './DaySwitcher';
import { THEMES } from '../theme/themes';
import { FREE_TEXT } from '../data/seed';

/**
 * The per-Prompt Tally count badge on a marked Square (ADR 0002). Subscribes to
 * the Prompt's marker subcollection and shows how many Players have marked it;
 * tapping opens the who-list. Rendered only on marked, non-free Squares, so a
 * freshly dealt card (only the free centre "on") surfaces no badge at all.
 */
function TallyBadge({ itemId, onOpen }: { itemId: string; onOpen: () => void }) {
  const { count } = useTally(itemId);
  if (count <= 0) return null;
  return (
    <button
      className="tally-badge"
      title="See who marked this"
      aria-label={`${count} marked—see who`}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
    >
      {count}
    </button>
  );
}

/**
 * The open-Doubt count on a marked Square (ADR 0001): how many "pics or it didn't
 * happen" Doubts AGAINST THIS SQUARE'S OWN MARKER (`targetUid` — Board only ever
 * renders the signed-in Player's own board, so that is always the viewer) are
 * still UNANSWERED. Scoped to `targetUid` deliberately: the shared item pool means
 * another Player commonly holds the same Prompt (ADR 0002 — "see who else got this
 * square"), and a Doubt is inherently a targeted accusation against ONE Player's
 * Mark, not ambient per-Prompt noise — an un-doubted Player must never see a badge
 * on their own Square just because someone ELSE who also marked this Prompt is
 * being doubted (verifier finding, #33). Mirrors `TallyBadge` — a per-cell
 * subscription (`useDoubts`) plus the VIEWER'S OWN active Proofs (passed down once
 * from Board — the viewer-scoped `useMyProofs`, #106 finding 4, since a Doubt
 * against the viewer is answered only by the viewer's own Proof) folded through the
 * PURE `openDoubts` derivation — but sits top-LEFT, clear of the
 * ✓ (top-right), the proof ＋ (bottom-left), and the Tally count (bottom-right).
 * Renders ONLY when at least one Doubt against `targetUid` is open. Tapping opens
 * the same who-list sheet, where a Doubt is actually raised against another
 * Player's entry — a Doubt never blocks or unmarks the Square, so this is a
 * pressure signal, never a gate.
 */
function DoubtBadge({
  itemId,
  itemText,
  targetUid,
  proofs,
  onOpen,
}: {
  itemId: string;
  itemText: string;
  targetUid: string;
  proofs: readonly Pick<ProofDoc, 'uid' | 'itemText' | 'createdAt'>[];
  onOpen: () => void;
}) {
  // `targetUid` here is the signed-in viewer (Board only ever renders the viewer's
  // OWN board, so every Square's `targetUid` is `uid`). Passing it as the viewerUid
  // keeps the ban own-content exception (#122 round 2): a banned viewer still sees —
  // and can answer — a Doubt raised against THEMSELVES on their own board, even
  // though `useDoubts` hides Doubts against a banned target for every OTHER viewer.
  const { doubts } = useDoubts(itemId, targetUid);
  const mine = doubts.filter((d) => d.targetUid === targetUid);
  const open = openDoubts(mine, itemText, proofs);
  if (open.length <= 0) return null;
  return (
    <button
      className="doubt-badge"
      title="pics or it didn't happen"
      aria-label={`${open.length} open doubt${open.length === 1 ? '' : 's'}—pics or it didn't happen`}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
    >
      {open.length}
    </button>
  );
}

/**
 * The tap-to-see-who list for a Prompt's Tally (ADR 0002): names EVERY Player who
 * marked the Prompt — no anonymity — chronologically. Reuses the proof-capture
 * sheet chrome. Markers carry no photo (the marker doc is just uid + displayName +
 * markedAt), so the avatar is the name's initial.
 *
 * It is also where a Doubt is RAISED (ADR 0001, #33): each OTHER Player's row
 * carries a "pics or it didn't happen" affordance that raises a Doubt against
 * their Mark of this Prompt; the header summarizes the open-Doubt total across the
 * markers listed below (deliberately UN-scoped per target, unlike the per-target
 * Square badge — this sheet already lists everyone by name, so an aggregate here is
 * a heat summary, not a personal accusation). A row whose Doubt(s) have been
 * answered by a Proof renders a distinct SATISFIED state, an open one a distinct
 * DOUBTED state — social pressure applied then visibly cooled. A Doubt never
 * blocks, unmarks, or discounts the Mark (never a gate), so nothing here changes
 * the Board; the doubter's own row offers no affordance (no self-doubt).
 *
 * Review-hardening details (Codex P2, PR #106 rounds 1–2):
 *  - Dormant-when-unmarked (finding 2): the open-Doubt header counts ONLY Doubts
 *    whose target is a CURRENT marker. A Doubt doc is never deleted when its target
 *    unmarks (no cross-writer cleanup); instead it goes dormant and reappears in
 *    the count if they re-mark — the accusation targets a standing Mark.
 *  - No double-raise (finding 1): the raise button disables SYNCHRONOUSLY on the
 *    first tap (a per-target in-flight ref, so a rapid second tap in the same tick
 *    is inert), cleared when the write settles; the echoed Doubt keeps it "Doubted"
 *    meanwhile, and `raiseDoubt` is passed the open set so a duplicate that slips
 *    through post-echo is also skipped at the data layer.
 *  - Item-scoped proofs (finding 4): satisfaction for the markers listed here reads
 *    the active Proofs for THIS Prompt only (`useProofsForItemText`, mounted with
 *    the sheet), not a Board-wide proof stream.
 *  - Once-only per target (round 2 finding 2): a marker this Player has ALREADY
 *    doubted — open OR satisfied — keeps the affordance disabled ("Doubted"): the
 *    deterministic doubt slot makes a re-raise in place structurally denied, so
 *    the button never offers a write the rules would reject. A fresh demand after
 *    a satisfying Proof is a retract-then-re-raise flow (the doubter's delete is
 *    already allowed by the rules), deliberately not surfaced here.
 *  - Identity-gated accusation (round 2 finding 3): the raise affordance is
 *    DISABLED until the viewer's saved identity is KNOWN (the same `identityKnown`
 *    tri-state setMark and the Moment broadcasts gate on) — a Doubt stores the
 *    accuser's name PERMANENTLY, so waiting beats stamping 'Anonymous'; the
 *    data layer's cached-row fallback (raiseDoubt) is the defense-in-depth.
 */
function TallySheet({
  itemId,
  itemText,
  cellIndex,
  meUid,
  meName,
  identityKnown,
  isSourceLive,
  onClose,
}: {
  itemId: string;
  itemText: string;
  cellIndex: number;
  meUid: string;
  meName: string | undefined;
  identityKnown: boolean;
  // Board's write-time source revalidation (Codex P2, PR #106 round 6): true only
  // while the CURRENT account's board still holds (cellIndex, itemId) as a marked,
  // non-free Square. This sheet's own props are exactly what goes stale when the
  // account switches (or the source unmarks in another tab) under an open sheet,
  // so the raise consults Board's latest knowledge instead of trusting them.
  isSourceLive: (cellIndex: number, itemId: string) => boolean;
  onClose: () => void;
}) {
  const { markers, loading } = useTally(itemId);
  // `meUid` is the signed-in viewer — pass it so the ban own-content exception holds
  // in the sheet too (#122 round 2): a banned viewer still sees Doubts against
  // themselves, while Doubts against a banned OTHER marker stay hidden.
  const { doubts } = useDoubts(itemId, meUid);
  // The active Proofs for THIS Prompt (finding 4) — joined by itemText, the same
  // (uid, itemText) key the derivation uses (ProofDoc carries no itemId). Mounted
  // only while this sheet is, so no Board-wide proof listener is opened.
  const { proofs } = useProofsForItemText(itemText);
  // Only Doubts against a CURRENT marker count in the header (finding 2): a Doubt
  // against a Player who has since unmarked is dormant (its target left the list),
  // reappearing if they re-mark. Doubt docs are never deleted here (no cross-writer
  // cleanup). The per-row status below is inherently scoped — a row IS a current
  // marker — so this one filter covers the only aggregate.
  const markedUids = new Set(markers.map((m) => m.uid));
  const open = openDoubts(doubts, itemText, proofs).filter((d) => markedUids.has(d.targetUid));
  const openCount = open.length;
  // Per-target in-flight guard (finding 1): held in a ref so a rapid double-tap in
  // ONE tick reads the mutation the first tap made (a render-closure boolean would
  // not update until the next render, so both taps would fire). The bump reducer
  // re-renders so the disabled affordance shows immediately; the guard clears when
  // the raise settles — meanwhile the echoed Doubt flips `iAlreadyDoubted` true and
  // keeps the button "Doubted", and a failed write both settles here and rolls the
  // echo back, re-enabling the row.
  const inFlight = useRef<Set<string>>(new Set());
  const [, bumpInFlight] = useReducer((n: number) => n + 1, 0);
  const doDoubt = (m: TallyEntry) => {
    // Write-time source revalidation (Codex P2, PR #106 round 6), SYNCHRONOUS with
    // the write decision — a Doubt is a permanent once-only slot, so a stale
    // source must be caught at the moment of the raise, not by an effect that can
    // race the tap by a commit. Board's render-time close (the tallySourceLive
    // adjust) normally unmounts this sheet first; this is the belt-and-braces
    // write layer for the tap that lands in the race window. Dead source → close
    // the sheet, write nothing, count nothing.
    if (!isSourceLive(cellIndex, itemId)) {
      onClose();
      return;
    }
    if (inFlight.current.has(m.uid)) return;
    inFlight.current.add(m.uid);
    bumpInFlight();
    const clear = () => {
      inFlight.current.delete(m.uid);
      bumpInFlight();
    };
    // `.then(clear, clear)` clears on either settle path; raiseDoubt already logs
    // and swallows an online rejection, so this never sees an unhandled rejection.
    void raiseDoubt({
      fromUid: meUid,
      fromDisplayName: meName,
      targetUid: m.uid,
      targetDisplayName: m.displayName,
      itemId,
      cellIndex,
      currentlyOpen: open,
    }).then(clear, clear);
  };
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">Who marked “{itemText}”</div>
        {openCount > 0 && (
          <p className="doubt-summary">
            {openCount} open doubt{openCount === 1 ? '' : 's'}—pics or it didn&apos;t happen
          </p>
        )}
        {loading && markers.length === 0 ? (
          <p className="muted tally-empty">Loading…</p>
        ) : markers.length === 0 ? (
          <p className="muted tally-empty">No one has marked this yet.</p>
        ) : (
          <div className="list">
            {markers.map((m) => {
              const status = doubtStatusFor(m.uid, doubts, itemText, proofs);
              const isMe = m.uid === meUid;
              // ANY Doubt of mine against this marker — open OR satisfied —
              // disables the affordance (round 2 finding 2): the deterministic
              // slot is once-only, so a re-raise in place would only be denied.
              const iAlreadyDoubted = doubts.some(
                (d) => d.targetUid === m.uid && d.fromUid === meUid,
              );
              const isPending = inFlight.current.has(m.uid);
              return (
                <div className="row" key={m.uid}>
                  <div className="avatar">{(m.displayName.trim()[0] ?? '?').toUpperCase()}</div>
                  <div className="grow">
                    <div className="name">{m.displayName}</div>
                    {status === 'open' && (
                      <div className="sub doubt-open">Doubted—pics or it didn&apos;t happen</div>
                    )}
                    {status === 'satisfied' && (
                      <div className="sub doubt-satisfied">Proof shown ✓</div>
                    )}
                  </div>
                  {!isMe && (
                    <button
                      className="btn doubt-btn"
                      title="pics or it didn't happen"
                      // !identityKnown: never let a public, permanent accusation
                      // publish while the accuser's saved name is still unknown
                      // (round 2 finding 3) — the gate opens when the row loads.
                      disabled={iAlreadyDoubted || isPending || !identityKnown}
                      onClick={() => doDoubt(m)}
                    >
                      {iAlreadyDoubted ? 'Doubted' : isPending ? 'Doubting…' : 'Doubt'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="sheet-actions">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The caller's first-bingo state for a Mark is KNOWN only when the player row
 * genuinely resolved. While the subscription is still loading, OR when a
 * cache-only snapshot settled as "absent" without server confirmation (an
 * offline reload can cache the board but not the player row, and Firestore
 * reports an uncached doc as non-existent), the prior value is UNKNOWN —
 * `undefined` — so setMark omits the preserve-vs-stamp write instead of
 * treating a phantom `null` as a real "no first bingo yet" and re-stamping
 * over the server's earlier value (Codex P2, PR #75 rounds 2 + 4). A CACHED
 * row is real knowledge either way; a loaded `null` is a known none.
 * Exported for the unit test in `src/data/w1-board-mark-win.test.ts`.
 */
export function knownFirstBingoAt(
  player: { firstBingoAt?: number | null } | null,
  loading: boolean,
  serverConfirmed: boolean,
): number | null | undefined {
  if (loading || (player === null && !serverConfirmed)) return undefined;
  return player?.firstBingoAt ?? null;
}

/** Title-cases a hyphenated ThemeId ('welcome-aboard' -> 'Welcome Aboard') —
 * the fallback label/description source for a Day whose Theme has no
 * `ThemeMeta` entry yet (the two Phase 1.5 tutorial themes land theirs in
 * #206, which this ticket does not depend on). */
function titleCaseThemeId(themeId: string): string {
  return themeId
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function themeLabel(themeId: string): string {
  return THEMES.find((t) => t.id === themeId)?.label ?? titleCaseThemeId(themeId);
}

function themeDescription(themeId: string): string {
  return THEMES.find((t) => t.id === themeId)?.description ?? '';
}

/** "Unlocks 8:00 AM · Wed Jul 22" — event-timezone formatted, falling back
 * to UTC if the Event doc hasn't resolved yet. */
function formatUnlockAt(unlockAt: number, timezone: string | undefined): string {
  const tz = timezone || 'UTC';
  const when = new Date(unlockAt);
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz,
  }).format(when);
  const date = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: tz,
  }).format(when);
  return `${time} · ${date}`;
}

/**
 * The locked-Day preview (daily-cards-spec § "Locked Day preview"): full
 * themed chrome for the viewed Day over a 5x5 grid of blank Squares — only
 * the free space (index 12, the same center the live deal uses) is
 * populated, with that Day's `freeText` override if it carries one. No
 * click handler is wired to any Square here, so a tap is a structural
 * no-op — there is nothing to call `setMark` with.
 */
function LockedDayPreview({ day, timezone }: { day: DayDef; timezone: string | undefined }) {
  const description = themeDescription(day.theme);
  const freeText = day.freeText ?? FREE_TEXT;
  return (
    <div className="board-area day-locked" data-theme={day.theme}>
      <div className="day-locked-chrome">
        <div className="day-locked-title">
          <span aria-hidden="true">{day.portEmoji}</span> {day.port} · {themeLabel(day.theme)}
        </div>
        {description && <p className="day-locked-desc">{description}</p>}
      </div>
      <div className="bingo-head" aria-hidden="true">
        {['B', 'I', 'N', 'G', 'O'].map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
      <div className="grid locked-grid">
        {Array.from({ length: 25 }, (_, index) => (
          <div
            key={index}
            className={'cell locked-cell' + (index === 12 ? ' free marked' : '')}
          >
            {index === 12 && (
              <>
                <span className="free-label" aria-hidden="true">
                  FREE
                </span>
                <span className="free-prompt">{freeText}</span>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="day-lock-badge">
        <span aria-hidden="true">🔒</span> Unlocks {formatUnlockAt(day.unlockAt, timezone)}
      </div>
      <p className="day-lock-caption muted">24 fresh squares land at 8. Come back after coffee.</p>
    </div>
  );
}

export default function Board() {
  const { user } = useAuth();
  const uid = user?.uid;
  const { data: board, loading: boardLoading, hasServerData: boardConfirmed } = useBoard(uid);
  const { data: player, loading: playerLoading, hasServerData: playerConfirmed } = useMyPlayer(uid);
  // ONE resolution of the caller's public display name, fed to BOTH the per-Prompt
  // Tally marker (setMark, below) AND the new-Proof attribution (ProofSheet), so a
  // Mark and a Proof always publish the SAME identity the leaderboard shows — never
  // two divergent name sources (ADR 0002). It runs the saved player-row identity —
  // the denormalized name the profile editor keeps current (data/profile.ts writes
  // users/{uid} + the player row, #76/#78) — through `resolveDisplayName`, the same
  // validated resolver joinAndDeal uses (trim, ≤100-char cap, else the live auth value).
  const displayName = resolveDisplayName(player, user?.displayName);
  // ...but that saved identity is KNOWN only under the same tri-state as
  // knownFirstBingoAt above: while the subscription is still loading, or when a
  // cache-only snapshot settled "absent" without server confirmation, the row is
  // UNKNOWN — and `displayName` above has silently fallen back to the AUTH name.
  // Stamping that onto a Tally marker would publish a returning Player's stale
  // Google name over their customized one for any Mark tapped in the loading
  // window (Codex P2, PR #87). So doMark passes `displayName` only when the row
  // is known, and `undefined` otherwise — markerDisplayName then falls back to
  // the CACHED player row (the saved name), then 'Anonymous', deliberately never
  // the possibly-stale auth value. A loaded-null row IS known (a real "no saved
  // row"), so the auth fallback is then legitimate. ProofSheet keeps the resolved
  // string either way: its sheet only opens after a render with the row loaded in
  // practice, and #78 pins auth as its explicit pre-load fallback.
  const identityKnown = !playerLoading && (player !== null || playerConfirmed);
  const { data: event } = useEventDoc();
  // The known-players roster — the SAME data the Leaderboard's First-to-BINGO pin
  // reads (useLeaderboard) — used to derive whether THIS Player is first to BINGO
  // when broadcasting the ceremonial Moment (ADR 0001). Read into a ref below so
  // the edge effect stays keyed on `[cells]`. `rosterConfirmed` is the roster's
  // server-confirmed latch (useColSub's `hasServerData`): an initial EMPTY `players`
  // from a still-loading (or cache-only) subscription is NOT proof nobody has
  // bingoed, so the First-to-BINGO claim is HELD until the roster is server-backed
  // (Codex P2, PR #99 finding 2) rather than guessed from an unloaded roster.
  const { players, hasServerData: rosterConfirmed } = useLeaderboard();
  // Codex P3 (PR #66): the pool only matters before a Board is dealt, so once
  // a Board exists this Player has no use for a live listener on every other
  // Player's prompt add/report. Gate the subscription to the no-board state.
  const { items, loading: poolLoading, hasServerData: poolConfirmed } = useItems(!board);
  // The VIEWER'S OWN active Proofs (Codex P2, PR #106 finding 4): the ONLY Proofs a
  // viewer-scoped DoubtBadge needs to tell whether a Doubt AGAINST THE VIEWER is
  // answered. A `where('uid','==',uid)` + `where('status','==','active')` query
  // (both equality — no composite index), subscribed ONCE here and threaded to
  // every Square's badge — replacing the Board-wide `useProofFeed` that pulled
  // every active Proof from every Player into every Card mount. The Tally sheet's
  // per-marker status needs OTHER Players' Proofs too, so it subscribes its own
  // item-scoped query WHILE OPEN (useProofsForItemText) rather than a global
  // stream. Satisfaction stays a pure derivation (src/data/doubts.ts); this read
  // never gates a Mark (ADR 0001) and does not touch the Moments machinery below.
  const { proofs: myProofs } = useMyProofs(uid);
  const claimMode: ClaimMode = event?.claimMode ?? 'honor';

  const [celebrate, setCelebrate] = useState<null | 'bingo' | 'blackout'>(null);
  const [freePulse, setFreePulse] = useState(0);
  const [proofTarget, setProofTarget] = useState<Cell | null>(null);
  const [tallyTarget, setTallyTarget] = useState<Cell | null>(null);
  // The Day switcher's viewed-Day index (daily-cards-spec § "Day switcher"),
  // independent of the app-wide Theme (ThemeContext) and of the header's
  // "today" line (Nav.tsx, #203) — this state ONLY drives the board area's
  // own retint and which Day's chrome/preview renders here. Defaults to
  // today's Day the first render `event.days` arrives non-empty (the
  // adjust-during-render pattern already used elsewhere in this file, e.g.
  // `edgeStateUid` below); `viewedIndexInitialized` guards it to ONE
  // adoption so a later render never stomps the Player's own selection.
  const [viewedIndex, setViewedIndex] = useState(0);
  const viewedIndexInitialized = useRef(false);
  // The locked/unlocked read below (`viewedLocked`) is only re-evaluated on a
  // render — with no OTHER state change due while idling on a locked Day, a
  // player who leaves the Card tab open across an `unlockAt` rollover (e.g.
  // the 8:00 ship-time unlock) would stay stuck on `LockedDayPreview` until
  // a reload or unrelated interaction (Codex P2, PR #230). `now` stands in
  // for `Date.now()` everywhere a lock check reads the clock, and this timer
  // bumps it exactly when the EARLIEST still-locked Day's `unlockAt` in the
  // whole schedule passes — not just the viewed Day, so switching to an
  // already-elapsed chip never needs its own reschedule. Depends on
  // `event?.days` (not the `days` local below, which is a fresh `[]`
  // literal on every render while unmigrated) so it doesn't re-schedule on
  // every unrelated render.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const schedule = event?.days ?? [];
    const nextUnlock = schedule
      .map((d) => d.unlockAt)
      .filter((t) => t > Date.now())
      .sort((a, b) => a - b)[0];
    if (nextUnlock == null) return;
    const timer = setTimeout(() => setNow(Date.now()), nextUnlock - Date.now());
    return () => clearTimeout(timer);
  }, [event?.days, now]);
  // Edge refs for the COSMETIC Celebration UI only (issue #104). The public Moment
  // broadcast moved OFF this snapshot-diffing machinery and ONTO the action path —
  // doMark reads `setMark`'s synchronous win-transition verdict and enqueues into a
  // MODULE-scope pending queue that survives Board unmounts (src/data/moments.ts) —
  // so these refs no longer drive any Feed write. They serve one purpose now: fire
  // the local celebrate animation on the transition into a bingo/blackout, without
  // re-celebrating a win that ALREADY stood on first paint (a returning Player).
  // `initialized` holds that "baseline the first snapshot, detect edges after" rule;
  // the account-switch reset below re-establishes it per uid.
  // #176: the bingo edge tracks the COUNT of completed lines (not a boolean), so
  // a 2nd/3rd bingo line re-fires the animation. wasBlackout stays boolean.
  const wasBingoLines = useRef(0);
  const wasBlackout = useRef(false);
  const initialized = useRef(false);

  // Account switch: the celebration edge state is per-uid, and the reset must run
  // BEFORE any effect of the uid-switch render — an effect-based reset raced the
  // still-stale subscription rows (useBoard/useMyPlayer return the PREVIOUS uid's
  // data for the render(s) before their keyed effects clear it), which could seed
  // the new account's celebration baseline from the OLD board. React's
  // adjust-during-render pattern: on a uid mismatch, restore the uninitialized
  // baseline synchronously (idempotent per uid, StrictMode-safe), and the
  // attribution gate below keeps the stale board out of this same render's effect.
  // The pending Moment queue needs NO reset here — it is module state keyed BY uid
  // (src/data/moments.ts), so a held win for the previous account can never drain
  // under the new one.
  const edgeStateUid = useRef(uid);
  if (edgeStateUid.current !== uid) {
    edgeStateUid.current = uid;
    initialized.current = false;
    wasBingoLines.current = 0;
    wasBlackout.current = false;
  }

  const cells: Cell[] = board?.cells ?? [];
  // Attribution gate (round 2 finding B): board data is usable for edge state only
  // when the doc actually belongs to the CURRENT uid. During an account switch the
  // subscription still returns the previous uid's board for a render, and the
  // render-time reset above cannot stop this render's cells effect from seeding it
  // — this gate does. BoardDoc carries its owner's uid, so the check is direct.
  const cellsAttributable = board != null && board.uid === uid;

  // A Tally sheet's SOURCE Square is live only while the CURRENT account's board
  // still holds that cell marked, non-free, and carrying the SAME Prompt (Codex
  // P2, PR #106 round 6 — the #110 attribution-guard class applied to the Doubt
  // write path). `cellsAttributable` folds the account-identity half: another
  // uid's board validates nothing.
  const tallySourceLive = (target: Cell): boolean => {
    if (!cellsAttributable) return false;
    const cell = cells.find((c) => c.index === target.index);
    return cell != null && !cell.free && cell.marked && cell.itemId === target.itemId;
  };
  // Close a DANGLING sheet the moment its source dies — the account switched under
  // it, or the source Square unmarked in another tab — using the same
  // adjust-during-render pattern as the per-uid reset above (an effect could race
  // a tap by one commit; this runs before anything renders). Clearing the STATE
  // (not just gating the render) also stops a later re-mark from resurrecting a
  // sheet the Player already saw close. Idempotent: the very next render sees
  // tallyTarget null.
  if (tallyTarget && !tallySourceLive(tallyTarget)) setTallyTarget(null);

  // ProofSheet's SOURCE Square is live only while the CURRENT account's board
  // still holds the SAME Prompt at that cell in the SAME marked state the sheet
  // opened against (Codex P2, PR #184 — the tallySourceLive class applied to the
  // proof/pledge surface). An account switch can land the NEW uid's board under
  // an OPEN sheet: `cellsAttributable` alone then passes, and a pledge would
  // mark the captured index on the WRONG card. The marked-state check also
  // closes a claim sheet whose Square another tab claimed meanwhile (its pledge
  // has nothing left to claim) and a proof-add sheet whose Mark fell. Note the
  // sheet's own attachProof success races its board echo here: the echo flips
  // the cell to marked and this close can fire just before submit's onClose —
  // both paths null the same state, so the double-close is idempotent.
  const proofSourceLive = (target: Cell): boolean => {
    if (!cellsAttributable) return false;
    const cell = cells.find((c) => c.index === target.index);
    return cell != null && !cell.free && cell.itemId === target.itemId && cell.marked === target.marked;
  };
  if (proofTarget && !proofSourceLive(proofTarget)) setProofTarget(null);

  // The latest identity + roster + gate signals + CURRENT attributable cells for
  // Moment broadcasts, stored in a ref so `drainMoments` (a stable callback)
  // always reads the CURRENT actor, gate state, and board, never a stale render's
  // closure. Written every render. photoURL mirrors ProofSheet: a loaded player
  // row's null photo wins over the stale auth photo. The name is the SAME resolved
  // public identity the Tally + Proof carry; moments.ts bounds it to the rules'
  // ≤100 contract. `cells` (attribution-gated: another uid's board contributes
  // NOTHING) is back here for the drain's FIRE-TIME REVALIDATION (Codex P2, PR
  // #110 finding 3, restoring the PR #99 round-3 invariant on the queue path): a
  // held win can fall without any local unmark verdict — another tab unmarks, a
  // rules rollback lands as a passive snapshot — so a drain must never publish
  // without re-checking the win against the board as it stands at fire time.
  const feedCtx = useRef<{
    uid: string | undefined;
    displayName: string;
    photoURL: string | null;
    players: PlayerDoc[];
    identityKnown: boolean;
    rosterConfirmed: boolean;
    cells: Cell[];
  }>({
    uid: undefined,
    displayName: 'Anonymous',
    photoURL: null,
    players: [],
    identityKnown: false,
    rosterConfirmed: false,
    cells: [],
  });
  feedCtx.current = {
    uid,
    displayName,
    photoURL: player ? player.photoURL : (user?.photoURL ?? null),
    players,
    identityKnown,
    rosterConfirmed,
    cells: cellsAttributable ? cells : [],
  };

  // Write-time twin of `tallySourceLive` for the Doubt raise (Codex P2, PR #106
  // round 6): TallySheet calls this SYNCHRONOUSLY with the raise decision, so the
  // check reads the LATEST rendered board through feedCtx (already
  // attribution-gated — a foreign board contributes NO cells) rather than the
  // sheet's own captured props, which are exactly what goes stale when the account
  // switches or the source Square unmarks under an open sheet. A Doubt is a
  // PERMANENT once-only slot, so the wrong-source write must be stopped at the
  // moment of the write — the render-time close above is the UI layer, this is
  // the write layer (the same belt-and-braces split as toggle + doMark, #110
  // finding 2). Stable ([] deps): reads only the ref.
  const isDoubtSourceLive = useCallback((index: number, itemId: string): boolean => {
    const cell = feedCtx.current.cells.find((c) => c.index === index);
    return cell != null && !cell.free && cell.marked && cell.itemId === itemId;
  }, []);

  // Drain the module-scope pending queue (src/data/moments.ts): fire every held
  // Moment whose gate is now open, reading the LATEST actor + gates from feedCtx
  // (never a stale closure). Called after a mark enqueues (doMark, below) and
  // whenever a gate OPENS (identity resolves / the roster becomes server-confirmed).
  // Two gates:
  //   • Identity (all three, PR #99 finding 1): HOLD until a KNOWN saved identity,
  //     so a returning Player's stale auth/Google name is never stamped into an
  //     IMMUTABLE Moment (the same window setMark passes `undefined`). Because the
  //     queue is MODULE state, a held win survives a Board unmount / route change
  //     and drains on the next mount — the issue #104 fix. (Only a full page reload
  //     can still drop it; documented residual.)
  //   • Roster (first_bingo only, PR #99 finding 2): claim the ceremonial event
  //     singleton only against a SERVER-CONFIRMED roster showing no OTHER Player
  //     with an earlier bingo; while unconfirmed the candidate stays HELD (not
  //     cleared). The per-Player bingo/blackout do NOT wait on the roster.
  // FIRE-TIME REVALIDATION (Codex P2, PR #110 finding 3 — the PR #99 round-3
  // invariant, restored on the queue path): a held win can fall with NO local
  // unmark verdict — another tab unmarks it, or a rules rollback lands as a
  // passive snapshot — so the drain must never publish without re-checking the
  // win against the freshest board it has. `cellsOverride` lets the completing
  // action pass its own folded `res.cells` (doMark) — the authoritative
  // post-action state, since the render-current snapshot has usually not echoed
  // yet at that point; gate-open and snapshot drains use the render-current
  // attributable cells instead. hasBingo/isBlackout are recomputed, and a
  // NON-EMPTY attributable board is required before ANY publish: isBlackout([])
  // is vacuously TRUE ([].every(Boolean)), so the empty-board guard (PR #99
  // round 3 finding B) is load-bearing again on this path.
  //
  // On revalidation FAILURE the drain HOLDS (it does not clear): a drop here
  // would race the latency-compensation echo — a gate can open in the window
  // between the mark and its snapshot, when the rendered cells are still
  // pre-action — and re-lose held wins, the exact #104 bug class. The CLEARS for
  // fallen wins belong to the observers of the fall: doMark's unmark verdict and
  // the cells effect's passive falling edge (both via dropPendingWins, which also
  // bumps the action generation). A flag whose fall this tab never observes can
  // therefore idle un-fireable (revalidation keeps blocking it) until reload —
  // safe: nothing publishes for it.
  const drainMoments = useCallback((cellsOverride?: Cell[]) => {
    const {
      uid: cUid,
      displayName: cName,
      photoURL: cPhoto,
      players: roster,
      identityKnown: idKnown,
      rosterConfirmed: rosterOk,
      cells: cellsRendered,
    } = feedCtx.current;
    if (!cUid || !idKnown) return; // identity gate: hold every kind
    const pending = peekPendingMoments(cUid);
    if (!pending.bingo && !pending.blackout && !pending.firstBingo) return;
    const cellsNow = cellsOverride ?? cellsRendered;
    if (cellsNow.length === 0) return; // no attributable board → hold; never adjudicate vacuously
    const bingoNow = hasBingo(cellsNow);
    const blackoutNow = isBlackout(cellsNow);
    const actor = { uid: cUid, displayName: cName, photoURL: cPhoto };
    if (pending.bingo && bingoNow) {
      broadcastBingo(actor);
      clearPendingMoment(cUid, 'bingo');
    }
    if (pending.blackout && blackoutNow) {
      broadcastBlackout(actor);
      clearPendingMoment(cUid, 'blackout');
    }
    // Ceremonial decision — fully SYNCHRONOUS at publish time (PR #110 round 3
    // findings A + B). Round 2 re-read the witness here, which was WRONG: a
    // roster-held original win fires its plain bingo in an EARLIER drain pass, so
    // by the time the roster opens, the re-read sees this pipeline's own
    // `${uid}-bingo` Moment in the local cache and suppresses the very ceremony
    // that win legitimately raised (finding A). The prior-win question belongs to
    // BIRTH time (the enqueue gauntlet in broadcastWinVerdict) — the only moment
    // "is this a regain?" is answerable without self-interference; observed
    // falls/unmarks kill candidates via the generation stamp besides. And with no
    // async read between the roster decision and the write, a competing
    // firstBingoAt delivered mid-decision can no longer slip past (finding B):
    // `roster` here is feedCtx.current as of THIS synchronous drain, re-read on
    // every attempt — gate-open, snapshot, and action drains alike.
    if (pending.firstBingo && bingoNow && rosterOk) {
      if (!firstBingoCandidateCurrent(cUid)) {
        // Stale candidate (round 2 finding 3a): an observed BINGO fall bumped
        // the generation since this candidate was enqueued — the win context it
        // described no longer holds. KILLED, never fired.
        clearPendingMoment(cUid, 'firstBingo');
      } else {
        // Ceremonial + self-reported (ADR 0001): claim First-to-BINGO only when,
        // as far as this client's CONFIRMED known-players view shows AT PUBLISH
        // TIME, no OTHER Player has bingoed yet — and only while the underlying
        // bingo still STANDS. The race (two clients briefly both believing they
        // are first) resolves to one Moment per Event via the singleton doc id.
        // CONSUME-ON-DECISION: fired and decided-and-lost both clear here, in the
        // same synchronous block as the decision — no async gap can strand a
        // consumed-but-unpublished candidate, and HOLD paths (identity, roster,
        // board, standing-ness) never consume.
        const othersBingoed = roster.some((p) => p.uid !== cUid && p.firstBingoAt != null);
        if (!othersBingoed) broadcastFirstBingo(actor);
        clearPendingMoment(cUid, 'firstBingo');
      }
    }
  }, []);

  // When a gate OPENS — identity resolves, or the roster becomes server-confirmed —
  // drain any Moment held while it was closed (PR #99 findings 1 + 2). The queue
  // itself holds the state across unmounts; this effect just re-attempts the drain.
  useEffect(() => {
    drainMoments();
  }, [identityKnown, rosterConfirmed, drainMoments]);

  // Snapshot effect: the cosmetic Celebration edges (no public writes), PLUS two
  // queue-maintenance duties the PASSIVE stream owns (Codex P2, PR #110 finding 3):
  //   1. Falling-edge clears — a listener snapshot showing a previously-standing
  //      win now GONE (bingo/blackout true→false) means the win fell without any
  //      local unmark verdict (another tab unmarked it, or a rules rollback rolled
  //      the optimistic mark back). The corresponding queued flag is dropped via
  //      dropPendingWins (which also bumps the action generation), so the queue
  //      tracks reality even when no local action observes the fall.
  //   2. Drain attempts — a queued win whose gate is already open still needs a
  //      board to revalidate against; the snapshot that delivers it (a fresh
  //      mount's first board, the latency-compensation echo) triggers the drain.
  useEffect(() => {
    // Attribution gate (round 2 finding B): during an account switch this effect
    // can run one render with the PREVIOUS uid's board still in the subscription;
    // ignore a board that is not the current account's so it neither seeds the
    // celebration baseline, drops/drains queue flags, nor animates.
    if (!cellsAttributable || !cells.length) return;
    // #176: track the COUNT of completed lines, not a boolean, so completing a
    // 2nd/3rd bingo line re-fires the animation (a boolean flips false→true only
    // once). `bingoEdge` is the rising edge vs the previous snapshot's count.
    const { lines: bingoLines, gained: bingoEdge } = bingoLineEdge(cells, wasBingoLines.current);
    const black = isBlackout(cells);
    // Passive falling edges (duty 1) — compared against the PREVIOUS snapshot's
    // state before the refs re-seed below. On a mount's first snapshot the refs
    // are 0/false, so nothing can spuriously read as a fall.
    if (uid) {
      if (wasBingoLines.current > 0 && bingoLines === 0) dropPendingWins(uid, { bingo: true });
      if (wasBlackout.current && !black) dropPendingWins(uid, { blackout: true });
    }
    // Baseline vs detection (round 2 finding C, kept for the animation): under the
    // ADR 0006 persistent cache the first snapshot(s) can be cache-only, and a
    // stale cache lacking a bingo the server already has would make the server
    // confirmation read as a live transition — animating a celebration for a win
    // that already stood. So while the board is NOT server-confirmed every snapshot
    // re-seeds wasBingoLines/wasBlackout without animating (initialized stays false); the
    // first server-confirmed snapshot is baseline too; edge DETECTION runs after it.
    // This is now purely cosmetic (no writes), so the round-3/round-4 local-action
    // machinery the offline MOMENT once needed is gone: a win completed while the
    // board is still cache-only animates when the board confirms — a small cosmetic
    // delay the durable Moment (action path, fires at mark time) does not share.
    if (!boardConfirmed || !initialized.current) {
      wasBingoLines.current = bingoLines;
      wasBlackout.current = black;
      initialized.current = boardConfirmed;
      drainMoments(); // duty 2: even a baseline snapshot delivers a board to revalidate against
      return;
    }
    // #176: fire on a RISING edge in the completed-line COUNT (bingoEdge, computed
    // above), so a 2nd/3rd bingo line re-animates — not just the first. Blackout
    // still takes visual priority; only one animation shows.
    const blackoutEdge = black && !wasBlackout.current;
    if (blackoutEdge) {
      setCelebrate('blackout');
      track('blackout');
    } else if (bingoEdge) {
      setCelebrate('bingo');
    }
    wasBingoLines.current = bingoLines;
    wasBlackout.current = black;
    drainMoments(); // duty 2
  }, [cells, cellsAttributable, boardConfirmed, uid, drainMoments]);

  if (!uid) return null;

  // The Day schedule (daily-cards-spec § "Data model"), read-only off the
  // Event doc — `[]` on a not-yet-migrated Event (eventConverter's default)
  // or while it's still loading, which keeps every switcher/retint/locked-
  // preview addition below completely inert and Board's pre-existing
  // single-Board rendering exactly as it was (every test fixture that
  // doesn't set `event.days` exercises that untouched path).
  const days: DayDef[] = event?.days ?? [];
  const hasDays = days.length > 0;
  // Adopt today's Day as the viewed default the FIRST render `days` is
  // non-empty; guarded to fire once so it can never override a Player's own
  // later chip tap (adjust-during-render, mirroring `edgeStateUid` above).
  if (!viewedIndexInitialized.current && hasDays) {
    viewedIndexInitialized.current = true;
    setViewedIndex(defaultViewedIndex(days, Date.now()));
  }
  const viewedDay = hasDays ? (days[viewedIndex] ?? days[0]) : undefined;
  // `now`, not `Date.now()` — see the unlock timer above (Codex P2, PR #230):
  // this read must be the SAME clock the timer bumps, so the rollover flips
  // the lock via a state update instead of only on the next unrelated render.
  const viewedLocked = viewedDay != null && viewedDay.unlockAt > now;
  const daySwitcher = hasDays ? (
    <DaySwitcher days={days} viewedIndex={viewedIndex} onSelect={setViewedIndex} />
  ) : null;
  const cardMeta = (
    <div className="card-meta">
      <span>
        {event?.name ? eventTitle(event.name, event.sailStart, event.sailEnd) : 'This cruise'}
      </span>
    </div>
  );

  // A locked viewed Day never has a Board to deal or show — this branch is
  // orthogonal to the `!board` guard below, which is about the ONE existing
  // (today's) Board this Player already has. Per-Day Board fetching is
  // #204's scope; this ticket only decides WHICH chrome to render for the
  // viewed Day (daily-cards-spec § "Locked Day preview"). No inline
  // Guidelines mount here (#208 retired every Board-inline/pathname-gated
  // AcceptableUse mount for the single More-menu row —
  // w3-security-hardening.test.tsx "reachable from every signed-in route"):
  // the tab bar (Nav, App.tsx) renders alongside Board regardless of lock
  // state, so More — and Guidelines inside it — stays reachable on a locked
  // Day exactly like any other route, with no per-branch mount needed.
  if (viewedDay && viewedLocked) {
    return (
      <>
        {cardMeta}
        {daySwitcher}
        <LockedDayPreview day={viewedDay} timezone={event?.timezone} />
      </>
    );
  }

  if (!board) {
    // A Board is dealt once at join from the active, non-free Prompt pool
    // (ADR 0003). dealBoard needs >= MIN_POOL prompts (ADR 0004); with fewer the
    // deal throws and no Board is ever written, so a bare `!board` check would
    // spin on "Dealing…" forever. Detect the thin pool here and surface the
    // guard to the Player rather than the blank card AC forbids. While either
    // subscription is still loading we can't tell a thin pool from an unfetched
    // board or a deal in flight, so keep the neutral state until both resolve —
    // this also avoids flashing the guard at a returning Player whose already
    // dealt board is mid-fetch when the pool has since gone thin. `loading`
    // alone is not enough under the ADR 0006 persistent cache (Codex P2, PR #66
    // round 4): a cold/stale IndexedDB can resolve both listeners FROM CACHE
    // with board=null and items=[], which would flash "0 prompts" at a Player
    // whose server state is a healthy pool or an existing Board — so the alert
    // additionally requires both subscriptions' hasServerData latch (a
    // server-confirmed snapshot has arrived). Cache-only data keeps the neutral
    // state below. (Pool-recovery has TWO recovery paths once a deal has failed:
    // the DealError panel's manual Retry, and the shell-level auto-retry that fires
    // when the pool crosses MIN_POOL upward — #70, src/components/PoolRecoveryWatcher.tsx.
    // This pre-deal empty state only explains the shortage; the auto-retry watches
    // the post-failure DealError state, not this one, so this copy still must not
    // promise automatic dealing here.)
    const activePool = items.filter((i) => !i.isFreeSpace);
    if (
      !boardLoading &&
      !poolLoading &&
      boardConfirmed &&
      poolConfirmed &&
      activePool.length < MIN_POOL
    ) {
      return (
        <>
          {daySwitcher}
          <div className="center muted" role="alert">
            <p>Not enough prompts to deal a full card yet.</p>
            <p>
              A card needs {MIN_POOL} prompts; the pool has {activePool.length}. Add prompts from the
              Prompts tab, then retry dealing from the Card tab.
            </p>
          </div>
        </>
      );
    }
    return (
      <>
        {daySwitcher}
        <LoadingState label="Dealing your card…" />
      </>
    );
  }

  const wins = winningCells(cells);

  const doMark = async (c: Cell, nextMarked: boolean) => {
    // Attribution guard (Codex P2, PR #110 finding 2 — the SAME cellsAttributable
    // derivation the Celebration baseline uses): during an account switch the
    // subscription can still expose the PREVIOUS uid's board for a render, and a
    // tap landing in that render would fold the previous account's cells into the
    // current uid's board write AND feed its verdict into an immutable Moment
    // broadcast attributed to the current uid. Bail entirely — no setMark, no
    // enqueue; the next attributable render accepts taps normally.
    if (!cellsAttributable) return;
    try {
      const res = await setMark({
        uid,
        cells,
        index: c.index,
        nextMarked,
        claimMode,
        currentFirstBingoAt: knownFirstBingoAt(player, playerLoading, playerConfirmed),
        displayName: identityKnown ? displayName : undefined,
      });
      track('mark_square', { mode: claimMode, marked: nextMarked });
      if (nextMarked && res.bingo) track('bingo');
      if (nextMarked) {
        // Feed Moment broadcast on the ACTION path (issue #104): the win is tied
        // to the mark that COMPLETED it — setMark's synchronous transition
        // verdict — not to a snapshot diff that dies on unmount. Shared with the
        // proofed-mark path (attachProof returns the same verdict shape).
        await broadcastWinVerdict(res);
      } else {
        // Action-driven falling edge (issue #104, hardened by PR #110 finding 1):
        // an unmark whose verdict shows a win no longer stands DROPS its
        // still-held broadcast — a win completed-then-unmarked BEFORE its gate
        // opens never posts (a bingo fall also drops the ceremonial candidate) —
        // and an unmark that actually DROPS the bingo bumps the action generation
        // so an in-flight witness continuation from an earlier mark is invalidated
        // (round 4: a NON-falling unmark — another line still standing — bumps
        // nothing, so a legitimate ceremony mid-witness-read survives it). An already-drained
        // flag is a harmless no-op (the Moment is immutable + once-only besides).
        dropPendingWins(uid, { bingo: !res.bingo, blackout: !res.blackout });
        // Drain with the action's own folded cells (see broadcastWinVerdict) —
        // skipped if the account switched while the await was in flight (the
        // shared post-await revalidation; no generation to compare — this very
        // action just bumped it).
        if (revalidateAfterAwait(uid).isCurrentAccount) drainMoments(res.cells);
      }
    } catch {
      /* Neither an offline Mark nor an online write REJECTION lands here:
         setMark's commit is fire-and-forget. Offline it queues durably in the
         persistent cache (ADR 0006, #20) and syncs on reconnect; an online
         rejection is logged inside setMark and self-corrects when Firestore
         rolls the write back and the live listener re-renders without the Mark.
         This catch only guards a synchronous throw from setMark itself — no
         write happened and no Moment was enqueued, so there is nothing to
         broadcast or undo. */
    }
  };

  // The shared POST-AWAIT revalidation (PR #110 round 3, findings B + D): every
  // async continuation in the broadcast pipeline re-checks the world through this
  // ONE helper, synchronously after its last await, before acting on anything it
  // captured earlier — the invariant is structural, not per-call-site. Two
  // separable answers, used by need:
  //   • `generationUnchanged` — no OBSERVED BINGO FALL interleaved for the ACTED
  //     account since `capturedGeneration` (round 4: non-falling unmarks and
  //     blackout-only falls do not bump): a stale action never acts.
  //     (Omit the argument where the action itself just bumped, e.g. an unmark.)
  //   • `isCurrentAccount` — the acted account still drives this Board. Required
  //     for steps that touch the CURRENT context (draining with the current
  //     actor/gates). Deliberately NOT required for ENQUEUES (finding D chosen
  //     semantics): the queue is uid-keyed, so a candidate enqueued for the acted
  //     uid under a switched account cannot leak — it simply waits, and drains
  //     when that account returns. A skipped drain therefore destroys nothing:
  //     consumption happens only at the drain's synchronous decision point.
  const revalidateAfterAwait = (actedUid: string, capturedGeneration?: number) => ({
    generationUnchanged:
      capturedGeneration === undefined || pendingActionGeneration(actedUid) === capturedGeneration,
    isCurrentAccount: feedCtx.current.uid === actedUid,
  });

  // ONE completing-action broadcast pipeline for BOTH mark paths (issue #104 +
  // PR #110 round 2 finding 1): the bare honor Mark (doMark → setMark) and the
  // proofed Mark (ProofSheet → attachProof) return the SAME win verdict shape.
  // Enqueue the Moment(s) the verdict reports, run the ceremonial BIRTH-TIME
  // witness + generation gauntlet, then drain with the action's own folded cells
  // — the authoritative post-action board (the render-current snapshot has
  // usually not echoed yet), so the drain's fire-time revalidation sees the state
  // this verdict came from. Whatever gate is still closed stays queued (surviving
  // an unmount / route change) and drains on the next gate-open. This covers the
  // OFFLINE honor win for free: setMark computes the transition from the local
  // cache and the Moment `setDoc` pends durably (ADR 0006). attachProof cannot
  // run offline at all (its transaction rejects), so its verdict is always an
  // online fact.
  const broadcastWinVerdict = async (res: {
    cells: Cell[];
    bingoTransition: boolean;
    blackoutTransition: boolean;
  }) => {
    enqueueWinMoments({
      uid,
      bingoTransition: res.bingoTransition,
      blackoutTransition: res.blackoutTransition,
    });
    // The BIRTH-TIME witness (round 2 finding D; made the SOLE witness site by
    // round 3 finding A): the prior-win question — "is this win a regain?" — is
    // answerable only HERE, at the moment the win happened, before this
    // pipeline's own plain bingo posts. (Round 2's drain-time re-read saw that
    // just-written `${uid}-bingo` doc when a roster-held ceremony finally
    // drained, and suppressed the original win's own ceremony — finding A.) A
    // regained line whose owner already has a `${uid}-bingo` Moment in the local
    // cache never mints a candidate; a cache miss (fresh device) resolves false,
    // so the drain's publish-time roster gate is the fallback (the narrowed
    // residual the spec documents).
    //
    // The read is ASYNC, and the pending win can change inside that gap (round 1
    // P1): the player can unmark and LOSE the bingo while the read is in flight.
    // The continuation therefore re-checks through the shared post-await
    // revalidation: the captured ACTION GENERATION must be unchanged (every
    // OBSERVED BINGO FALL bumps it — round 4: a non-falling unmark does not,
    // so it cannot suppress a ceremony whose bingo stands continuously). It is deliberately NOT gated on the
    // pending bingo flag (round 2 finding 2: a concurrent drain can legitimately
    // FIRE the plain bingo mid-read — that clear says the win STOOD) and NOT
    // gated on the current account (round 3 finding D: the queue is uid-keyed,
    // so the enqueue cannot leak — the candidate waits for the acted account).
    if (res.bingoTransition) {
      const generation = pendingActionGeneration(uid);
      const witnessed = await hasPriorBingoWitness(uid);
      if (!witnessed && revalidateAfterAwait(uid, generation).generationUnchanged) {
        enqueueFirstBingoMoment(uid);
      }
    }
    // Draining touches the CURRENT actor/gates, so it does require the acted
    // account to still be active; the queue keeps the flags otherwise.
    if (revalidateAfterAwait(uid).isCurrentAccount) drainMoments(res.cells);
  };

  const toggle = (c: Cell) => {
    // The shared attribution guard (PR #110 finding 2, widened in round 2):
    // NO action may start from a render still showing another account's board —
    // an honor mark would fold the wrong cells (doMark also guards, belt-and-
    // braces), and a proof sheet would open against the wrong card.
    if (!cellsAttributable) return;
    if (c.free) {
      setFreePulse((pulse) => pulse + 1);
      return;
    }
    if (c.marked) {
      doMark(c, false); // unmark is always instant
      return;
    }
    // EVERY claim opens the ProofSheet (issue #181) — honor included, which
    // used to mark instantly here. In honor mode the sheet's 🎖️ Cross My Heart
    // pledge (onPledge below) is the one-tap path back to that same bare Mark;
    // proof_required / admin_confirmed still require a real capture.
    setProofTarget(c);
  };

  return (
    <>
      {/* Just the cruise name here — the claim-mode label used to share this row
          and force the title to wrap on mobile (#150). The mode still governs
          behavior via `claimMode` above (proof-required opens the proof sheet on
          tap); it just no longer competes with the title for the line. */}
      {cardMeta}
      {daySwitcher}
      {/* `board-area` is the retint scope (daily-cards-spec § "Day switcher"):
          `data-theme` here — set ONLY when the Event carries a Day schedule —
          follows the VIEWED Day and cascades the theme token set (themes.css)
          to just this chrome, leaving `<html>`'s own `data-theme` (the
          Player's own Theme choice, ThemeContext) untouched. Absent entirely
          on a not-yet-migrated Event (`hasDays` false), so the pre-Phase-1.5
          single-Board rendering is byte-identical to before. */}
      <div className="board-area" data-theme={viewedDay?.theme}>
        <div className="bingo-head">
          {['B', 'I', 'N', 'G', 'O'].map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
        {/* `data-server-confirmed` mirrors useBoard's `hasServerData` latch — the
          first SERVER-backed board snapshot (vs the latency-compensated cache
          echo that can arrive first). It carries no styling; it is the
          deterministic signal the e2e suite waits on before tapping a winning
          line, so a BINGO that lands while the board is still cache-only (which
          the Celebration baseline above would swallow as an initial state, not
          an animated edge) cannot flake the BINGO! assertion (Codex P2 on
          PR #114 round 3). */}
        <div className="grid" data-server-confirmed={boardConfirmed ? 'true' : 'false'}>
        {cells.map((c) => (
          <div
            key={c.index}
            className={
              'cell' +
              (c.free ? ' free' : '') +
              (c.marked ? ' marked' : '') +
              (c.status === 'pending' ? ' pending' : '') +
              (wins.has(c.index) ? ' win' : '') +
              (c.free && freePulse > 0 ? (freePulse % 2 ? ' free-pulse-a' : ' free-pulse-b') : '')
            }
            role={c.free ? 'button' : undefined}
            tabIndex={c.free ? 0 : undefined}
            aria-label={c.free ? c.text : undefined}
            title={c.free ? 'Free space—already marked' : undefined}
            onClick={() => toggle(c)}
            onKeyDown={(event) => {
              if (c.free && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                toggle(c);
              }
            }}
            onAnimationEnd={() => {
              if (c.free) setFreePulse(0);
            }}
          >
            {c.free ? (
              <>
                <span className="free-label" aria-hidden="true">
                  FREE
                </span>
                <span className="free-prompt">{c.text}</span>
              </>
            ) : (
              c.text
            )}
            {c.marked && !c.free && (
              <button
                className="proofbtn"
                title="Add proof"
                onClick={(e) => {
                  // stopPropagation bypasses `toggle`, so this handler needs the
                  // shared attribution guard itself (PR #110 round 3 finding C):
                  // during an account switch this cell can belong to the PREVIOUS
                  // uid's board, and a sheet opened from it would attach a proof
                  // (and broadcast a Moment) for the current uid off the wrong card.
                  e.stopPropagation();
                  if (!cellsAttributable) return;
                  setProofTarget(c);
                }}
              >
                ＋
              </button>
            )}
            {c.marked && !c.free && c.itemId && (
              // Same guard for the Tally who-list (finding C sweep): read-only, but
              // a stale render must not open another board's Prompt sheet either.
              <TallyBadge
                itemId={c.itemId}
                onOpen={() => {
                  if (cellsAttributable) setTallyTarget(c);
                }}
              />
            )}
            {c.marked && !c.free && c.itemId && (
              <DoubtBadge
                itemId={c.itemId}
                itemText={c.text}
                targetUid={uid}
                proofs={myProofs}
                onOpen={() => {
                  // The same attribution guard as the TallyBadge open above (the
                  // #110 finding-C sweep — this open was missed; round 6 closes it):
                  // a stale render must not open the who-list against another
                  // account's board.
                  if (cellsAttributable) setTallyTarget(c);
                }}
              />
            )}
          </div>
        ))}
        </div>
      </div>
      <div className="count">
        Marked <b>{countMarked(cells)}</b> · Bingos <b>{player?.bingoCount ?? 0}</b>
      </div>
      {/* `cells` fixes the empty-card share race (Codex P2, PR #111 finding
          1): Celebration used to open its own useBoard(uid) listener and
          could render/share before that listener's own first snapshot
          arrived. Board already has the loaded `cells` right here
          (guaranteed by the `!board` early-return above), so handing them
          down as a prop removes the race instead of letting Celebration
          re-fetch what this component already has. `playerName` is the
          identity twin (round 2 finding 1): the SAME resolved public name
          the Tally/Proof/Moment paths carry, gated by the SAME identityKnown
          tri-state — null while the saved row is unknown, so Celebration
          disables Share instead of ever stamping the stale auth fallback
          onto a card (mirrors doMark's `identityKnown ? displayName :
          undefined`). */}
      {celebrate && (
        <Celebration
          kind={celebrate}
          cells={cells}
          playerName={identityKnown ? displayName : null}
          onClose={() => setCelebrate(null)}
        />
      )}
      {proofTarget && user && (
        <ProofSheet
          uid={uid}
          // Attribute new proofs to the denormalized player identity, which the
          // profile editor keeps current (data/profile.ts writes users/{uid} +
          // the player row, #76). Sourcing straight from the Firebase Auth user
          // would stamp the stale Google name onto proofs a renamed player
          // creates. displayName reuses the single `displayName` resolved above,
          // so a Proof and its Tally marker always carry the SAME name — one
          // source, never two. photoURL keys on whether `player` is loaded rather
          // than `??`-chaining: PlayerDoc.photoURL is nullable, and a loaded row
          // with a null photo means "no avatar" — that null must win over the
          // stale auth photo, not be masked by it.
          displayName={displayName}
          photoURL={player ? player.photoURL : (user.photoURL ?? null)}
          cells={cells}
          cell={proofTarget}
          claimMode={claimMode}
          currentFirstBingoAt={player?.firstBingoAt ?? null}
          // The proofed-mark completion verdict (PR #110 round 2 finding 1): a
          // successful attachProof reports the SAME win-transition shape setMark
          // returns, and it rides the SAME broadcast pipeline — a proof_required
          // win posts its Moment exactly like an honor win. (In admin_confirmed
          // the attached cell is pending and excluded from the win mask, so the
          // verdict is structurally transition-free — the confirm-path Moment
          // stays #41's.) Fire-and-forget: the sheet closes without waiting on
          // the witness read.
          onAttached={(res: AttachProofResult) => void broadcastWinVerdict(res)}
          // The 🎖️ Cross My Heart pledge (issue #181), offered only on a CLAIM
          // open — an unmarked Square's tap. It is the bare honor Mark the tap
          // used to make directly: doMark carries the verdict through the same
          // broadcast pipeline, and the mark queues offline exactly as before
          // (ADR 0006 — a pledge is a setMark, never a transaction). A ＋-button
          // proof-add open (marked cell) omits it: the Square is already
          // claimed, so ProofSheet hides the row entirely.
          onPledge={
            proofTarget.marked
              ? undefined
              : () => {
                  const target = proofTarget;
                  setProofTarget(null);
                  // Write-time twin of the render-time proofSourceLive close
                  // above (Codex P2, PR #184) — the same belt-and-braces split
                  // as toggle + doMark: a tap queued before the closing render
                  // commits must not mark a captured target the current board
                  // no longer backs. Dead source → close only, write nothing.
                  if (!proofSourceLive(target)) return;
                  void doMark(target, true);
                }
          }
          onClose={() => setProofTarget(null)}
        />
      )}
      {tallyTarget && tallyTarget.itemId && (
        <TallySheet
          itemId={tallyTarget.itemId}
          itemText={tallyTarget.text}
          cellIndex={tallyTarget.index}
          meUid={uid}
          meName={identityKnown ? displayName : undefined}
          identityKnown={identityKnown}
          isSourceLive={isDoubtSourceLive}
          onClose={() => setTallyTarget(null)}
        />
      )}
    </>
  );
}
