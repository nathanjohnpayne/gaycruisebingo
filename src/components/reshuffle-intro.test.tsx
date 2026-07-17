import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// specs/reshuffle.md — the one-time launch announcement (#378, wireframes
// #frame-launch-intro). Mirrors CoachOverlay.test.tsx's storage-stub harness.

import LaunchIntro from './LaunchIntro';

const SEEN_KEY = 'gcb.seen.reshuffleIntro';

function createStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  } as unknown as Storage;
}

describe('LaunchIntro', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createStorageStub();
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the three beats and the CTA on a first open', () => {
    render(<LaunchIntro />);
    expect(screen.getByText(/New today: reshuffles/)).toBeInTheDocument();
    expect(screen.getByText(/Dealt a dud\?/)).toBeInTheDocument();
    expect(screen.getByText(/Three for the whole cruise/)).toBeInTheDocument();
    expect(screen.getByText(/the moment you tap a square/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Nice—let's play" })).toBeInTheDocument();
  });

  it('dismisses on the CTA and writes the seen key', () => {
    render(<LaunchIntro />);
    fireEvent.click(screen.getByRole('button', { name: "Nice—let's play" }));
    expect(screen.queryByText(/New today: reshuffles/)).not.toBeInTheDocument();
    expect(storage.getItem(SEEN_KEY)).not.toBeNull();
  });

  it('shows EXACTLY once — a later mount with the key set renders nothing', () => {
    const first = render(<LaunchIntro />);
    fireEvent.click(screen.getByRole('button', { name: "Nice—let's play" }));
    first.unmount();

    const second = render(<LaunchIntro />);
    expect(screen.queryByText(/New today: reshuffles/)).not.toBeInTheDocument();
    expect(second.container).toBeEmptyDOMElement();
  });

  it('is not replayable: it renders nothing whenever the key is already set', () => {
    storage.setItem(SEEN_KEY, String(Date.now()));
    const { container } = render(<LaunchIntro />);
    expect(container).toBeEmptyDOMElement();
  });

  it('fires onDismiss so the parent can react', () => {
    const onDismiss = vi.fn();
    render(<LaunchIntro onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: "Nice—let's play" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('forceOpen renders despite the key, and still records the dismissal', () => {
    storage.setItem(SEEN_KEY, '1');
    render(<LaunchIntro forceOpen />);
    expect(screen.getByText(/New today: reshuffles/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: "Nice—let's play" }));
    expect(storage.getItem(SEEN_KEY)).not.toBe('1');
  });

  // Storage-unavailable (private mode) must FALL OPEN — annoying beats invisible
  // for a one-time launch beat, and it must never throw into the Board render.
  it('renders (rather than throwing) when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    } as unknown as Storage);
    expect(() => render(<LaunchIntro />)).not.toThrow();
    expect(screen.getByText(/New today: reshuffles/)).toBeInTheDocument();
    expect(() =>
      fireEvent.click(screen.getByRole('button', { name: "Nice—let's play" })),
    ).not.toThrow();
  });
});
