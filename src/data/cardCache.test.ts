import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { saveCardSnapshot, loadCardSnapshot, hasCardSnapshot, type CardSnapshot } from './cardCache';
import type { Cell } from '../types';

// jsdom here leaves `window.localStorage` unset (see src/hooks/useTextSize.test.ts),
// so provide a real in-memory Storage the module under test can read/write.
class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
}

// The Event id cardCache scopes keys by — the src/firebase.ts default when
// VITE_EVENT_ID is unset (the value under test).
const EVENT_ID = 'med-2026';
const UID = 'user-1';
const keyFor = (uid: string) => `gcb:card-snapshot:${EVENT_ID}:${uid}`;

function cell(index: number, over: Partial<Cell> = {}): Cell {
  return {
    index,
    itemId: index === 12 ? null : `item-${index}`,
    text: index === 12 ? 'FREE' : `Prompt ${index}`,
    free: index === 12,
    marked: index === 12,
    markedAt: index === 12 ? 1 : null,
    ...over,
  };
}
const CELLS: Cell[] = Array.from({ length: 25 }, (_, i) => cell(i));

const SAVE = {
  uid: UID,
  dayIndex: 2,
  cells: CELLS,
  bingoCount: 3,
  day: { number: 3, port: 'Split', portEmoji: '🇭🇷', theme: 'get-sporty', label: 'Get Sporty' },
};

describe('cardCache', () => {
  beforeEach(() => vi.stubGlobal('localStorage', new MemoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it('round-trips a saved card snapshot for the (event, user)', () => {
    saveCardSnapshot(SAVE);
    const snap = loadCardSnapshot(UID);
    expect(snap).not.toBeNull();
    expect(snap!.uid).toBe(UID);
    expect(snap!.eventId).toBe(EVENT_ID);
    expect(snap!.dayIndex).toBe(2);
    expect(snap!.bingoCount).toBe(3);
    expect(snap!.cells).toHaveLength(25);
    expect(snap!.day).toEqual(SAVE.day);
    expect(hasCardSnapshot(UID)).toBe(true);
  });

  it('reports no snapshot for a user who has none', () => {
    expect(loadCardSnapshot('nobody')).toBeNull();
    expect(hasCardSnapshot('nobody')).toBe(false);
  });

  it('never saves an empty card (nothing to render)', () => {
    saveCardSnapshot({ ...SAVE, cells: [] });
    expect(hasCardSnapshot(UID)).toBe(false);
  });

  it('supports a legacy single board (null dayIndex + null day)', () => {
    saveCardSnapshot({ ...SAVE, dayIndex: null, day: null });
    const snap = loadCardSnapshot(UID);
    expect(snap!.dayIndex).toBeNull();
    expect(snap!.day).toBeNull();
  });

  it('reads a corrupt/unparseable blob as a miss, never a throw', () => {
    localStorage.setItem(keyFor(UID), '{not valid json');
    expect(loadCardSnapshot(UID)).toBeNull();
    expect(hasCardSnapshot(UID)).toBe(false);
  });

  it('rejects a stale schema version (read as a miss)', () => {
    const stale: CardSnapshot = { ...(SAVE as object as CardSnapshot), v: 0, eventId: EVENT_ID, savedAt: 1 };
    localStorage.setItem(keyFor(UID), JSON.stringify(stale));
    expect(loadCardSnapshot(UID)).toBeNull();
  });

  it('rejects a snapshot whose event id does not match the active event', () => {
    const otherEvent: CardSnapshot = {
      v: 1,
      uid: UID,
      eventId: 'past-cruise',
      dayIndex: 0,
      savedAt: 1,
      bingoCount: 0,
      cells: CELLS,
      day: null,
    };
    localStorage.setItem(keyFor(UID), JSON.stringify(otherEvent));
    expect(loadCardSnapshot(UID)).toBeNull();
  });

  it('never returns account A snapshot for account B (uid-scoped keys)', () => {
    saveCardSnapshot(SAVE);
    expect(hasCardSnapshot('user-2')).toBe(false);
    // A save under B does not disturb A.
    saveCardSnapshot({ ...SAVE, uid: 'user-2' });
    expect(loadCardSnapshot(UID)!.uid).toBe(UID);
    expect(loadCardSnapshot('user-2')!.uid).toBe('user-2');
  });

  it('overwrites with the latest card on re-save', () => {
    saveCardSnapshot(SAVE);
    saveCardSnapshot({ ...SAVE, bingoCount: 9 });
    expect(loadCardSnapshot(UID)!.bingoCount).toBe(9);
  });
});
