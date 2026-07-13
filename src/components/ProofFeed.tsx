import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFeed, useEventDoc, useMyDayBoards } from '../hooks/useData';
import { requestOpenSquare } from '../hooks/useOpenSquare';
import { useAuth } from '../auth/AuthContext';
import { reportProof, deleteProof } from '../data/proofs';
import { track } from '../analytics';
import Avatar from './Avatar';
import { safeMediaUrl } from './safeMediaUrl';
import { tutorialDayIndexSet } from '../game/logic';
import { THEMES } from '../theme/themes';
import type { BoardDoc, DayDef, MomentDoc, MomentKind, ProofDoc, TallyCard as TallyCardData } from '../types';

// The Feed Day chip label (#211): "Day 2 · Get Sporty" — a 1-based Day number
// plus the Day's theme label from EventDoc.days[dayIndex] → THEMES, degrading to
// a bare "Day N" when the Day or its theme can't be resolved.
function dayChipLabel(dayIndex: number, days: DayDef[] | undefined): string {
  const day = days?.[dayIndex];
  const theme = day ? THEMES.find((t) => t.id === day.theme) : undefined;
  return theme ? `Day ${dayIndex + 1} · ${theme.label}` : `Day ${dayIndex + 1}`;
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

/**
 * A Proof card — the existing Feed entry (report ⚑, owner-delete 🗑, a "flagged
 * for review" badge, and the captured media by type). The media URL is
 * scheme-guarded (`safeMediaUrl`) before it reaches an <img>/<audio> src (CodeQL
 * js/xss-through-dom #1): mediaURL is resolved from a Firestore doc, so a forged
 * non-media scheme (javascript:, …) is dropped rather than rendered.
 */
function ProofCard({ proof, viewerUid, days }: { proof: ProofDoc; viewerUid: string | undefined; days: DayDef[] | undefined }) {
  const media = safeMediaUrl(proof.mediaURL);
  return (
    <div className="proof">
      <div className="row" style={{ border: 'none', background: 'none', padding: 0 }}>
        <Avatar name={proof.displayName} src={proof.photoURL} size={30} />
        <div className="grow">
          <div className="name" style={{ fontSize: 14 }}>
            {proof.displayName}{' '}
            <span className="muted" style={{ fontWeight: 400 }}>marked “{proof.itemText}”</span>
            {/* 🖼️ badge for a library pick (#190): stamped from ProofDoc.source,
                next to nothing for a camera/audio/text Proof (source absent). */}
            {proof.source === 'library' && (
              <span className="proof-source-badge" title="From the photo library" aria-label="From the photo library">{' '}🖼️</span>
            )}
          </div>
          <div className="sub">
            {ago(proof.createdAt)}
            {/* Day chip (#211): "Day 2 · Get Sporty" from the Proof's dayIndex, so
                the Feed reads as a cruise diary. Absent on pre-dayIndex Proofs. */}
            {typeof proof.dayIndex === 'number' && (
              <span className="proof-day-chip">{dayChipLabel(proof.dayIndex, days)}</span>
            )}
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
              }).catch(console.error)
            }
          >
            🗑
          </button>
        )}
      </div>
      {proof.type === 'photo' && media && <img className="proof-media" src={media} alt="proof" loading="lazy" />}
      {proof.type === 'audio' && media && <audio className="proof-media" controls src={media} />}
      {proof.type === 'text' && proof.text && <blockquote className="proof-quote">“{proof.text}”</blockquote>}
      {proof.status === 'flagged' && <div className="badge" style={{ color: '#ff6b6b' }}>flagged for review</div>}
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
function MomentCard({ moment, days }: { moment: MomentDoc; days: DayDef[] | undefined }) {
  const copy = MOMENT_COPY[moment.kind] ?? { icon: '🎉', line: 'made a Moment!' };
  return (
    <div className={`moment moment-${moment.kind}`}>
      <div className="row" style={{ border: 'none', background: 'none', padding: 0 }}>
        <Avatar name={moment.displayName} src={moment.photoURL} size={30} />
        <div className="grow">
          <div className="name" style={{ fontSize: 14 }}>
            {moment.displayName}{' '}
            <span className="moment-line">{copy.line}</span>
            {moment.kind === 'blackout' && typeof moment.dayIndex === 'number' && (
              <>
                {' '}
                <span className="moment-day-chip proof-day-chip">{dayChipLabel(moment.dayIndex, days)}</span>
              </>
            )}
          </div>
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
          style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }}
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
            <span className="tally-day-chip proof-day-chip">{dayChipLabel(card.dayIndex, days)}</span>
            {' '}
            {/* The wireframes' sub-line: "bumped just now · tap for who" — the
                tap affordance is visible copy, not only a title attribute. */}
            <span className="sub" style={{ fontWeight: 400 }}>
              bumped {ago(card.displayBump)} · tap for who
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
 * The Feed-level who-list sheet (#216 gap closure): tapping a Feed Tally Card
 * opens this — every marker who got the Prompt, chronologically, reusing the
 * same `.sheet-backdrop`/`.sheet` chrome as Board's `TallySheet`. Unlike the
 * Board-side sheet, this is READ-ONLY — no Doubt affordance — because the
 * Feed's `TallyCardData` carries only `markers[]` (uid + displayName +
 * markedAt), not the viewer's own Board/Doubt context `TallySheet` needs to
 * raise one; that scope is deliberately left to the existing Board-side sheet
 * (spec: "the Feed who-list can be view-only to stay scoped").
 *
 * Keyboard-operable dialog (CodeRabbit finding, PR #251): `role="dialog"` +
 * `aria-modal` + `aria-labelledby` the "Who marked" title, focus moved into
 * the sheet on open (the title itself, `tabIndex={-1}`, since a read-only
 * sheet has no natural first control), Tab/Shift+Tab trapped inside via a
 * document `keydown` listener, and focus restored to whatever was focused
 * before open (captured once at mount — the sheet is a sibling of many
 * `TallyCard` triggers in the Feed, not a fixed one, so there's no single
 * `triggerRef` to hold like `ProfileEditor`/`BugReport` do) on close. Mirrors
 * `ProfileEditor.tsx`'s `Editor` focus-trap effect.
 */
function FeedWhoListSheet({ card, onClose }: { card: TallyCardData; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);

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
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (!focusable || focusable.length === 0) return;
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
          Who marked “{card.itemText}”
        </div>
        {card.markers.length === 0 ? (
          <p className="muted tally-empty">No one has marked this yet.</p>
        ) : (
          <div className="list">
            {card.markers.map((m) => (
              <div className="row" key={m.uid}>
                <div className="avatar">{(m.displayName.trim()[0] ?? '?').toUpperCase()}</div>
                <div className="grow">
                  <div className="name">{m.displayName}</div>
                </div>
              </div>
            ))}
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
  const { entries, loading } = useFeed();
  const { user } = useAuth();
  const navigate = useNavigate();
  // The event's days[] resolves a dayIndex to its theme label for the Day chip
  // (#211/#216). Read-only; absent while loading or on a pre-days[] event, in
  // which case dayChipLabel falls back to a bare "Day N".
  const { data: event } = useEventDoc();
  // The viewer's own dealt Day Cards (#261): the per-card button gating —
  // ＋ Proof on a Prompt they marked, 🙋 Got it too on one sitting unmarked on
  // one of their unlocked cards, nothing otherwise — reads these Boards
  // through the pure `tallyActionTarget`.
  const myBoards = useMyDayBoards(user?.uid, event?.days?.length ?? 0);
  // The Feed-level who-list sheet target (#216 gap closure): which Tally Card's
  // markers to show, or null when the sheet is closed. Holding the whole card
  // (not just itemId/dayIndex) is enough to render the sheet directly from the
  // tally doc already in hand — no extra subscription, unlike Board's
  // `TallySheet` which re-subscribes via `useTally`.
  const [whoListCard, setWhoListCard] = useState<TallyCardData | null>(null);

  if (loading) return <div className="center muted">Loading…</div>;
  if (!entries.length) return <div className="center muted">Nothing in the feed yet. Somebody do something.</div>;

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

  return (
    <div className="list">
      {entries.map((entry) => {
        if (entry.feedKind === 'moment') {
          return <MomentCard key={`moment-${entry.moment.id}`} moment={entry.moment} days={event?.days} />;
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
        return <ProofCard key={`proof-${entry.proof.id}`} proof={entry.proof} viewerUid={user?.uid} days={event?.days} />;
      })}
      {whoListCard && <FeedWhoListSheet card={whoListCard} onClose={() => setWhoListCard(null)} />}
    </div>
  );
}
