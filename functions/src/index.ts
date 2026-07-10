import { setGlobalOptions } from 'firebase-functions/v2';
import { onObjectFinalized, type StorageEvent } from 'firebase-functions/v2/storage';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import vision from '@google-cloud/vision';
import sharp from 'sharp';
import { BUG_REPORT_APP_CHECK, RESEND_API_KEY } from './params';
import { shouldNotify, notifyAdminsOfModeration, type ModeratedDoc } from './notify';
import { visionModerationEnabled } from './visionGate';
import { applyThresholdHide, applyThresholdBackfill, type ReportableDoc } from './autohide';
import { handleSubmitBugReport } from './bugReports';

initializeApp();
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

const db = getFirestore();
const visionClient = new vision.ImageAnnotatorClient();

/** Private, authenticated bug intake; App Check enforcement follows #44's toggle. */
export const submitBugReport = onCall(
  { maxInstances: 10, timeoutSeconds: 30 },
  (request) => handleSubmitBugReport(request, BUG_REPORT_APP_CHECK.value()),
);

// Cloud Vision (moderateProof) stays deferred by default (#126): the gate keeps
// the export OFF until Vision is deliberately enabled (Cloud Vision API on +
// ENABLE_VISION_MODERATION=true), so a proof scanner isn't stood up before it's
// wanted. moderateProof is a Storage trigger on the default (us-east1) bucket,
// so the export below is pinned to `region: 'us-east1'`: a us-central1 function
// (the global default) on a us-east1 bucket is an invalid pairing that fails
// deploy-plan validation and would block the whole functions deploy, so the
// trigger region MUST match the bucket for the enabled path to deploy. The gate
// is `functions/.env.<projectId>` (ENABLE_VISION_MODERATION=true), honored at
// BOTH deploy trigger-discovery and runtime; see visionGate.ts for why a raw
// process.env / param read alone is NOT visible at discovery.
const VISION_ENABLED = visionModerationEnabled();

const LIKELIHOOD = ['UNKNOWN', 'VERY_UNLIKELY', 'UNLIKELY', 'POSSIBLE', 'LIKELY', 'VERY_LIKELY'];
const atLeast = (v: string | null | undefined, min: string) =>
  LIKELIHOOD.indexOf(v ?? 'UNKNOWN') >= LIKELIHOOD.indexOf(min);

/**
 * On proof image upload: make a thumbnail and run SafeSearch.
 * IMPORTANT: this app is intentionally racy, so we do NOT flag "adult"/"racy".
 * We only flag extreme signals (heavy violence / gore) for human review.
 * SafeSearch cannot detect minors — human reporting remains the primary control.
 */
async function moderateProofHandler(event: StorageEvent): Promise<void> {
  const path = event.data.name;
  if (!path || !path.startsWith('proofs/') || !path.endsWith('.jpg')) return;
  if (path.endsWith('_thumb.jpg')) return;

  const parts = path.split('/'); // proofs/{eventId}/{uid}/{proofId}.jpg
  const eventId = parts[1];
  const proofId = parts[3].replace(/\.[^.]+$/, '');
  const bucket = getStorage().bucket(event.data.bucket);
  const [buf] = await bucket.file(path).download();

  try {
    const thumb = await sharp(buf).resize(400, 400, { fit: 'inside' }).jpeg({ quality: 78 }).toBuffer();
    await bucket.file(path.replace(/\.jpg$/, '_thumb.jpg')).save(thumb, { contentType: 'image/jpeg' });
  } catch {
    /* thumbnail is best-effort */
  }

  try {
    const [res] = await visionClient.safeSearchDetection({ image: { content: buf } });
    const s = res.safeSearchAnnotation;
    const flag = atLeast(s?.violence as string, 'LIKELY')
      ? 'violence'
      : atLeast(s?.adult as string, 'VERY_LIKELY') && atLeast(s?.violence as string, 'POSSIBLE')
        ? 'extreme'
        : null;
    if (flag) {
      await db.doc(`events/${eventId}/proofs/${proofId}`).set({ status: 'flagged', visionFlag: flag }, { merge: true });
    }
  } catch {
    /* Vision optional; reporting still covers moderation */
  }
}

// Gated per #126: only assign a CloudFunction when VISION_ENABLED. Firebase's
// export discovery (firebase-functions/lib/runtime/loader.js extractStack)
// walks Object.entries(module) and registers an export only when
// `typeof val === 'function' && val.__endpoint` — an `undefined` export fails
// that check and is silently skipped, so it is never validated or deployed.
// `region: 'us-east1'` pins the trigger to the default Storage bucket's region
// (the global default stays us-central1 for the Firestore-triggered notifiers)
// so the deploy-plan region check passes when the gate is on.
export const moderateProof = VISION_ENABLED
  ? onObjectFinalized({ memory: '512MiB', region: 'us-east1' }, moderateProofHandler)
  : undefined;

