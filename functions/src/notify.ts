/**
 * Admin moderation notifications (issue #101). A decoupled reader over the
 * `status` transitions that `moderateProof` (Vision), the threshold auto-hide
 * (#43), and manual admin hides already write: when a Proof/Prompt moves INTO a
 * moderation state it emails the Event admins. Reads `status` only — recomputes
 * no stats, gates no play (ADR 0001); a mail failure never blocks the write.
 *
 * The Firestore/Auth/params/`sendEmail` dependencies are lazy-loaded defaults
 * that tests replace via `deps`, so the whole flow is unit-testable without a
 * Functions runtime.
 */
import { sendEmail } from './email';

/** The subset of a Proof/Prompt doc the notifier reads. */
export interface ModeratedDoc {
  status?: string;
  visionFlag?: string | null;
  reportCount?: number;
}

const MODERATION_STATES = ['flagged', 'hidden'];

/**
 * Pure predicate: notify only when `status` CHANGED into a moderation state.
 * Serves an onDocumentWritten source, so it covers create and delete: a create
 * (`before` undefined) INTO flagged/hidden notifies — moderateProof's merge-set
 * can create a proof doc already flagged in the upload-before-doc race (#101
 * Codex F2) — while a create INTO active, and any delete (`after` undefined),
 * do not.
 */
export function shouldNotify(before: ModeratedDoc | undefined, after: ModeratedDoc | undefined): boolean {
  const next = after?.status;
  return !!next && before?.status !== next && MODERATION_STATES.includes(next);
}

/** Escape user-supplied text before interpolating it into the HTML body. */
const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export interface ResolveDeps {
  /** Read `events/{eventId}.admins` (UID array). */
  getAdminUids?: (eventId: string) => Promise<string[]>;
  /** Resolve a UID to its verified email, or null if none. */
  getEmailForUid?: (uid: string) => Promise<string | null>;
  /** Comma-separated override roster; defaults to the ADMIN_NOTIFY_EMAIL param. */
  adminNotifyEmail?: string;
}

async function defaultGetAdminUids(eventId: string): Promise<string[]> {
  const { getFirestore } = await import('firebase-admin/firestore');
  const admins = (await getFirestore().doc(`events/${eventId}`).get()).data()?.admins;
  return Array.isArray(admins) ? admins.filter((u): u is string => typeof u === 'string') : [];
}

async function defaultGetEmailForUid(uid: string): Promise<string | null> {
  try {
    const { getAuth } = await import('firebase-admin/auth');
    const user = await getAuth().getUser(uid);
    return user.email && user.emailVerified ? user.email : null;
  } catch {
    return null; // a missing/broken UID must not sink the whole send
  }
}

async function defaultGetReportHideThreshold(eventId: string): Promise<number | null> {
  try {
    const { getFirestore } = await import('firebase-admin/firestore');
    const threshold = (await getFirestore().doc(`events/${eventId}`).get()).data()?.settings?.reportHideThreshold;
    return typeof threshold === 'number' ? threshold : null;
  } catch {
    return null; // unknown threshold → we simply do not claim a threshold cause
  }
}

/**
 * Resolve an Event's admin roster to a de-duped list of verified emails,
 * unioned with any ADMIN_NOTIFY_EMAIL override. Returns `[]` (never throws).
 */
export async function resolveAdminEmails(eventId: string, deps: ResolveDeps = {}): Promise<string[]> {
  const getAdminUids = deps.getAdminUids ?? defaultGetAdminUids;
  const getEmailForUid = deps.getEmailForUid ?? defaultGetEmailForUid;
  let extra = deps.adminNotifyEmail;
  if (extra === undefined) extra = (await import('./params')).ADMIN_NOTIFY_EMAIL.value();

  const emails = new Set<string>();
  try {
    for (const uid of await getAdminUids(eventId)) {
      const email = await getEmailForUid(uid);
      if (email) emails.add(email);
    }
  } catch (err) {
    console.error('resolveAdminEmails: roster lookup failed', err);
  }
  for (const entry of (extra ?? '').split(',')) {
    if (entry.trim()) emails.add(entry.trim());
  }
  return [...emails];
}

