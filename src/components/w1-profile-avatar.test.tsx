import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserDoc } from '../types';
import Avatar from './Avatar';
// Real implementations of the modules under test — covers specs/w1-profile-avatar.md.
import { updateAvatar, updateDisplayName } from '../data/profile';
import ProfileEditor from './ProfileEditor';

const { docMock, updateDocMock } = vi.hoisted(() => ({
  docMock: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
  updateDocMock: vi.fn(async () => undefined),
}));
vi.mock('firebase/firestore', () => ({ doc: docMock, updateDoc: updateDocMock }));

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
    expect(updateDocMock).toHaveBeenCalledWith({ path: 'users/u1' }, { displayName: 'New Name' });

    updateDocMock.mockClear();
    await updateDisplayName('u1', '   ');
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('reuses uploadAvatar (avatars/{uid}.jpg, image/jpeg) then flips customPhoto + photoURL', async () => {
    const url = await updateAvatar('u1', new Blob(['x'], { type: 'image/png' }));
    expect(refMock).toHaveBeenCalledWith({}, 'avatars/u1.jpg');
    expect(uploadBytesMock).toHaveBeenCalledWith({ path: 'avatars/u1.jpg' }, expect.any(Blob), { contentType: 'image/jpeg' });
    expect(updateDocMock).toHaveBeenCalledWith({ path: 'users/u1' }, { photoURL: url, customPhoto: true });
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
    await waitFor(() => expect(updateDocMock).toHaveBeenCalledWith({ path: 'users/u1' }, { displayName: 'New Name' }));
    await waitFor(() => expect(screen.queryByText('Edit profile')).not.toBeInTheDocument());
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
      expect(updateDocMock).toHaveBeenCalledWith({ path: 'users/u1' }, { photoURL: customUrl, customPhoto: true }),
    );

    // Simulate the live users/{uid} subscription delivering the new doc.
    userDocState.current = { data: { displayName: 'Alex', photoURL: customUrl, customPhoto: true, createdAt: 0 }, loading: false };
    rerender(<ProfileEditor />);
    expect(preview.getByRole('img')).toHaveAttribute('src', customUrl);
  });
});
