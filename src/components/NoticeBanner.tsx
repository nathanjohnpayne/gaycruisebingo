import { useState } from 'react';
import { useNotices } from '../hooks/useData';
import type { NoticeDoc } from '../types';

/**
 * The Card-tab Notice banner (specs/admin-messages.md, #frame-feed-notice): while
 * an admin Notice is pinned, the Card tab shows it ONCE as a dismissible banner
 * (✕) above the Board. Dismissal is PER-DEVICE (localStorage, keyed by notice id)
 * and hides ONLY the banner — the Notice stays in the Feed for latecomers, so a
 * player who dismisses the heads-up can still scroll to it. Mirrors the CoachOverlay
 * / InstallPrompt persistence pattern: a `gcb.*`-namespaced key whose read/write
 * fall open on a storage error (private mode), never throwing.
 */

const dismissKey = (noticeId: string): string => `gcb.notice.${noticeId}.dismissedAt`;

// try/catch — storage-unavailable falls open (isDismissed → false, mark → no-op),
// the same fallback CoachOverlay.tsx and InstallPrompt.tsx use for their keys.
export function isNoticeBannerDismissed(noticeId: string): boolean {
  try {
    return localStorage.getItem(dismissKey(noticeId)) !== null;
  } catch {
    return false;
  }
}
function markNoticeDismissed(noticeId: string): void {
  try {
    localStorage.setItem(dismissKey(noticeId), String(Date.now()));
  } catch {
    /* nothing to persist */
  }
}

/**
 * The presentational + dismissal half, pure over its `notices` prop so it unit-tests
 * without a Firestore mock (the container below supplies the live subscription). Of
 * the PINNED Notices — `notices` arrives newest-first from `useNotices` — it shows
 * the newest one this device has not dismissed; dismissing it reveals the next
 * still-undismissed pinned Notice, if any. An unpinned or fully-dismissed set
 * renders nothing.
 */
export function NoticeBannerView({ notices }: { notices: NoticeDoc[] }) {
  const [dismissedThisMount, setDismissedThisMount] = useState<readonly string[]>([]);
  const active = notices.find(
    (n) => n.pinned && !dismissedThisMount.includes(n.id) && !isNoticeBannerDismissed(n.id),
  );
  if (!active) return null;

  const handleDismiss = () => {
    markNoticeDismissed(active.id);
    setDismissedThisMount((prev) => [...prev, active.id]);
  };

  return (
    <div className="notice-banner" role="status">
      <button
        type="button"
        className="notice-banner-dismiss"
        aria-label="Dismiss notice"
        onClick={handleDismiss}
      >
        ✕
      </button>
      <div className="notice-banner-title">{active.title}</div>
      <div className="notice-banner-body">{active.body}</div>
    </div>
  );
}

/** Live container: subscribes to the Event's Notices and renders the banner. */
export default function NoticeBanner() {
  const { notices } = useNotices();
  return <NoticeBannerView notices={notices} />;
}
