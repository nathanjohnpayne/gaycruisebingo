import { setGlobalOptions } from 'firebase-functions/v2';
import { onObjectFinalized } from 'firebase-functions/v2/storage';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import vision from '@google-cloud/vision';
import sharp from 'sharp';

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
