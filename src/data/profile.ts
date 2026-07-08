import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { uploadAvatar } from './storage';

// Raw (converter-free) ref for writes — mirrors the private `rawUser` each
// writing data module keeps locally (see data/api.ts).
const rawUser = (uid: string) => doc(db, 'users', uid);

const MAX_DISPLAY_NAME = 40;

/**
 * Persist a display-name edit to `users/{uid}` (self-write only). A blank/whitespace-only name is a no-op.
 *
 * Uses a merge `setDoc` rather than `updateDoc`: the doc-create half of `ensureUserProfile`
 * (data/api.ts) runs on sign-in but its failure is swallowed (auth/AuthContext.tsx), so
 * `users/{uid}` may not exist yet when a User saves here. `updateDoc` throws on a missing
 * document; a merge `setDoc` creates it, so a save can't be permanently blocked by an earlier
 * silent create failure.
 */
export async function updateDisplayName(uid: string, displayName: string): Promise<void> {
  const trimmed = displayName.trim().slice(0, MAX_DISPLAY_NAME);
  if (!trimmed) return;
  await setDoc(rawUser(uid), { displayName: trimmed }, { merge: true });
}

/**
 * Reuse `uploadAvatar` (storage.ts) — no new upload path — then flip `UserDoc.customPhoto` so Avatar prefers it.
 * Merge `setDoc` for the same missing-doc recovery reason as `updateDisplayName` above.
 */
export async function updateAvatar(uid: string, blob: Blob): Promise<string> {
  const url = await uploadAvatar(uid, blob);
  await setDoc(rawUser(uid), { photoURL: url, customPhoto: true }, { merge: true });
  return url;
}
