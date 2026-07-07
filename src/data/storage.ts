import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage, EVENT_ID } from '../firebase';

/** Downscale + re-encode an image in the browser so we upload ~100–300 KB, not 12 MP. */
export async function downscaleImage(file: Blob, max = 1280, quality = 0.82): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob((b) => res(b), 'image/jpeg', quality),
    );
    return blob ?? file;
  } catch {
    return file; // fall back to the original if the browser can't decode it
  }
}

export async function uploadProofMedia(
  uid: string,
  proofId: string,
  blob: Blob,
  kind: 'photo' | 'audio',
): Promise<{ path: string; url: string }> {
  const payload = kind === 'photo' ? await downscaleImage(blob) : blob;
  const ext = kind === 'photo' ? 'jpg' : 'webm';
  const contentType = kind === 'photo' ? 'image/jpeg' : 'audio/webm';
  const path = `proofs/${EVENT_ID}/${uid}/${proofId}.${ext}`;
  const r = ref(storage, path);
  await uploadBytes(r, payload, { contentType });
  const url = await getDownloadURL(r);
  return { path, url };
}

export async function uploadAvatar(uid: string, blob: Blob): Promise<string> {
  const small = await downscaleImage(blob, 400, 0.85);
  const r = ref(storage, `avatars/${uid}.jpg`);
  await uploadBytes(r, small, { contentType: 'image/jpeg' });
  return await getDownloadURL(r);
}

export async function deleteStoragePath(path: string): Promise<void> {
  try {
    await deleteObject(ref(storage, path));
  } catch {
    /* already gone */
  }
}