/**
 * Email Event admins when a Proof/Prompt transitions INTO a moderation state
 * (issue #101). Decoupled from the writes that own the transition; reads
 * `status` only. Best-effort — a mail failure is swallowed so the moderation
 * write is never blocked (ADR 0001). Bound to the RESEND_API_KEY secret.
 *
 * Uses onDocumentWritten (not onDocumentUpdated) so a proof CREATED already
 * flagged — moderateProof's merge-set can create the doc in the
 * upload-before-doc race (#101 Codex F2) — still notifies; `shouldNotify`
 * ignores create-into-active and deletes (`after` undefined). `transitionId`
 * is the CloudEvent id, threaded into the idempotency key (#101 Codex F3).
 */
async function handleModeration(
  collection: 'proofs' | 'items',
  eventId: string,
  docId: string,
  transitionId: string,
  before: ModeratedDoc | undefined,
  after: ModeratedDoc | undefined,
): Promise<void> {
  try {
    if (!after || !shouldNotify(before, after)) return;
    await notifyAdminsOfModeration(eventId, collection, docId, after, transitionId);
  } catch (err) {
    console.error('notifyOnModeration failed', err);
  }
}

export const notifyProofModeration = onDocumentWritten(
  { document: 'events/{eventId}/proofs/{proofId}', secrets: [RESEND_API_KEY] },
  (event) =>
    handleModeration(
      'proofs',
      event.params.eventId,
      event.params.proofId,
      event.id,
      event.data?.before.data(),
      event.data?.after.data(),
    ),
);

export const notifyItemModeration = onDocumentWritten(
  { document: 'events/{eventId}/items/{itemId}', secrets: [RESEND_API_KEY] },
  (event) =>
    handleModeration(
      'items',
      event.params.eventId,
      event.params.itemId,
      event.id,
      event.data?.before.data(),
      event.data?.after.data(),
    ),
);

/**
 * Server-authoritative reactive auto-hide (issue #43, ADR 0004 Phase 1). When a
 * Proof/Prompt's `reportCount` crosses its Event's `settings.reportHideThreshold`,
 * flip `status → 'hidden'` via the admin SDK (which bypasses security rules),
 * promoting the Phase-0 presentational hide (`isReportHidden`) to authoritative
 * removal. The decision (crossing predicate + fail-safe + loop guard) and its
 * best-effort wrapping live in `applyThresholdHide` (./autohide) so they are
 * unit-testable without a Functions runtime; these are the thin trigger seams.
 *
 * Both triggers share the `onDocumentWritten` path with the #101 notifiers: a
 * report bump that crosses the threshold fires THIS function, whose `hidden`
 * write then re-fires both — this one no-ops (loop-guarded), while
 * `notifyItemModeration`/`notifyProofModeration` REACTS to the `status → hidden`
 * transition and emails the admins. moderateProof and the notifiers are
 * untouched; no secrets are needed here. Firestore triggers stay on us-central1.
 */
export const hideProofAtThreshold = onDocumentWritten(
  'events/{eventId}/proofs/{proofId}',
  (event) =>
    applyThresholdHide(
      'proofs',
      event.params.eventId,
      event.params.proofId,
      event.data?.before.data() as ReportableDoc | undefined,
      event.data?.after.data() as ReportableDoc | undefined,
    ),
);

export const hideItemAtThreshold = onDocumentWritten(
  'events/{eventId}/items/{itemId}',
  (event) =>
    applyThresholdHide(
      'items',
      event.params.eventId,
      event.params.itemId,
      event.data?.before.data() as ReportableDoc | undefined,
      event.data?.after.data() as ReportableDoc | undefined,
    ),
);

/**
 * Threshold-decrease backfill (issue #43 F3, ADR 0004 Phase 1). The per-write
 * hides above fire only on a fresh crossing, so LOWERING an Event's
 * settings.reportHideThreshold below already-existing reportCounts would never
 * server-hide those already-over-threshold docs. This Event-doc trigger closes
 * that authoritative-hide gap: when reportHideThreshold decreases (or is enabled
 * from unset), applyThresholdBackfill sweeps the Event's own active items +
 * proofs and hides the ones that now meet the lower bar (active-only, update-based
 * writes; best-effort). It never writes the Event doc, so it never re-fires
 * itself; its status->hidden writes re-fire the per-write hides, which no-op.
 */
export const backfillHideOnThresholdDecrease = onDocumentWritten(
  'events/{eventId}',
  (event) =>
    applyThresholdBackfill(
      event.params.eventId,
      event.data?.before.data()?.settings?.reportHideThreshold,
      event.data?.after.data()?.settings?.reportHideThreshold,
    ),
);
