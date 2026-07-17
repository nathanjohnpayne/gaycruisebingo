import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Pause } from 'lucide-react';
import { useFeed, useEventDoc, useMyDayBoards, useAllDoubts, useMyPlayer } from '../hooks/useData';
import { requestOpenSquare } from '../hooks/useOpenSquare';
import { useAuth } from '../auth/AuthContext';
import { reportProof, deleteProof } from '../data/proofs';
import { resolveDisplayName } from '../data/api';
import { track } from '../analytics';
import Avatar from './Avatar';
import { safeMediaUrl } from './safeMediaUrl';
import { tutorialDayIndexSet, ceremonialDayIndexSet, standingsFrozen } from '../game/logic';
import { isDoubtSatisfied, openDoubts, doubtStatusFor, raiseDoubt } from '../data/doubts';
import { THEMES } from '../theme/themes';
import type {
  BoardDoc,
  DayDef,
  DoubtDoc,
  LastCallMomentPayload,
  MomentDoc,
  MomentKind,
  PodiumMomentPayload,
  ProofDoc,
  TallyCard as TallyCardData,
  TallyEntry,
} from '../types';

// The Feed Day chip label (#211, emoji per #262): "Day 3 · ✈️ Duty Free" — a
// 1-based Day number plus the Day's theme emoji + label from
// EventDoc.days[dayIndex] → THEMES, degrading to a bare "Day N" when the Day
// or its theme can't be resolved.
function dayChipLabel(dayIndex: number, days: DayDef[] | undefined): string {
  const day = days?.[dayIndex];
  const theme = day ? THEMES.find((t) => t.id === day.theme) : undefined;
  return theme ? `Day ${dayIndex + 1} · ${theme.emoji} ${theme.label}` : `Day ${dayIndex + 1}`;
}

// "3:47p" — the wireframes' compact clock on proof cards (#262), in the event
// timezone so the Feed reads as the ship's diary. Falls back to the host zone
// on a malformed timezone.
function clockLabel(ts: number, timezone: string | undefined): string {
  const opts = { hour: 'numeric', minute: '2-digit', hour12: true } as const;
  let parts: string;
  try {
    parts = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: timezone || undefined }).format(new Date(ts));
  } catch {
    parts = new Intl.DateTimeFormat('en-US', opts).format(new Date(ts));
  }
  return parts.replace(/\s?(A|P)M$/i, (_m, ap: string) => ap.toLowerCase());
}

// How many Doubts THIS Proof answered (#262 — the wireframes' "👀 cleared 2
// doubts" pill): Doubts against the prover on the same Prompt whose window
// this Proof satisfies. Doubts carry itemId; the Feed's own tally entries
// provide the itemId → itemText mapping (a doubted Mark implies a marker).
export function doubtsClearedByProof(
  proof: Pick<ProofDoc, 'id' | 'uid' | 'itemText' | 'createdAt'>,
  doubts: readonly DoubtDoc[],
  itemTextById: ReadonlyMap<string, string>,
  // Every proof the Feed knows (Codex P2, #286 round 2): a once-only Doubt
  // belongs to the EARLIEST satisfying proof, so a player stacking later
  // proofs on the same Prompt doesn't wear "cleared 1 doubt" on every card.
  // Defaults to just this proof (the pre-round-2 behavior) for callers with
  // no stream in hand.
  allProofs: readonly Pick<ProofDoc, 'id' | 'uid' | 'itemText' | 'createdAt'>[] = [],
): number {
  return doubts.filter((d) => {
    if (d.targetUid !== proof.uid || itemTextById.get(d.itemId) !== proof.itemText) return false;
    if (!isDoubtSatisfied(d, proof.itemText, [proof])) return false;
    // Once-only: an EARLIER satisfying proof (createdAt, then id, ascending —
    // a deterministic order) owns this Doubt's pill instead.
    return !allProofs.some(
      (p) =>
        p.id !== proof.id &&
        (p.createdAt < proof.createdAt || (p.createdAt === proof.createdAt && p.id < proof.id)) &&
        isDoubtSatisfied(d, proof.itemText, [p]),
    );
  }).length;
}

