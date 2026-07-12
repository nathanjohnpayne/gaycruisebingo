import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Covers specs/d15-claim-sheet-photo.md (#211, closes #190) at two layers:
//   1. ProofSheet (RTL-jsdom) — the two-affordance photo body, the camera_only
//      override, the capture attributes, the source stamp, and the heat line.
//   2. uploadProofMedia (unit) — the EXIF/GPS strip re-encode + fail-closed guard.
// The Feed's 🖼️ badge + Day chip are covered in w2-proof-capture-feed.test.tsx;
// attachProof's source/dayIndex stamp + strip pass-through in w2-proof-capture.test.ts.

const H = vi.hoisted(() => ({ attachProof: vi.fn(), uploadBytes: vi.fn(), getDownloadURL: vi.fn() }));

vi.mock('../data/proofs', () => ({ attachProof: H.attachProof }));
vi.mock('../analytics', () => ({ track: vi.fn() }));
vi.mock('../firebase', () => ({ storage: {}, EVENT_ID: 'med-2026' }));
vi.mock('firebase/storage', () => ({
  ref: (_s: unknown, path: string) => ({ path }),
  uploadBytes: H.uploadBytes,
  getDownloadURL: H.getDownloadURL,
  deleteObject: vi.fn(),
}));

import ProofSheet from './ProofSheet';
import { uploadProofMedia } from '../data/storage';
import type { Cell } from '../types';

const cell = (): Cell => ({ index: 0, itemId: 'i0', text: 'Saw a sailor in Speedos', free: false, marked: false, markedAt: null });
const baseProps = () => ({
  uid: 'u1',
  displayName: 'Deck Daddy',
  photoURL: null,
  cells: [cell()],
  cell: cell(),
  claimMode: 'proof_required' as const,
  currentFirstBingoAt: null,
  onClose: vi.fn(),
});
const fileInputs = (c: HTMLElement) => Array.from(c.querySelectorAll('input[type="file"]')) as HTMLInputElement[];

beforeAll(() => {
  (globalThis.URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:mock';
});
beforeEach(() => {
  vi.clearAllMocks();
  H.attachProof.mockResolvedValue(undefined);
  vi.spyOn(window, 'alert').mockImplementation(() => {});
});

describe('ProofSheet photo body — two affordances (#190)', () => {
  it('renders BOTH 📷 Take photo and 🖼️ Library by default, in every Claim Mode', async () => {
    const user = userEvent.setup();
    for (const claimMode of ['honor', 'proof_required', 'admin_confirmed'] as const) {
      const { container, unmount } = render(<ProofSheet {...baseProps()} claimMode={claimMode} />);
      await user.click(screen.getByRole('button', { name: /photo/i }));
      expect(screen.getByText(/Take photo/i)).toBeInTheDocument();
      expect(screen.getByText(/Library/i)).toBeInTheDocument();
      // 📷 keeps capture="environment"; 🖼️ has NO capture attribute.
      const [cam, lib] = fileInputs(container);
      expect(cam.getAttribute('capture')).toBe('environment');
      expect(lib.hasAttribute('capture')).toBe(false);
      unmount();
    }
  });

  it('hides 🖼️ Library when photoProofSource is camera_only, regardless of Claim Mode', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ProofSheet {...baseProps()} claimMode="honor" photoProofSource="camera_only" />,
    );
    await user.click(screen.getByRole('button', { name: /photo/i }));
    expect(screen.getByText(/Take photo/i)).toBeInTheDocument();
    expect(screen.queryByText(/Library/i)).toBeNull();
    expect(fileInputs(container)).toHaveLength(1);
  });

  it('stamps source:"library" when the file comes through the 🖼️ Library input', async () => {
    const user = userEvent.setup();
    const { container } = render(<ProofSheet {...baseProps()} dayIndex={2} stripExif />);
    await user.click(screen.getByRole('button', { name: /photo/i }));
    const [, lib] = fileInputs(container);
    await user.upload(lib, new File(['img'], 'p.jpg', { type: 'image/jpeg' }));
    await user.click(screen.getByRole('button', { name: /mark it/i }));

    await waitFor(() => expect(H.attachProof).toHaveBeenCalledTimes(1));
    expect(H.attachProof.mock.calls[0][0]).toMatchObject({ source: 'library', dayIndex: 2, stripExif: true });
  });

  it('stamps source:"camera" when the file comes through the 📷 Take photo input', async () => {
    const user = userEvent.setup();
    const { container } = render(<ProofSheet {...baseProps()} />);
    await user.click(screen.getByRole('button', { name: /photo/i }));
    const [cam] = fileInputs(container);
    await user.upload(cam, new File(['img'], 'p.jpg', { type: 'image/jpeg' }));
    await user.click(screen.getByRole('button', { name: /mark it/i }));

    await waitFor(() => expect(H.attachProof).toHaveBeenCalledTimes(1));
    expect(H.attachProof.mock.calls[0][0].source).toBe('camera');
  });

  it('renders the "🔥 Marked by N others" heat line from tallyCount (and nothing at 0)', () => {
    const { rerender } = render(<ProofSheet {...baseProps()} tallyCount={3} />);
    expect(screen.getByText(/🔥 Marked by 3 others so far/)).toBeInTheDocument();
    rerender(<ProofSheet {...baseProps()} tallyCount={1} />);
    expect(screen.getByText(/🔥 Marked by 1 other so far/)).toBeInTheDocument();
    rerender(<ProofSheet {...baseProps()} tallyCount={0} />);
    expect(screen.queryByText(/Marked by/)).toBeNull();
  });
});

describe('uploadProofMedia — EXIF/GPS strip (#211)', () => {
  beforeEach(() => {
    H.uploadBytes.mockResolvedValue(undefined);
    H.getDownloadURL.mockResolvedValue('https://firebasestorage.example/p.jpg');
  });

  // A canvas repaint that yields a fresh, metadata-free JPEG. We return a known
  // blob object so the assertion can prove THAT re-encoded blob — not the raw,
  // geotagged input — is what uploadBytes receives.
  const cleanBlob = new Blob(['clean-jpeg-bytes'], { type: 'image/jpeg' });
  const mockCanvasOk = () => {
    (globalThis as unknown as { createImageBitmap: unknown }).createImageBitmap = vi
      .fn()
      .mockResolvedValue({ width: 100, height: 80 });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback) {
      cb(cleanBlob);
    });
  };

  it('re-encodes the photo so the raw geotagged blob never reaches uploadBytes', async () => {
    mockCanvasOk();
    const raw = new Blob(['\xFF\xE1EXIF-GPS-geotag-payload'], { type: 'image/jpeg' });
    await uploadProofMedia('u1', 'P', raw, 'photo', { stripExif: true });

    expect(H.uploadBytes).toHaveBeenCalledTimes(1);
    const uploaded = H.uploadBytes.mock.calls[0][1] as Blob;
    expect(uploaded).toBe(cleanBlob); // the re-encoded blob…
    expect(uploaded).not.toBe(raw); // …never the geotagged original
  });

  it('fails closed when the strip is required but the photo could not be re-encoded', async () => {
    // Decode failure → downscaleImage falls back to the raw blob (EXIF intact).
    (globalThis as unknown as { createImageBitmap: unknown }).createImageBitmap = vi.fn().mockRejectedValue(new Error('nope'));
    const raw = new Blob(['geotagged'], { type: 'image/jpeg' });
    await expect(uploadProofMedia('u1', 'P', raw, 'photo', { stripExif: true })).rejects.toThrow(/strip EXIF/i);
    expect(H.uploadBytes).not.toHaveBeenCalled();
  });
});
