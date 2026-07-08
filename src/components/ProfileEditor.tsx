import { useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useMyUser } from '../hooks/useData';
import { updateAvatar, updateDisplayName } from '../data/profile';
import Avatar from './Avatar';

const MAX_NAME = 40;

// Floating trigger, fixed above the tab bar (App.tsx/Nav.tsx are frozen).
const fabStyle = {
  position: 'fixed', right: 14, bottom: 'calc(78px + env(safe-area-inset-bottom))', zIndex: 25,
  background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '50%',
  width: 44, height: 44, display: 'grid', placeItems: 'center',
} as const;

/**
 * A signed-in User's display-name + avatar editor, reachable from anywhere
 * (identity is public everywhere it appears — ADR 0002). Writes go through
 * data/profile.ts, which reuses uploadAvatar/downscaleImage (data/storage.ts).
 */
export default function ProfileEditor() {
  const { user, loading } = useAuth();
  const { data: profile } = useMyUser(user?.uid);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (loading || !user) return null;

  const currentName = profile?.displayName ?? user.displayName ?? 'Anonymous';
  // customPhoto flags whether photoURL currently holds a custom upload (vs.
  // the Google photo) — prefer it only when that flag is set.
  const customSrc = profile?.customPhoto ? profile.photoURL : null;

  const openEditor = () => {
    setName(currentName);
    setError(null);
    setOpen(true);
  };

  // Shared busy/error wrapper for the two writes below.
  const run = async (fn: () => Promise<unknown>, failMsg: string, onOk?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onOk?.();
    } catch {
      setError(failMsg);
    } finally {
      setBusy(false);
    }
  };

  const saveName = () => {
    const trimmed = name.trim();
    if (trimmed) run(() => updateDisplayName(user.uid, trimmed), 'Could not save your name — try again.', () => setOpen(false));
  };

  const onAvatarFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) run(() => updateAvatar(user.uid, file), 'Upload failed — try again.');
  };

  return (
    <>
      <button type="button" className="iconbtn" style={fabStyle} title="Edit profile" aria-label="Edit profile" onClick={openEditor}>
        ✎
      </button>
      {open && (
        <div className="sheet-backdrop" onClick={() => setOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-title">Edit profile</div>
            <div className="proof-body">
              <button type="button" className="iconbtn" style={{ padding: 0 }} aria-label="Change avatar" disabled={busy} onClick={() => fileRef.current?.click()}>
                <Avatar name={currentName} src={user.photoURL ?? null} customPhoto={customSrc} size={72} />
              </button>
              <input ref={fileRef} type="file" accept="image/*" aria-label="Upload avatar" style={{ display: 'none' }} onChange={onAvatarFile} />
              <input className="input" maxLength={MAX_NAME} value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" aria-label="Display name" />
            </div>
            {error && <p className="muted" role="alert" style={{ fontSize: 12, textAlign: 'center' }}>{error}</p>}
            <div className="sheet-actions">
              <button type="button" className="btn" onClick={() => setOpen(false)}>Close</button>
              <button type="button" className="btn primary" disabled={busy || !name.trim()} onClick={saveName}>
                {busy ? 'Saving…' : 'Save name'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
