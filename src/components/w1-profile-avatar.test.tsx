import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserDoc } from '../types';
import Avatar from './Avatar';
// Real implementations of the modules under test — covers specs/w1-profile-avatar.md.
import { updateAvatar, updateDisplayName } from '../data/profile';
import ProfileEditor from './ProfileEditor';

const { docMock, setDocMock, updateDocMock } = vi.hoisted(() => ({
  docMock: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
  setDocMock: vi.fn(async () => undefined),
  // Mirrors real Firestore: updateDoc rejects when the target document doesn't
  // exist — the exact failure data/profile.ts now avoids by writing via a merge
  // setDoc instead. Kept mocked (rather than removed) so a regression back to
  // updateDoc fails this suite loudly instead of silently.
  updateDocMock: vi.fn(async () => {
    throw Object.assign(new Error('No document to update'), { code: 'not-found' });
  }),
}));
vi.mock('firebase/firestore', () => ({ doc: docMock, setDoc: setDocMock, updateDoc: updateDocMock }));

const { refMock, uploadBytesMock } = vi.hoisted(() => ({
  refMock: vi.fn((_storage: unknown, path: string) => ({ path })),
  uploadBytesMock: vi.fn(async () => ({})),
}));
vi.mock('firebase/storage', () => ({
  ref: refMock,
  uploadBytes: uploadBytesMock,
  getDownloadURL: async (r: { path: string }) => `https://cdn.example/${r.path}`,
  deleteObject: vi.fn(),
}));

vi.mock('../firebase', () => ({ db: {}, storage: {}, EVENT_ID: 'test-event' }));

type AuthUser = { uid: string; displayName: string | null; photoURL: string | null } | null;
const authState = vi.hoisted(() => ({ current: { user: null as AuthUser, loading: false } }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => authState.current }));

const userDocState = vi.hoisted(() => ({ current: { data: null as UserDoc | null, loading: false } }));
vi.mock('../hooks/useData', () => ({ useMyUser: () => userDocState.current }));

function resetMocks() {
  docMock.mockClear();
  setDocMock.mockClear();
  updateDocMock.mockClear();
  refMock.mockClear();
  uploadBytesMock.mockClear();
}

