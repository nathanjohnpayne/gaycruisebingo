import { useFeed, useEventDoc } from '../hooks/useData';
import { useAuth } from '../auth/AuthContext';
import { reportProof, deleteProof } from '../data/proofs';
import { track } from '../analytics';
import Avatar from './Avatar';
import { safeMediaUrl } from './safeMediaUrl';
import { THEMES } from '../theme/themes';
import type { DayDef, MomentDoc, MomentKind, ProofDoc } from '../types';

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
              <span className="day-chip">{dayChipLabel(proof.dayIndex, days)}</span>
            )}
          </div>
        </div>
        <button className="iconbtn" title="Report" onClick={() => { reportProof(proof.id).catch(console.error); track('report_item'); }}>
          ⚑
        </button>
        {viewerUid === proof.uid && (
          <button className="iconbtn" title="Delete" onClick={() => deleteProof(proof.id, proof.storagePath).catch(console.error)}>
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
 */
function MomentCard({ moment }: { moment: MomentDoc }) {
  const copy = MOMENT_COPY[moment.kind] ?? { icon: '🎉', line: 'made a Moment!' };
  return (
    <div className={`moment moment-${moment.kind}`}>
      <div className="row" style={{ border: 'none', background: 'none', padding: 0 }}>
        <Avatar name={moment.displayName} src={moment.photoURL} size={30} />
        <div className="grow">
          <div className="name" style={{ fontSize: 14 }}>
            {moment.displayName}{' '}
            <span className="moment-line">{copy.line}</span>
          </div>
          <div className="sub">{ago(moment.createdAt)}</div>
        </div>
        <span className="moment-icon" aria-hidden="true">{copy.icon}</span>
      </div>
    </div>
  );
}

/**
 * The Feed (ADR 0002): Proofs and Moments merged newest-first into one stream —
 * the honor-system source of truth the group watches together. A bare Mark posts
 * nothing here; only a Proof or a Moment appears.
 */
export default function ProofFeed() {
  const { entries, loading } = useFeed();
  const { user } = useAuth();
  // The event's days[] resolves a Proof's dayIndex to its theme label for the
  // Day chip (#211). Read-only; absent while loading or on a pre-days[] event,
  // in which case dayChipLabel falls back to a bare "Day N".
  const { data: event } = useEventDoc();

  if (loading) return <div className="center muted">Loading…</div>;
  if (!entries.length) return <div className="center muted">Nothing in the feed yet. Somebody do something.</div>;

  return (
    <div className="list">
      {entries.map((entry) =>
        entry.feedKind === 'moment' ? (
          <MomentCard key={`moment-${entry.moment.id}`} moment={entry.moment} />
        ) : (
          <ProofCard key={`proof-${entry.proof.id}`} proof={entry.proof} viewerUid={user?.uid} days={event?.days} />
        ),
      )}
    </div>
  );
}
