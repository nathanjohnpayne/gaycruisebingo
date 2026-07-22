import { useState } from 'react';
import { useMyPlayer, useNotices } from '../../hooks/useData';
import { resolveDisplayName } from '../../data/api';
import { defaultViewedIndex } from '../DaySwitcher';
import {
  postNotice,
  setNoticePinned,
  deleteNotice,
  NOTICE_TITLE_MAX,
  NOTICE_BODY_MAX,
} from '../../data/notices';
import AsyncButton from './AsyncButton';
import type { DayDef, NoticeDoc } from '../../types';

/**
 * Admin → Messages (specs/admin-messages.md, #frame-admin-messages): the sixth hub
 * door. Compose a Notice — title + body + a "Pin to Feed + show Card banner" toggle
 * (default on) + one "Post to everyone" button — then a newest-first sent history
 * with quiet Unpin / Delete controls (the repair-line quiet-controls convention:
 * compact, sentence-case, no primary pill). A broadcast, never a chat: no player
 * picker, no threading, no read receipts.
 */

// The compose form: mirrors PromptPool's AdminAddItemForm — a local draft, a busy
// guard, and an inline failure (role=alert) that KEEPS the draft so a retry is one
// tap (#411, specs/admin-async-feedback.md). Clears only on a settled success.
function ComposeNotice({ adminUid, adminName, dayIndex }: { adminUid: string; adminName: string; dayIndex?: number }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const canPost = title.trim().length > 0 && body.trim().length > 0 && !busy;

  const submit = async () => {
    if (!canPost) return;
    setBusy(true);
    setFailed(false);
    try {
      await postNotice({ uid: adminUid, displayName: adminName, title, body, pinned, dayIndex });
      setTitle('');
      setBody('');
      setPinned(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-section">
      <h3>New message</h3>
      <input
        className="notice-input"
        value={title}
        maxLength={NOTICE_TITLE_MAX}
        placeholder="Title"
        aria-label="Notice title"
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        className="notice-input notice-textarea"
        value={body}
        maxLength={NOTICE_BODY_MAX}
        placeholder="What does everyone need to know?"
        aria-label="Notice body"
        rows={4}
        onChange={(e) => setBody(e.target.value)}
      />
      <label className="notice-pin-row">
        <span className="grow">
          Pin to Feed + show Card banner
          <span className="notice-pin-sub">Until you unpin or players dismiss the banner</span>
        </span>
        <input
          type="checkbox"
          checked={pinned}
          aria-label="Pin to Feed and show Card banner"
          onChange={(e) => setPinned(e.target.checked)}
        />
      </label>
      <div className="notice-post-row">
        <button className="btn primary" disabled={!canPost} onClick={() => void submit()}>
          Post to everyone
        </button>
        {failed && (
          <span className="pill pill-error" role="alert">
            Didn’t post — try again.
          </span>
        )}
      </div>
    </div>
  );
}

// One sent-history row: title + a "Day N · Name · 📌 pinned" attribution line, with
// the quiet Unpin (when pinned) / Delete controls trailing (AsyncButton — disables
// in flight, surfaces a failure pill instead of a silent rejection).
function SentNoticeRow({ notice, days }: { notice: NoticeDoc; days: DayDef[] }) {
  const hasDay = typeof notice.dayIndex === 'number' && days[notice.dayIndex] != null;
  const meta = [
    hasDay ? `Day ${(notice.dayIndex as number) + 1}` : null,
    notice.displayName,
    notice.pinned ? '📌 pinned' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="row">
      <div className="grow">
        {notice.title}
        <span className="sub">{meta}</span>
      </div>
      {notice.pinned ? (
        <AsyncButton className="btn" onAction={() => setNoticePinned(notice.id, false)}>
          Unpin
        </AsyncButton>
      ) : (
        <AsyncButton className="btn" onAction={() => setNoticePinned(notice.id, true)}>
          Pin
        </AsyncButton>
      )}
      <AsyncButton className="btn" onAction={() => deleteNotice(notice.id)}>
        Delete
      </AsyncButton>
    </div>
  );
}

export default function MessagesPanel({ adminUid, days }: { adminUid: string; days: DayDef[] }) {
  const { data: player } = useMyPlayer(adminUid);
  const { notices } = useNotices();
  // The posting admin's public identity, resolved the SAME validated way the Feed
  // Moment/Tally writers do (saved player-row name, else auth, else 'Anonymous').
  const adminName = resolveDisplayName(player, undefined);
  // The event's current Day, stamped onto the Notice at post time (Moment-style) so
  // the Feed reads "📌 Nathan · Day 8". Undefined for a schedule-less Event.
  const dayIndex = days.length ? defaultViewedIndex(days, Date.now()) : undefined;

  return (
    <div>
      <ComposeNotice adminUid={adminUid} adminName={adminName} dayIndex={dayIndex} />
      <div className="admin-section">
        <h3>
          Sent
          {notices.length > 0 && <span className="pill">{notices.length}</span>}
        </h3>
        {notices.length === 0 ? (
          <div className="center muted">No messages yet.</div>
        ) : (
          <div className="list">
            {notices.map((n) => (
              <SentNoticeRow key={n.id} notice={n} days={days} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
