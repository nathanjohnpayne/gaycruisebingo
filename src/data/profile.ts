import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { uploadAvatar } from './storage';

// Raw (converter-free) ref for writes — mirrors the private `rawUser` each
// writing data module keeps locally (see data/api.ts).
const rawUser = (uid: string) => doc(db, 'users', uid);

const MAX_DISPLAY_NAME = 40;

/** Persist a display-name edit to `users/{uid}` (self-write only). A blank/whitespace-only name is a no-op. */
export async function updateDisplayName(uid: string, displayName: string): Promise<void> {
  const trimmed = displayName.trim().slice(0, MAX_DISPLAY_NAME);
  if (!trimmed) return;
  await updateDoc(rawUser(uid), { displayName: trimmed });
}

/** Reuse `uploadAvatar` (storage.ts) — no new upload path — then flip `UserDoc.customPhoto` so Avatar prefers it. */
export async function updateAvatar(uid: string, blob: Blob): Promise<string> {
  const url = await uploadAvatar(uid, blob);
  await updateDoc(rawUser(uid), { photoURL: url, customPhoto: true });
  return url;
}
