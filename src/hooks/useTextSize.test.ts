import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTextSize, __resetTextSizeStateForTests, DEFAULT_TEXT_SIZE } from './useTextSize';

// specs/d15-text-size.md: a Player's text-size pick persists per device
// (`localStorage['gcb.textSize']`) and survives a remount — the same
// persistence contract w1-themes.test.tsx exercises for `gcb.theme`.

const STORAGE_KEY = 'gcb.textSize';

// This repo's Vitest jsdom project doesn't configure a same-origin `url`, so
// jsdom leaves `window.localStorage` unset (see src/theme/w1-themes.test.tsx
// for the same note against ThemeContext). Install a minimal in-memory
// Storage so the persistence behavior under test is real, scoped to this
// file only.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear() {
    this.store.clear();
  }
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number) {
    return [...this.store.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
}

if (!window.localStorage) {
  Object.defineProperty(window, 'localStorage', {
    value: new MemoryStorage(),
    writable: true,
    configurable: true,
  });
}

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.textSize;
  __resetTextSizeStateForTests();
});

describe('useTextSize (specs/d15-text-size.md)', () => {
  it('defaults to medium and does not auto-persist the default', () => {
    const { result } = renderHook(() => useTextSize());
    const [size] = result.current;
    expect(size).toBe(DEFAULT_TEXT_SIZE);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('a pick persists to localStorage and applies to <html data-text-size>', () => {
    const { result } = renderHook(() => useTextSize());
    act(() => {
      const [, setTextSize] = result.current;
      setTextSize('large');
    });
    expect(result.current[0]).toBe('large');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('large');
    expect(document.documentElement.dataset.textSize).toBe('large');
  });

  it('survives a remount by reading the saved pick back on mount', () => {
    const first = renderHook(() => useTextSize());
    act(() => {
      const [, setTextSize] = first.result.current;
      setTextSize('small');
    });
    first.unmount();

    // A fresh mount (e.g. reload) starts from a clean module snapshot, same
    // as the app's own reload — only the localStorage side effect survives.
    __resetTextSizeStateForTests();
    const second = renderHook(() => useTextSize());
    expect(second.result.current[0]).toBe('small');
  });

  it("shares one live value across independent mount points (More's control and Board's fit guard)", () => {
    const moreRow = renderHook(() => useTextSize());
    const board = renderHook(() => useTextSize());

    act(() => {
      const [, setTextSize] = moreRow.result.current;
      setTextSize('large');
    });

    expect(moreRow.result.current[0]).toBe('large');
    // The second, independent hook instance sees the SAME live pick with no
    // remount — the shared-store contract useInstallPrompt already relies on.
    expect(board.result.current[0]).toBe('large');
  });
});