/**
 * Derive the moderation cause from the ACTUAL doc state — never fabricate one
 * (#101 Codex R2 F1). A Vision flag names itself. A hide is a threshold hide
 * ONLY when reportCount and the event threshold are both known and the count is
 * at/over it; when both are known and the count is UNDER, the hide is an admin
 * action; when either is unknown, make no causal claim (neutral). Previously
 * every Vision-less hide was mislabelled "reports >= threshold", which lied
 * about a manual hide of an unreported prompt.
 */
function deriveReason(after: ModeratedDoc, reportHideThreshold: number | null): string {
  if (after.visionFlag) return after.visionFlag;
  if (after.status !== 'hidden') return '';
  if (typeof after.reportCount === 'number' && typeof reportHideThreshold === 'number') {
    return after.reportCount >= reportHideThreshold ? 'reports >= threshold' : 'by an admin';
  }
  return ''; // threshold or count unknown — no fabricated cause
}

function buildMessage(
  eventId: string,
  collection: string,
  docId: string,
  after: ModeratedDoc,
  appBaseUrl: string,
  reportHideThreshold: number | null,
) {
  const entity = collection === 'proofs' ? 'Proof' : 'Prompt';
  const status = after.status ?? 'unknown';
  const reason = deriveReason(after, reportHideThreshold);
  const subject = `[GCB moderation] ${entity} ${status}${reason ? ` (${reason})` : ''}`;
  const adminLink = `${appBaseUrl}/admin`;

  const rows: Array<[string, string]> = [
    ['Event', eventId],
    ['Item', `${collection}/${docId}`],
    ['New status', status],
  ];
  if (after.visionFlag) rows.push(['Vision flag', after.visionFlag]);
  if (typeof after.reportCount === 'number') rows.push(['Report count', String(after.reportCount)]);

  const text = `${entity} moderation update.\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nReview in the Admin console: ${adminLink}\n`;
  const html =
    `<p>${escapeHtml(entity)} moderation update.</p><table>` +
    rows.map(([k, v]) => `<tr><td><strong>${escapeHtml(k)}</strong></td><td>${escapeHtml(v)}</td></tr>`).join('') +
    `</table><p><a href="${escapeHtml(adminLink)}">Review in the Admin console</a></p>`;
  return { subject, html, text };
}

export interface NotifyDeps extends ResolveDeps {
  /** Override the send transport (defaults to `sendEmail`). */
  send?: typeof sendEmail;
  /** Override the Admin-console base URL (defaults to the APP_BASE_URL param). */
  appBaseUrl?: string;
  /** Resolve the Event's `settings.reportHideThreshold`; defaults to a doc read. */
  getReportHideThreshold?: (eventId: string) => Promise<number | null>;
}

/**
 * Compose and send ONE email to all resolved admins for a moderation
 * transition. Sends nothing (returns `false`) when the roster is empty.
 *
 * `transitionId` is the Eventarc/CloudEvent id of the triggering write. It is
 * stable across platform retries of the SAME delivery but unique per distinct
 * write, so folding it into the idempotency key makes a retry of one transition
 * dedupe while two DISTINCT transitions into the same status (e.g. a re-hide
 * after a restore, within Resend's 24h window) each deliver (#101 Codex F3).
 */
export async function notifyAdminsOfModeration(
  eventId: string,
  collection: string,
  docId: string,
  after: ModeratedDoc,
  transitionId: string,
  deps: NotifyDeps = {},
): Promise<boolean> {
  const to = await resolveAdminEmails(eventId, deps);
  if (to.length === 0) {
    console.log(`notifyAdminsOfModeration: no admin emails for event ${eventId}; skipping`);
    return false;
  }
  const appBaseUrl = deps.appBaseUrl ?? (await import('./params')).APP_BASE_URL.value();
  // Only a Vision-less hide needs the threshold, to tell a threshold hide from a
  // manual one (#101 Codex R2 F1); skip the read otherwise.
  const reportHideThreshold =
    after.status === 'hidden' && !after.visionFlag
      ? await (deps.getReportHideThreshold ?? defaultGetReportHideThreshold)(eventId)
      : null;
  const { subject, html, text } = buildMessage(eventId, collection, docId, after, appBaseUrl, reportHideThreshold);
  return (deps.send ?? sendEmail)({
    to,
    subject,
    html,
    text,
    idempotencyKey: `moderation-notify/${eventId}/${collection}/${docId}/${after.status}/${transitionId}`,
  });
}
