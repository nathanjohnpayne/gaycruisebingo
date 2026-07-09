import { setGlobalOptions } from 'firebase-functions/v2';
import { onObjectFinalized } from 'firebase-functions/v2/storage';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import vision from '@google-cloud/vision';
import sharp from 'sharp';
import { RESEND_API_KEY } from './params';
import { shouldNotify, notifyAdminsOfModeration, type ModeratedDoc } from './notify';

initializeApp();
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

const db = getFirestore();
const visionClient = new vision.ImageAnnotatorClient();

const LIKELIHOOD = ['UNKNOWN', 'VERY_UNLIKELY', 'UNLIKELY', 'POSSIBLE', 'LIKELY', 'VERY_LIKELY'];
const atLeast = (v: string | null | undefined, min: string) =>
  LIKELIHOOD.indexOf(v ?? 'UNKNOWN') >= LIKELIHOOD.indexOf(min);

/**
 * On proof image upload: make a thumbnail and run SafeSearch.
 * IMPORTANT: this app is intentionally racy, so we do NOT flag "adult"/"racy".
 * We only flag extreme signals (heavy violence / gore) for human review.
 * SafeSearch cannot detect minors — human reporting remains the primary control.
 */
export const moderateProof = onObjectFinalized({ memory: '512MiB' }, async (event) => {
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
});

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
