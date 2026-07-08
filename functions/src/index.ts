import { setGlobalOptions } from 'firebase-functions/v2';
import { onObjectFinalized } from 'firebase-functions/v2/storage';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import vision from '@google-cloud/vision';
import sharp from 'sharp';
import { completedLines, countMarked, isBlackout, type Cell } from './logic';

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
 * Authoritative, server-side stat recomputation whenever a board changes.
 * Defense-in-depth over the Phase 0 client-written stats. (Full anti-cheat would
 * also validate individual mark transitions; out of scope for this event.)
 * Once deployed, you can lock player-stat writes to admins-only in firestore.rules.
 */
export const recomputeStats = onDocumentWritten('events/{eventId}/boards/{uid}', async (event) => {
  const after = event.data?.after;
  if (!after || !after.exists) return;
  const cells = ((after.data() as { cells?: Cell[] }).cells ?? []) as Cell[];
  const bingoCount = completedLines(cells).length;
  const squares = countMarked(cells);
  const blackout = isBlackout(cells);

  const { eventId, uid } = event.params as { eventId: string; uid: string };
  const playerRef = db.doc(`events/${eventId}/players/${uid}`);
  const snap = await playerRef.get();
  const existingFirst = (snap.data()?.firstBingoAt as number | null) ?? null;
  // Clear the stamp when the recomputed board has no bingo, so removing the last
  // bingo stops the leaderboard from crediting a non-winner; keep it otherwise.
  const firstBingoAt = bingoCount > 0 ? (existingFirst ?? Date.now()) : null;

  await playerRef.set({ bingoCount, squaresMarked: squares, blackout, firstBingoAt }, { merge: true });
});

/** Escape user-supplied text before interpolating it into the HTML response. */
const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * Crawler-facing share page. Firebase Hosting rewrites /s/** here so link unfurls
 * get real OG meta (SPAs can't, since crawlers don't run JS). Humans are redirected
 * into the app. Set OG_RENDERER_URL to your Cloud Run service.
 */
export const share = onRequest({ cors: true }, (req, res) => {
  const og = process.env.OG_RENDERER_URL || '';
  const kind = String(req.query.kind || 'win');
  const name = String(req.query.name || '');
  const theme = String(req.query.theme || 'neon-playground');
  const rawTitle = kind === 'leaderboard' ? 'The Leaderboard' : name ? `${name} got BINGO` : 'I got BINGO';
  const title = escapeHtml(rawTitle);
  // With a renderer configured, use the dynamic OG image; otherwise fall back to
  // the absolute static default. Social crawlers require an absolute image URL —
  // a bare '/og.png' would resolve relative to the crawler, not this site.
  const img = og
    ? `${og}/og.png?kind=${encodeURIComponent(kind)}&title=${encodeURIComponent(rawTitle)}&theme=${encodeURIComponent(theme)}`
    : 'https://gaycruisebingo.com/og-default.png';
  res.set('Cache-Control', 'public, max-age=3600');
  res.status(200).send(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<title>${title} · Gay Cruise Bingo</title>` +
      `<meta property="og:title" content="${title}">` +
      `<meta property="og:description" content="Trieste to Barcelona. Mark it if you see it.">` +
      `<meta property="og:image" content="${img}">` +
      `<meta property="og:image:width" content="2400"><meta property="og:image:height" content="1260">` +
      `<meta name="twitter:card" content="summary_large_image">` +
      `<meta http-equiv="refresh" content="0; url=/"></head><body>Redirecting…</body></html>`,
  );
});