describe('Avatar prefers a custom photo over src', () => {
  it('prefers customPhoto, falls back to src, then to an initial', () => {
    const google = 'https://google/x.jpg';
    const custom = 'https://cdn.example/custom.jpg';
    const { rerender } = render(<Avatar name="Alex" src={google} customPhoto={custom} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', custom);
    rerender(<Avatar name="Alex" src={google} customPhoto={null} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', google);
    rerender(<Avatar name="Alex" src={null} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
  });
});

describe('data/profile.ts — persists to users/{uid}, reusing storage.ts', () => {
  beforeEach(resetMocks);

  it('trims and persists the display name, no-ops on blank', async () => {
    await updateDisplayName('u1', '  New Name  ');
    expect(setDocMock).toHaveBeenCalledWith({ path: 'users/u1' }, { displayName: 'New Name' }, { merge: true });

    setDocMock.mockClear();
    await updateDisplayName('u1', '   ');
    expect(setDocMock).not.toHaveBeenCalled();
  });

  // Covers the fix for the Codex P2 finding on profile.ts:15 — updateDoc fails
  // when users/{uid} doesn't exist, which can happen because ensureUserProfile's
  // create (data/api.ts) has its failure swallowed on the auth side
  // (auth/AuthContext.tsx). The mocked updateDoc above rejects exactly like real
  // Firestore does for a missing document, so this test both proves the save
  // succeeds today and would fail loudly if a regression reintroduced updateDoc.
  it('creates users/{uid} via a merge write when the profile doc is missing (ensureUserProfile create failed)', async () => {
    await expect(updateDisplayName('u1', 'New Name')).resolves.toBeUndefined();
    expect(setDocMock).toHaveBeenCalledWith({ path: 'users/u1' }, { displayName: 'New Name' }, { merge: true });
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('reuses uploadAvatar (avatars/{uid}.jpg, image/jpeg) then flips customPhoto + photoURL', async () => {
    const url = await updateAvatar('u1', new Blob(['x'], { type: 'image/png' }));
    expect(refMock).toHaveBeenCalledWith({}, 'avatars/u1.jpg');
    expect(uploadBytesMock).toHaveBeenCalledWith({ path: 'avatars/u1.jpg' }, expect.any(Blob), { contentType: 'image/jpeg' });
    expect(setDocMock).toHaveBeenCalledWith({ path: 'users/u1' }, { photoURL: url, customPhoto: true }, { merge: true });
    expect(url).toBe('https://cdn.example/avatars/u1.jpg');
  });
});

describe('ProfileEditor', () => {
  const googlePhoto = 'https://google/photo.jpg';
  const customUrl = 'https://cdn.example/avatars/u1.jpg';

  beforeEach(() => {
    resetMocks();
    authState.current = { user: { uid: 'u1', displayName: 'Google Name', photoURL: googlePhoto }, loading: false };
    userDocState.current = { data: { displayName: 'Alex', photoURL: null, customPhoto: false, createdAt: 0 }, loading: false };
  });

  it('renders nothing while signed out', () => {
    authState.current = { user: null, loading: false };
    expect(render(<ProfileEditor />).container).toBeEmptyDOMElement();
  });

  it('opens pre-filled with the live display name and saves an edit to users/{uid}', async () => {
    const user = userEvent.setup();
    render(<ProfileEditor />);
    await user.click(screen.getByRole('button', { name: 'Edit profile' }));

    const nameInput = screen.getByLabelText('Display name');
    expect(nameInput).toHaveValue('Alex');
    await user.clear(nameInput);
    await user.type(nameInput, 'New Name');
    await user.click(screen.getByRole('button', { name: 'Save name' }));

    // saveName is async (awaits updateDisplayName before closing) — wait for it.
    await waitFor(() =>
      expect(setDocMock).toHaveBeenCalledWith({ path: 'users/u1' }, { displayName: 'New Name' }, { merge: true }),
    );
    await waitFor(() => expect(screen.queryByText('Edit profile')).not.toBeInTheDocument());
  });

  // Codex P2 finding on ProfileEditor.tsx:32 — the editor used to gate only on
  // auth loading, so it could open (and, on an immediate Save, persist) the
  // Google-name fallback while the live users/{uid} subscription was still in
  // flight, clobbering a saved custom displayName. Simulates that delay: auth
  // resolves first, the profile snapshot resolves later with a name that
  // differs from the Google name, and proves the saved name always wins.
  it('waits for the live profile snapshot before rendering, so a delayed load never clobbers a saved name', async () => {
    const user = userEvent.setup();
    authState.current = { user: { uid: 'u1', displayName: 'Google Name', photoURL: googlePhoto }, loading: false };
    userDocState.current = { data: null, loading: true }; // profile subscription still in flight
    const { rerender } = render(<ProfileEditor />);
    expect(screen.queryByRole('button', { name: 'Edit profile' })).not.toBeInTheDocument();

    // The live users/{uid} snapshot arrives with a saved name that differs
    // from the Google name.
    userDocState.current = {
      data: { displayName: 'Saved Custom Name', photoURL: null, customPhoto: false, createdAt: 0 },
      loading: false,
    };
    rerender(<ProfileEditor />);

    await user.click(screen.getByRole('button', { name: 'Edit profile' }));
    expect(screen.getByLabelText('Display name')).toHaveValue('Saved Custom Name');

    await user.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() =>
      expect(setDocMock).toHaveBeenCalledWith(
        { path: 'users/u1' },
        { displayName: 'Saved Custom Name' },
        { merge: true },
      ),
    );
    // Never persisted the stale Google-name fallback while the profile was loading.
    expect(setDocMock).not.toHaveBeenCalledWith(
      { path: 'users/u1' },
      { displayName: 'Google Name' },
      { merge: true },
    );
  });

  it('uploading a photo persists it, and the live update flips the previewed Avatar to it', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ProfileEditor />);
    await user.click(screen.getByRole('button', { name: 'Edit profile' }));
    const preview = within(screen.getByRole('button', { name: 'Change avatar' }));
    expect(preview.getByRole('img')).toHaveAttribute('src', googlePhoto);

    await user.upload(screen.getByLabelText('Upload avatar'), new File(['x'], 'me.png', { type: 'image/png' }));
    // onAvatarFile is async (awaits updateAvatar) — wait for it to settle.
    await waitFor(() =>
      expect(setDocMock).toHaveBeenCalledWith(
        { path: 'users/u1' },
        { photoURL: customUrl, customPhoto: true },
        { merge: true },
      ),
    );

    // Simulate the live users/{uid} subscription delivering the new doc.
    userDocState.current = { data: { displayName: 'Alex', photoURL: customUrl, customPhoto: true, createdAt: 0 }, loading: false };
    rerender(<ProfileEditor />);
    expect(preview.getByRole('img')).toHaveAttribute('src', customUrl);
  });
});
