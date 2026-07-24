import { collection, deleteDoc, doc, setDoc, updateDoc } from 'firebase/firestore';
import { db, EVENT_ID } from '../firebase';
import { markerDisplayName } from './attribution';
import type { NoticeDoc } from '../types';

// Notices (specs/admin-messages.md): an admin-authored broadcast — title + body,
// optionally pinned — posted to the shared Feed for everyone (ADR 0002). This
// module is the admin write half: create, pin/unpin, edit, delete. Unlike Moments
// and Doubts (create-once, immutable, deterministic id), a Notice is MUTABLE (the
// pin toggle and an in-place copy correction, #455) and DELETABLE, so it takes a
// Firestore auto-id, not a deterministic slot. firestore.rules gates every write on
// `isAdmin(eventId)` and validates the title/body caps + `pinned: bool` on create
// AND update; on update it additionally pins the diff to title/body/pinned/editedAt,
// so attribution (`uid`, `displayName`) and Feed ordering (`createdAt`) are immutable
// server-side.
//
// Raw (converter-free) refs for writes, matching moments.ts's rawMoment and
// doubts.ts's rawDoubts — the read side attaches `noticeConverter` via
// `noticesCol`/`noticeRef` (src/data/paths.ts).
const rawNotices = () => collection(db, 'events', EVENT_ID, 'notices');
const rawNotice = (id: string) => doc(db, 'events', EVENT_ID, 'notices', id);

// The rules' length caps (firestore.rules § notices). Kept here so the writer
// bounds copy to exactly what the rules accept rather than minting a write the
// server will reject.
export const NOTICE_TITLE_MAX = 60;
export const NOTICE_BODY_MAX = 400;

export interface PostNoticeArgs {
  // The posting admin's uid (auth) — the rules cross-check `isAdmin`, not this.
  uid: string;
  // The admin's resolved public identity (saved player-row name + auth), bounded
  // here to the ≤100 attribution contract via `markerDisplayName`, Moment-style.
  displayName?: string;
  title: string;
  body: string;
  pinned: boolean;
  // The event's current Day, stamped at post time so the Feed reads "📌 Nathan ·
  // Day 8" (the caller computes it from `event.days`, DaySwitcher-style). Optional
  // so a pre-schedule post still writes.
  dayIndex?: number;
}

/**
 * Post a Notice to the Feed. Trims and caps the title/body to the rules' contract,
 * stamps `createdAt` + the current-Day `dayIndex` (Moment-style), and writes with
 * a Firestore auto-id (returned so the caller can reference the fresh doc). The
 * write is awaited so the compose form can clear only on success and surface a
 * failure otherwise (the admin is online composing — this is not the offline
 * fire-and-forget mark path). Rejects on a rules denial or network error.
 */
export async function postNotice(args: PostNoticeArgs): Promise<string> {
  const ref = doc(rawNotices());
  const payload: Omit<NoticeDoc, 'id'> = {
    title: args.title.trim().slice(0, NOTICE_TITLE_MAX),
    body: args.body.trim().slice(0, NOTICE_BODY_MAX),
    uid: args.uid,
    displayName: markerDisplayName(args.displayName, undefined),
    createdAt: Date.now(),
    pinned: args.pinned,
    // Firestore rejects an explicit `undefined`, so spread the field only when
    // supplied (mirrors writeMomentOnce, src/data/moments.ts).
    ...(args.dayIndex !== undefined ? { dayIndex: args.dayIndex } : {}),
  };
  await setDoc(ref, payload);
  return ref.id;
}

/**
 * Pin or unpin a Notice. A pin-only `updateDoc` merges into the existing doc, so
 * `request.resource.data` still carries the valid title/body the create rule
 * enforced — the update rule's caps pass unchanged.
 */
export async function setNoticePinned(id: string, pinned: boolean): Promise<void> {
  await updateDoc(rawNotice(id), { pinned });
}

/**
 * Correct a sent Notice's copy in place (#455). Trims and caps title/body to the
 * same contract `postNotice` enforces, and stamps `editedAt` so the Feed card and
 * the admin history can show "edited" — a delivered broadcast may be corrected,
 * never silently rewritten.
 *
 * Only the copy moves: `uid`, `displayName`, `createdAt`, and `dayIndex` are never
 * written here, and the rules deny them outright, so an edit can neither re-attribute
 * a Notice nor re-sort it to the top of the Feed. Editing in place (rather than
 * Delete + repost) also keeps the Notice's Feed position and leaves every player's
 * Card-banner dismissal intact.
 *
 * Awaited so the inline editor closes only on success and surfaces a failure
 * otherwise. Rejects on a rules denial or network error.
 */
export async function editNotice(
  id: string,
  edits: { title: string; body: string },
): Promise<void> {
  await updateDoc(rawNotice(id), {
    title: edits.title.trim().slice(0, NOTICE_TITLE_MAX),
    body: edits.body.trim().slice(0, NOTICE_BODY_MAX),
    editedAt: Date.now(),
  });
}

/** Delete a Notice — removes it from the Feed, the banner, and the sent history. */
export async function deleteNotice(id: string): Promise<void> {
  await deleteDoc(rawNotice(id));
}