function ago(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Focus-trap query (mirrors ProfileEditor.tsx's FOCUSABLE_SELECTOR) — every
// element type `FeedWhoListSheet`'s Tab trap below needs to cycle between.
const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

// A Moment's celebratory line by kind (ADR 0002): it announces *that* a beat
// happened — no media, no evidence. The fallback keeps a malformed/forward-compat
// kind from crashing the Feed.
const MOMENT_COPY: Record<MomentKind, { icon: string; line: string }> = {
  bingo: { icon: '🎉', line: 'got a BINGO!' },
  blackout: { icon: '🖤', line: 'blacked out the whole card!' },
  first_bingo: { icon: '👑', line: 'was First to BINGO!' },
  // Phase 1.5 finale beats (daily-cards-spec § "Scoring and social surfaces").
  // The scheduler (#202) posts these; the copy here keeps the exhaustive
  // Record compiling and the Feed rendering them until #207 refines the finale
  // presentation. `last_call` = 20:00 Day 9 standings; `podium` = the Day 10
  // freeze champion beat.
  last_call: { icon: '📣', line: 'posted the final-night standings!' },
  podium: { icon: '🏆', line: 'took the podium!' },
};

function isBannedUid(uid: string | undefined, bannedUids: readonly string[]): boolean {
  return !!uid && bannedUids.includes(uid);
}

function lastCallLineFromPlayers(players: LastCallMomentPayload['players']): string {
  const ranked = [...players].sort((a, b) => {
    if (b.bingoCount !== a.bingoCount) return b.bingoCount - a.bingoCount;
    if (b.squaresMarked !== a.squaresMarked) return b.squaresMarked - a.squaresMarked;
    return a.displayName.localeCompare(b.displayName);
  });
  const leader = ranked[0];
  const freeze = 'standings freeze at 8 a.m';

  if (!leader || (leader.bingoCount === 0 && leader.squaresMarked === 0)) {
    return `The board's wide open going into the final night—${freeze}.`;
  }
  const runnerUp = ranked[1];
  if (!runnerUp) {
    return `${leader.displayName} has the board to themselves going into the final night—${freeze}.`;
  }
  const bingoMargin = leader.bingoCount - runnerUp.bingoCount;
  if (bingoMargin > 0) {
    return `${leader.displayName} leads by ${bingoMargin} bingo${bingoMargin === 1 ? '' : 's'}—${freeze}.`;
  }
  const squareMargin = leader.squaresMarked - runnerUp.squaresMarked;
  if (squareMargin > 0) {
    return `${leader.displayName} leads by ${squareMargin} square${squareMargin === 1 ? '' : 's'}—${freeze}.`;
  }
  return `It's neck and neck at the top going into the final night—${freeze}.`;
}

function visibleLastCallLine(moment: MomentDoc, bannedUids: readonly string[]): string | undefined {
  if (moment.kind !== 'last_call') return undefined;
  if (moment.lastCall?.players) {
    return lastCallLineFromPlayers(moment.lastCall.players.filter((p) => !isBannedUid(p.uid, bannedUids)));
  }
  // Legacy last-call Moments only carry a pre-rendered string, so a later ban
  // cannot be applied safely. Fail closed when any ban is active.
  return bannedUids.length > 0 ? undefined : moment.line;
}

function visiblePodium(podium: PodiumMomentPayload | undefined, bannedUids: readonly string[]): PodiumMomentPayload | undefined {
  if (!podium) return undefined;
  return {
    champion: isBannedUid(podium.champion?.uid, bannedUids) ? null : podium.champion,
    firstBingo: isBannedUid(podium.firstBingo?.uid, bannedUids) ? null : podium.firstBingo,
    dailyHonors: podium.dailyHonors.filter((h) => !isBannedUid(h.uid, bannedUids)),
  };
}

/**
 * A Proof card — the existing Feed entry (report ⚑, owner-delete 🗑, a "flagged
 * for review" badge, and the captured media by type). The media URL is
 * scheme-guarded (`safeMediaUrl`) before it reaches an <img>/<audio> src (CodeQL
 * js/xss-through-dom #1): mediaURL is resolved from a Firestore doc, so a forged
 * non-media scheme (javascript:, …) is dropped rather than rendered.
 */
function ProofCard({
  proof,
  viewerUid,
  days,
  timezone,
  isStandingsFrozen,
  clearedDoubts = 0,
  tallyCount = 0,
}: {
  proof: ProofDoc;
  viewerUid: string | undefined;
  days: DayDef[] | undefined;
  timezone?: string;
  isStandingsFrozen: () => boolean;
  // #262 — the wireframes' footer pills: how many Doubts this Proof answered,
  // and the Prompt's live tally. Zero hides the pill.
  clearedDoubts?: number;
  tallyCount?: number;
}) {
  const media = safeMediaUrl(proof.mediaURL);
  return (
    <div className="proof">
      <div className="row" style={{ border: 'none', background: 'none', padding: 0 }}>
        <Avatar name={proof.displayName} src={proof.photoURL} size={30} />
        <div className="grow">
          <div className="name" style={{ fontSize: 14 }}>{proof.displayName}</div>
          <div className="sub">
            {/* The wireframes' .who line (#262): day chip (theme emoji
                included) + the compact event-tz clock. Absent halves degrade
                gracefully on legacy docs. */}
            {typeof proof.dayIndex === 'number' && (
              <span className="proof-day-chip">{dayChipLabel(proof.dayIndex, days)}</span>
            )}
            {' '}
            {clockLabel(proof.createdAt, timezone)}
          </div>
        </div>
        <button className="iconbtn" title="Report" onClick={() => { reportProof(proof.id).catch(console.error); track('report_item'); }}>
          ⚑
        </button>
        {viewerUid === proof.uid && (
          <button
            className="iconbtn"
            title="Delete"
            onClick={() =>
              // Daily-cards mode (#246): unmark the backing cell on the Proof's OWN
              // day-scoped Board + fold the owner's stats into that Day's bucket.
              // `days` present ⇒ daily; the Proof carries its own `dayIndex`.
              deleteProof(proof.id, proof.storagePath, {
                daily: !!days?.length,
                tutorialDayIndexes: days ? [...tutorialDayIndexSet(days)] : undefined,
                // #265: symmetric with the mark path — the farewell bucket never
                // sums, and a post-freeze deletion never unfolds frozen stats.
                // Evaluated at CLICK time (Codex P2 on #278 round 2): a Feed
                // left open across the freeze boundary must not act on a
                // render-time false.
                ceremonialDayIndexes: days ? [...ceremonialDayIndexSet(days)] : undefined,
                // The GETTER itself (Codex P2 round 4): deleteProof re-checks
                // inside its transaction, after any await.
                statsFrozen: isStandingsFrozen,
              }).catch(console.error)
            }
          >
            🗑
          </button>
        )}
      </div>
      {/* The claimed square, quoted in the wireframes' outlined pill (#262). */}
      <div className="proof-quote-pill">“{proof.itemText}”</div>
      {proof.type === 'photo' && media && (
        <div className="proof-media-wrap">
          {/* #363: the blurred color-matched fill behind the contained photo —
              the SAME safeMediaUrl-guarded value (never a second URL path), so
              the XSS barrier covers both layers; decorative, so hidden from
              a11y. The browser coalesces the duplicate src into one fetch. */}
          <img className="proof-media-blur" src={media} alt="" aria-hidden="true" loading="lazy" />
          <img className="proof-media" src={media} alt="proof" loading="lazy" />
          {/* The transparency overlay (#190/#262): 📷 live for a camera
              capture, 🖼️ library for a picker choice; absent on legacy docs
              with no source stamp. */}
          {proof.source === 'camera' && <span className="proof-src-badge">📷 live</span>}
          {proof.source === 'library' && <span className="proof-src-badge">🖼️ library</span>}
        </div>
      )}
      {proof.type === 'audio' && media && <AudioProof src={media} />}
      {proof.type === 'text' && proof.text && (
        <blockquote className="proof-quote">
          <span aria-hidden="true">✍️</span> “{proof.text}”
        </blockquote>
      )}
      {(clearedDoubts > 0 || tallyCount > 0 || proof.status === 'flagged') && (
        <div className="proof-foot">
          {clearedDoubts > 0 && (
            <span className="pill">
              👀 cleared {clearedDoubts} doubt{clearedDoubts === 1 ? '' : 's'}
            </span>
          )}
          {tallyCount > 0 && <span className="pill">tally {tallyCount}</span>}
          {proof.status === 'flagged' && <span className="badge" style={{ color: '#ff6b6b' }}>flagged for review</span>}
        </div>
      )}
    </div>
  );
}

/**
 * The wireframes' audio proof treatment (#262): a Lucide play/pause button, a
 * decorative waveform bar, and the clip duration — replacing the bare native
 * controls. The <audio> element stays (hidden) as the actual player; duration
 * resolves from loadedmetadata (blank until then — jsdom-safe).
 */
function AudioProof({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState<string | null>(null);
  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) el.pause();
    else void el.play().catch(() => {});
  };
  return (
    <div className="proof-audio">
      <button
        type="button"
        className="proof-audio-play"
        aria-label={playing ? 'Pause proof audio' : 'Play proof audio'}
        onClick={toggle}
      >
        {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
      </button>
      <span className="proof-audio-wave" aria-hidden="true" />
      {duration && <span className="proof-audio-time">{duration}</span>}
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(e) => {
          const d = (e.target as HTMLAudioElement).duration;
          if (Number.isFinite(d)) setDuration(`${Math.floor(d / 60)}:${String(Math.floor(d % 60)).padStart(2, '0')}`);
        }}
      />
    </div>
  );
}

/**
 * A Moment card — a broadcast social beat (ADR 0002). No media, no report/delete:
 * a Moment carries no evidence to dispute, it just marks that something happened.
 * Rendered distinctly from a Proof (the `.moment` chrome + a per-kind line).
 *
 * A blackout Moment additionally NAMES the Day it happened on (daily-cards-spec
 * § "Scoring and social surfaces": "a per-card blackout posts a Moment naming
 * the day", e.g. "blacked out Day 4 · Glamiators") — the same `dayChipLabel`
 * Day chip a Proof/Tally Card renders, degrading to nothing on a pre-`dayIndex`
 * blackout Moment or a legacy (non-daily) Event with no `days[]`.
 */
function MomentCard({ moment, days, bannedUids }: { moment: MomentDoc; days: DayDef[] | undefined; bannedUids: readonly string[] }) {
  const copy = MOMENT_COPY[moment.kind] ?? { icon: '🎉', line: 'made a Moment!' };
  // #266: the finale beats carry their real content when the scheduler built
  // it — the last-call standings line, and the podium's structured payload.
  // Older minimal beats keep the generic line.
  const isFinale = moment.kind === 'last_call' || moment.kind === 'podium';
  const finaleLine = visibleLastCallLine(moment, bannedUids);
  const podium = moment.kind === 'podium' ? visiblePodium(moment.podium, bannedUids) : undefined;
  return (
    <div className={`moment moment-${moment.kind}`}>
      <div className="row" style={{ border: 'none', background: 'none', padding: 0 }}>
        {!isFinale && <Avatar name={moment.displayName} src={moment.photoURL} size={30} />}
        <div className="grow">
          <div className="name" style={{ fontSize: 14 }}>
            {!isFinale && <>{moment.displayName}{' '}</>}
            <span className="moment-line">{finaleLine ?? (podium ? 'The podium is in!' : `${isFinale ? '' : ''}${copy.line}`)}</span>
            {/* Every Moment kind wears the day chip when it carries a Day
                (#262) — bingo/first_bingo payloads gained dayIndex, the finale
                beats carry it from the scheduler — so the Feed reads as a
                cruise diary. Only when the index resolves to a REAL schedule
                Day (Codex P2): the rules bind dayIndex to the schedule only on
                day-suffixed blackout ids, so a forged bingo/first_bingo could
                otherwise wear a "Day 1000" (or "Day 0") chip. Honest daily
                Moments always resolve; a legacy Event has no schedule to name
                a Day from in the first place. */}
            {typeof moment.dayIndex === 'number' && days?.[moment.dayIndex] != null && (
              <>
                {' '}
                <span className="moment-day-chip proof-day-chip">{dayChipLabel(moment.dayIndex, days)}</span>
              </>
            )}
          </div>
          {podium && (
            <div className="moment-podium">
              {podium.champion && (
                <div className="moment-podium-row">
                  🏆 Cruise champion: <b>{podium.champion.displayName}</b> — {podium.champion.bingoCount} bingo
                  {podium.champion.bingoCount === 1 ? '' : 's'} · {podium.champion.squaresMarked} squares
                </div>
              )}
              {podium.firstBingo && (
                <div className="moment-podium-row">
                  👑 First to BINGO: <b>{podium.firstBingo.displayName}</b>
                </div>
              )}
              {podium.dailyHonors.length > 0 && (
                <div className="moment-podium-row moment-podium-honors">
                  {podium.dailyHonors.map((h) => `D${h.dayIndex + 1} ${h.displayName}`).join(' · ')}
                </div>
              )}
            </div>
          )}
          <div className="sub">{ago(moment.createdAt)}</div>
        </div>
        <span className="moment-icon" aria-hidden="true">{copy.icon}</span>
      </div>
    </div>
  );
}

// The names line for a Tally Card (#216): the first two markers by name, then
// "+N" for the rest — "Nathan Payne, Sterling Tadlock +12". Markers arrive
// chronological (earliest first) from `deriveTallyCards`.
function tallyNames(markers: { displayName: string }[]): string {
  const shown = markers.slice(0, 2).map((m) => m.displayName);
  const extra = markers.length - shown.length;
  return extra > 0 ? `${shown.join(', ')} +${extra}` : shown.join(', ');
}

/**
 * Which per-viewer button a Tally Card shows (#216) — PURE so the gating is
 * unit-testable. Never a generic affordance:
 *   - `＋ Proof` when the viewer has MARKED that Prompt (they can add evidence).
 *   - `🙋 Got it too` when the Prompt sits UNMARKED on one of the viewer's own
 *     dealt (unlocked) cards — Boards are per-Player samples, so the button only
 *     appears when the Prompt is actually on the viewer's card.
 *   - otherwise `null`: the card is purely informational.
 * `＋ Proof` wins if both could apply (a marked Prompt is never also unmarked).
 */
export function tallyCardAction(
  itemId: string,
  markedItemIds: Set<string>,
  dealtUnmarkedItemIds: Set<string>,
): 'proof' | 'gotit' | null {
  if (markedItemIds.has(itemId)) return 'proof';
  if (dealtUnmarkedItemIds.has(itemId)) return 'gotit';
  return null;
}

// The viewer's own board split into marked vs dealt-unmarked itemId sets, for the
// per-card button gating (`tallyCardAction`). Single-board today (Boards deal
// `dayIndex: 0`); when multi-day Boards land this widens to the union across the
// viewer's unlocked Day Cards without changing the pure gate. Exported for the
// Feed→Board wiring that consumes it (see the spec's follow-up note).
export function boardItemSets(board: BoardDoc | null): { marked: Set<string>; unmarked: Set<string> } {
  const marked = new Set<string>();
  const unmarked = new Set<string>();
  for (const c of board?.cells ?? []) {
    if (c.free || !c.itemId) continue;
    (c.marked ? marked : unmarked).add(c.itemId);
  }
  return { marked, unmarked };
}

/**
 * Where a Tally Card's button should land on the viewer's own cards (#261):
 * the Day whose dealt Board carries this Prompt, and whether it is already
 * marked there. A marked hit anywhere wins over any unmarked one (`＋ Proof`
 * beats `🙋 Got it too` — `tallyCardAction`'s precedence, now with a
 * concrete target); within the same marked-ness, the card's OWN Day is
 * preferred (tap lands where the social heat is), then the latest Day.
 * `null` when the Prompt is on none of the viewer's dealt cards — the card
 * stays informational. Boards exist only for dealt (unlocked) Days, so
 * every candidate here is claimable by construction.
 */
export function tallyActionTarget(
  card: Pick<TallyCardData, 'itemId' | 'dayIndex'>,
  boards: ReadonlyMap<number, BoardDoc>,
): { dayIndex: number; itemId: string; marked: boolean } | null {
  let best: { dayIndex: number; itemId: string; marked: boolean } | null = null;
  const beats = (a: { dayIndex: number; marked: boolean }, b: { dayIndex: number; marked: boolean }): boolean => {
    if (a.marked !== b.marked) return a.marked;
    const aSame = a.dayIndex === card.dayIndex;
    const bSame = b.dayIndex === card.dayIndex;
    if (aSame !== bSame) return aSame;
    return a.dayIndex > b.dayIndex;
  };
  for (const [dayIndex, board] of boards) {
    for (const c of board.cells) {
      if (c.free || c.itemId !== card.itemId) continue;
      const candidate = { dayIndex, itemId: card.itemId, marked: !!c.marked };
      if (!best || beats(candidate, best)) best = candidate;
    }
  }
  return best;
}

/**
 * The viewer's OWN board `cellIndex` for a Prompt — the context a Doubt raised
 * from the Feed records. Returns the square's `index` (0..24) when the Prompt sits
 * on one of the viewer's dealt cards, else `-1`, meaning "raised from the Feed,
 * not a board square". A Doubt's `cellIndex` is context-only — satisfaction
 * derives on (target, Prompt), never this index (src/data/doubts.ts) — and the
 * rules require only `cellIndex is number` plus the TARGET's standing Mark, so a
 * Feed doubter who never dealt the Prompt still raises a valid Doubt. Exported for
 * the unit test. First match wins across Days; the same Prompt on two dealt cards
 * is a same-text sample, and either square is equally valid context.
 */
export function viewerCellIndexForItem(
  boards: ReadonlyMap<number, BoardDoc>,
  itemId: string,
): number {
  for (const [, board] of boards) {
    for (const c of board.cells) {
      if (!c.free && c.itemId === itemId) return c.index;
    }
  }
  return -1;
}

/**
 * A Tally Card (#216, daily-cards-spec § "Tally Cards") — the Feed's live, lighter-
 * weight rendering of bare Marks: first two names + "+N", an avatar stack of the
 * first three markers, the day chip, and a relative bump time. One line, an accent
 * left border, no media — deliberately less prominent than a `ProofCard`. Tapping
 * the card opens the same who-list sheet Doubts use (`onOpenWhoList`). The button is
 * per-viewer (`tallyCardAction`).
 */
export function TallyCard({
  card,
  action,
  days,
  onOpenWhoList,
  onAddProof,
  onGotItToo,
}: {
  card: TallyCardData;
  action: 'proof' | 'gotit' | null;
  days: DayDef[] | undefined;
  onOpenWhoList?: (card: TallyCardData) => void;
  onAddProof?: (itemId: string) => void;
  onGotItToo?: (itemId: string) => void;
}) {
  const stack = card.markers.slice(0, 3);
  return (
    <div
      className="tally-card"
      style={{ borderLeft: '3px solid var(--accent, #d6409f)', paddingLeft: 8 }}
    >
      <div className="row" style={{ border: 'none', background: 'none', padding: 0 }}>
        <button
          className="tally-card-body grow"
          onClick={() => onOpenWhoList?.(card)}
          // #366: `color: 'inherit'` completes this button's inline UA-reset
          // (background/border already opt out here): without it the marker
          // names fell back to the UA's near-black ButtonText, unreadable on
          // the dark themes. The global `button { color: inherit }` reset in
          // index.css is the platform-wide fix; the inline copy keeps the
          // component's own contract self-contained and jsdom-assertable.
          style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', color: 'inherit' }}
          title="See who marked this"
        >
          <span className="tally-avatars" style={{ display: 'inline-flex' }} aria-hidden="true">
            {stack.map((m) => (
              <Avatar key={m.uid} name={m.displayName} src={null} size={22} />
            ))}
          </span>
          <span className="name" style={{ fontSize: 14 }}>
            {tallyNames(card.markers)}{' '}
            <span className="muted" style={{ fontWeight: 400 }}>got “{card.itemText}”</span>
            {' '}
            {/* The wireframes' `.who` treatment: the Day reference is PLAIN dim
                text ("Day 3 · 1:12p"), never the Feed's bordered pill — an
                inline pill inside this wrapping name line paints its background
                band across adjacent line boxes and reads as a glitchy
                strikethrough when the card copy wraps. */}
            <span className="tally-day sub" style={{ fontWeight: 400 }}>
              {dayChipLabel(card.dayIndex, days)}
            </span>
            {' '}
            {/* The wireframes' sub-line: "bumped just now · tap for who" — the
                tap affordance is visible copy, not only a title attribute. */}
            <span className="sub" style={{ fontWeight: 400 }}>
              · bumped {ago(card.displayBump)} · tap for who
            </span>
          </span>
        </button>
        {action === 'proof' && (
          <button className="iconbtn" title="Add a proof" onClick={() => onAddProof?.(card.itemId)}>
            ＋ Proof
          </button>
        )}
        {action === 'gotit' && (
          <button className="iconbtn" title="Mark it — you’ve got this one too" onClick={() => onGotItToo?.(card.itemId)}>
            🙋 Got it too
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The Feed-level who-list sheet (#216 gap closure): tapping a Feed Tally Card —
 * or a leaderboard bump announcement — opens this: every marker who got the
 * Prompt, chronologically, reusing the same `.sheet-backdrop`/`.sheet` chrome as
 * Board's `TallySheet`.
 *
 * "Ask for proof" from the Feed (#392): each OTHER marker carries the same Doubt
 * affordance — "🤨 Pics or it didn't happen" — the Board-side who-list has, so a
 * Player can request proof from the Feed, not only from their own board square.
 * The read-side context the raise needs comes as PROPS from `ProofFeed` rather
 * than a new per-sheet subscription: `doubts` is the Feed's flat `useAllDoubts`
 * stream (filtered to this Prompt), `proofs` the Feed's visible proofs, and the
 * viewer identity + `viewerCellIndex` are resolved once at the Feed level. That
 * closes the gap the sheet was originally scoped out of — the earlier read-only
 * form carried only `markers[]` and no Board/Doubt context — without opening a
 * second listener while the sheet is up.
 *
 * The raise itself is `raiseDoubt` (src/data/doubts.ts), the SAME writer the
 * Board-side sheet uses — one deterministic once-only slot per (doubter, target,
 * Prompt), attribution gated behind `identityKnown` so a public, permanent
 * accusation never publishes under a still-loading name, a per-target in-flight
 * guard against a double-tap, and the target's standing Mark enforced by the
 * rules. A Doubt is social pressure, never a gate (ADR 0001). Unlike the
 * Board-side sheet there is no own-square `isSourceLive` revalidation: a Feed
 * doubter need not have dealt the Prompt at all (`viewerCellIndex` is -1 then),
 * and a target who has since unmarked is denied server-side and logged benignly.
 *
 * Keyboard-operable dialog (CodeRabbit finding, PR #251): `role="dialog"` +
 * `aria-modal` + `aria-labelledby` the "Who got" title, focus moved into
 * the sheet on open (the title itself, `tabIndex={-1}`, a stable first stop even
 * now that the rows carry Doubt buttons), Tab/Shift+Tab trapped inside via a
 * document `keydown` listener, and focus restored to whatever was focused
 * before open (captured once at mount — the sheet is a sibling of many
 * `TallyCard` triggers in the Feed, not a fixed one, so there's no single
 * `triggerRef` to hold like `ProfileEditor`/`BugReport` do) on close. Mirrors
 * `ProfileEditor.tsx`'s `Editor` focus-trap effect.
 */
function FeedWhoListSheet({
  card,
  onClose,
  meUid,
  meName,
  identityKnown,
  doubts,
  proofs,
  viewerCellIndex,
}: {
  card: TallyCardData;
  onClose: () => void;
  // The signed-in viewer. Undefined/null suppresses the Doubt affordance (the
  // Feed only mounts for a signed-in Player, so this is belt-and-braces).
  meUid: string | null | undefined;
  // The viewer's resolved public name, passed ONLY when `identityKnown` — the
  // same gate the Board-side sheet applies so a Doubt never stamps a stale or
  // Anonymous accuser (undefined falls back to the cached row name in raiseDoubt).
  meName: string | undefined;
  identityKnown: boolean;
  // ALL doubts for THIS Prompt (the Feed's flat `useAllDoubts` stream, filtered to
  // `card.itemId` by the caller): the per-row open/answered status, the once-only
  // "already doubted" gate, and the raise idempotence backstop read from these.
  doubts: readonly DoubtDoc[];
  // The Feed's visible proofs, for deriving whether a Doubt is answered
  // (`doubtStatusFor`). Same source as the Feed's "cleared N doubts" pill — a
  // proof older than the merge cap is off the Feed, so answered-status is
  // best-effort here, never a gate (ADR 0001).
  proofs: readonly ProofDoc[];
  // The doubter's own board cellIndex for the Prompt, or -1 (context-only —
  // `viewerCellIndexForItem`).
  viewerCellIndex: number;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  // Per-target in-flight guard (mirrors Board's `TallySheet`): held in a ref so a
  // rapid double-tap in ONE tick reads the mutation the first tap made; the bump
  // reducer re-renders so the disabled affordance shows immediately, and the guard
  // clears when the raise settles (either path).
  const inFlight = useRef<Set<string>>(new Set());
  const [, bumpInFlight] = useReducer((n: number) => n + 1, 0);

  // Only Doubts against a CURRENT marker count toward the header + the raise
  // idempotence backstop — a Doubt against a Player who has since unmarked is
  // dormant (mirrors the Board-side sheet's `open`/`openCount`).
  const markedUids = new Set(card.markers.map((m) => m.uid));
  const open = openDoubts(doubts, card.itemText, proofs).filter((d) => markedUids.has(d.targetUid));
  const openCount = open.length;

  const doDoubt = (m: TallyEntry) => {
    // A signed-in viewer only, never a self-doubt (the rules deny it too), never a
    // second in-flight raise against the same target.
    if (!meUid || m.uid === meUid) return;
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
      itemId: card.itemId,
      cellIndex: viewerCellIndex,
      currentlyOpen: open,
    }).then(clear, clear);
  };

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    titleRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      // Exclude DISABLED controls from the trap's focusable set (Codex P2 on
      // #392): a Doubt button disabled while the viewer's identity loads (or a
      // raise is in flight) is skipped by native Tab, so treating it as the
      // first/last stop would strand focus on Close and let Shift+Tab escape the
      // dialog. The row buttons are the only ever-disabled controls here.
      const focusable = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []),
      ].filter((el) => !el.hasAttribute('disabled'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feed-wholist-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-title" id="feed-wholist-title" ref={titleRef} tabIndex={-1}>
          Who got “{card.itemText}”
        </div>
        {/* The wireframes' subtitle (#263): the player count always, plus the
            open-doubt half now that the Feed sheet can raise Doubts too (#392). */}
        {card.markers.length > 0 && (
          <p className="doubt-summary">
            {card.markers.length} player{card.markers.length === 1 ? '' : 's'}
            {openCount > 0 && (
              <>
                {' '}· {openCount} open doubt{openCount === 1 ? '' : 's'} <span aria-hidden="true">👀</span> on this square
              </>
            )}
          </p>
        )}
        {card.markers.length === 0 ? (
          <p className="muted tally-empty">No one has marked this yet.</p>
        ) : (
          <div className="list">
            {card.markers.map((m) => {
              const status = doubtStatusFor(m.uid, doubts, card.itemText, proofs);
              const isMe = m.uid === meUid;
              // ANY Doubt of mine against this marker — open OR satisfied —
              // spends my once-only slot, so the affordance suppresses (the state
              // to its left already says what happened). Someone ELSE's Doubt
              // never blocks my raise: the slot is per (doubter, target, Prompt).
              const iAlreadyDoubted = doubts.some(
                (d) => d.targetUid === m.uid && d.fromUid === meUid,
              );
              const isPending = inFlight.current.has(m.uid);
              const rowHasState = status === 'open' || status === 'satisfied';
              return (
                <div className="row wholist-row" key={m.uid}>
                  <div className="avatar">{(m.displayName.trim()[0] ?? '?').toUpperCase()}</div>
                  <div className="grow">
                    <div className="name">{m.displayName}</div>
                  </div>
                  {/* Right-aligned state (#263, mirroring the Board-side rows):
                      open → "👀 Doubted · waiting…"; answered → "✓ Answered". */}
                  {status === 'open' && (
                    <span className="wholist-state doubt-open">👀 Doubted · waiting…</span>
                  )}
                  {status === 'satisfied' && (
                    <span className="wholist-state doubt-satisfied">✓ Answered</span>
                  )}
                  {isMe && <span className="pill you-pill">you</span>}
                  {/* The raise affordance suppresses only for the VIEWER's own
                      involvement — self rows and rows they already doubted — and
                      only for a signed-in viewer. */}
                  {!!meUid && !isMe && !iAlreadyDoubted && (
                    <button
                      className="btn doubt-btn"
                      title="pics or it didn't happen"
                      // !identityKnown: never let a public, permanent accusation
                      // publish while the accuser's saved name is still unknown —
                      // the gate opens when the player row loads.
                      disabled={isPending || !identityKnown}
                      onClick={() => doDoubt(m)}
                    >
                      {/* Compact label on a row already carrying a state so the
                          narrow sheet row never overflows; the full phrase stays
                          on stateless rows. */}
                      {isPending ? 'Doubting…' : rowHasState ? '🤨 Doubt too' : '🤨 Pics or it didn’t happen'}
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
 * The Feed (ADR 0002 / #216): Proofs, Moments, and Tally Cards merged newest-first
 * into one stream — the honor-system source of truth the group watches together. A
 * bare Mark now reaches the Feed as a live Tally Card (its position debounced), so
 * play is no longer invisible; Proofs and Moments keep their existing rendering.
 */
export default function ProofFeed() {
  const { entries, tallyCards, loading } = useFeed();
  const { user } = useAuth();
  const navigate = useNavigate();
  // The event's days[] resolves a dayIndex to its theme label for the Day chip
  // (#211/#216). Read-only; absent while loading or on a pre-days[] event, in
  // which case dayChipLabel falls back to a bare "Day N".
  const { data: event } = useEventDoc();
  // ONE flat Doubts subscription for the whole Feed (#262): the doubts
  // collection is event-flat, so a single unfiltered read powers every proof
  // card's "👀 cleared N doubts" pill. Ban semantics ride useAllDoubts.
  const { doubts } = useAllDoubts(user?.uid);
  // The viewer's own dealt Day Cards (#261): the per-card button gating —
  // ＋ Proof on a Prompt they marked, 🙋 Got it too on one sitting unmarked on
  // one of their unlocked cards, nothing otherwise — reads these Boards
  // through the pure `tallyActionTarget`.
  const myBoards = useMyDayBoards(user?.uid, event?.days?.length ?? 0);
  // The viewer's resolved public identity for a Doubt raised from the Feed sheet
  // (#392) — the SAME resolution Board runs for its own who-list sheet: the saved
  // player-row name through `resolveDisplayName`, KNOWN only once the row settles.
  // While it loads (or a cache-only "absent" settles without server confirmation)
  // the identity is unknown and `displayName` silently falls back to the auth name,
  // so the sheet gates the raise on `identityKnown` — a public, permanent
  // accusation must never publish a stale or Anonymous accuser (mirrors Board).
  const { data: mePlayer, loading: mePlayerLoading, hasServerData: mePlayerConfirmed } = useMyPlayer(user?.uid);
  const displayName = resolveDisplayName(mePlayer, user?.displayName);
  // Identity must be KNOWN and CURRENT to the signed-in account (Codex P1 on #398).
  // On an account switch with the sheet open, `useMyPlayer(newUid)` briefly retains
  // the PREVIOUS account's row — its subscription resets only in a post-render
  // effect — so `meUid` is already the new uid while `displayName` still resolves
  // the old account's saved name. Raising a Doubt in that window would stamp a
  // permanent public accusation with the wrong name. So gate on the loaded row
  // BELONGING to the current uid (the converter pins `uid = snap.id`); a genuinely
  // absent row (null + server-confirmed) is fine, since `resolveDisplayName` then
  // falls back to the CURRENT auth name. This is the Feed analogue of the
  // Board-side sheet's write-time source revalidation.
  const identityKnown =
    !mePlayerLoading &&
    user?.uid != null &&
    (mePlayer !== null ? mePlayer.uid === user.uid : mePlayerConfirmed);
  // The Feed-level who-list sheet target (#216 gap closure): which Tally Card's
  // markers to show, or null when the sheet is closed. Holding the whole card
  // (not just itemId/dayIndex) is enough to render the sheet directly from the
  // tally doc already in hand — no extra subscription, unlike Board's
  // `TallySheet` which re-subscribes via `useTally`.
  const [whoListCard, setWhoListCard] = useState<TallyCardData | null>(null);
  // Stable close callback (CodeRabbit on #398): `FeedWhoListSheet`'s focus-trap
  // effect keys off `onClose`, so a fresh inline closure every Feed re-render — and
  // the Feed re-renders constantly as its live stream updates — would re-run the
  // effect and yank focus back to the sheet title mid-interaction. `setWhoListCard`
  // is stable, so an empty-dep `useCallback` pins the identity and the effect runs
  // once per open/close.
  const closeWhoList = useCallback(() => setWhoListCard(null), []);
  // The Feed's visible proofs — the read-side context the who-list sheet's Doubt
  // affordance needs to derive answered-vs-open status. Computed here (before the
  // loading/empty early returns) so the sheet, itself built before those returns
  // (#333), always has it; also reused below for the "cleared N doubts" pill. Same
  // best-effort source as that pill — a proof older than the 60-entry merge cap is
  // off the Feed, so answered-status is best-effort, never a gate (ADR 0001).
  const feedProofs = entries.flatMap((entry) => (entry.feedKind === 'proof' ? [entry.proof] : []));

  // #333 (Codex P2 on #384): the open who-list sheet is built BEFORE the
  // empty-feed early return and rendered on both paths — when the opened
  // tally was the only Feed entry and its last marker unmarks, `entries`
  // goes empty and the early return would otherwise unmount the dialog
  // abruptly. The live-by-identity lookup finds nothing in an empty feed, so
  // the snapshot fallback carries the open sheet through that state.
  const whoListSheet = whoListCard
    ? (() => {
        // The state holds the TAP-TIME snapshot, but the markers must
        // re-derive from the live tally subscription while the sheet is
        // open — a marker can unmark or a new one arrive mid-view. Select
        // the live card by identity from the UNCAPPED tallyCards stream
        // (#385, Codex P2 on #384 round 2): the 60-entry mergeFeed cap can
        // evict the opened card from `entries` while its tally is still
        // live, and the sheet must keep re-deriving through that eviction.
        // Only a card gone from tallyCards too (every marker unmarked —
        // deriveTallyCards never emits a zero-count card) falls back to the
        // snapshot rather than flashing a misleading empty list.
        const live = tallyCards.find(
          (card) => card.itemId === whoListCard.itemId && card.dayIndex === whoListCard.dayIndex,
        );
        return (
          <FeedWhoListSheet
            card={live ?? whoListCard}
            onClose={closeWhoList}
            meUid={user?.uid ?? null}
            meName={identityKnown ? displayName : undefined}
            identityKnown={identityKnown}
            // The flat doubts stream, narrowed to THIS Prompt (the sheet reads
            // per-row status + the once-only gate off it).
            doubts={doubts.filter((d) => d.itemId === whoListCard.itemId)}
            proofs={feedProofs}
            viewerCellIndex={viewerCellIndexForItem(myBoards, whoListCard.itemId)}
          />
        );
      })()
    : null;

  if (loading) return <div className="center muted">Loading…</div>;
  if (!entries.length)
    return (
      <>
        <div className="center muted">Nothing in the feed yet. Somebody do something.</div>
        {whoListSheet}
      </>
    );

  // Both buttons land in the SAME place — Board's own sheet, which renders the
  // claim open (pledge row included) for an unmarked Square and the proof-add
  // open for a marked one — so the Feed never re-implements claim logic: it
  // records the intent (`requestOpenSquare`) and navigates to the Card tab,
  // where Board switches to the Day and opens the sheet through its own
  // attribution guards and win-Moment pipeline.
  const openOnBoard = (target: { dayIndex: number; itemId: string }) => {
    requestOpenSquare({ dayIndex: target.dayIndex, itemId: target.itemId });
    navigate('/');
  };

  // The UNCAPPED tally stream gives (a) itemId → itemText for the doubt
  // derivation and (b) the live count for the "tally N" pill (#262) — not the
  // merged `entries`, which useFeed caps at 60: a recent Proof whose Prompt's
  // Tally Card fell outside that cap must keep its pills (Codex P2). The count
  // is PER (text, Day) when the Proof carries its Day (round 2): the deal can
  // repeat a Prompt across Days once the exclusion pool exhausts, and a Day-2
  // proof must not wear a footer that includes a later Day's markers. A
  // day-less legacy proof keeps the text-wide sum.
  const itemTextById = new Map<string, string>();
  const tallyByText = new Map<string, number>();
  const tallyByTextDay = new Map<string, number>();
  for (const card of tallyCards) {
    itemTextById.set(card.itemId, card.itemText);
    tallyByText.set(card.itemText, (tallyByText.get(card.itemText) ?? 0) + card.count);
    const dayKey = `${card.itemText}\u0000${card.dayIndex}`;
    tallyByTextDay.set(dayKey, (tallyByTextDay.get(dayKey) ?? 0) + card.count);
  }

  return (
    <div className="list">
      {entries.map((entry) => {
        if (entry.feedKind === 'moment') {
          return (
            <MomentCard
              key={`moment-${entry.moment.id}`}
              moment={entry.moment}
              days={event?.days}
              bannedUids={event?.bannedUids ?? []}
            />
          );
        }
        if (entry.feedKind === 'tallyCard') {
          const card = entry.card;
          const target = tallyActionTarget(card, myBoards);
          return (
            <TallyCard
              key={`tally-${card.itemId}-${card.dayIndex}`}
              card={card}
              action={target ? (target.marked ? 'proof' : 'gotit') : null}
              days={event?.days}
              onOpenWhoList={setWhoListCard}
              onAddProof={() => target && openOnBoard(target)}
              onGotItToo={() => target && openOnBoard(target)}
            />
          );
        }
        return (
          <ProofCard
            key={`proof-${entry.proof.id}`}
            proof={entry.proof}
            viewerUid={user?.uid}
            days={event?.days}
            timezone={event?.timezone}
            isStandingsFrozen={() => standingsFrozen(event)}
            clearedDoubts={doubtsClearedByProof(entry.proof, doubts, itemTextById, feedProofs)}
            tallyCount={
              typeof entry.proof.dayIndex === 'number'
                ? (tallyByTextDay.get(`${entry.proof.itemText}\u0000${entry.proof.dayIndex}`) ?? 0)
                : (tallyByText.get(entry.proof.itemText) ?? 0)
            }
          />
        );
      })}
      {whoListSheet}
    </div>
  );
}
