import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { TallyCard as TallyCardData, TallyEntry } from '../types';

// ProofFeed imports the useData/firebase graph (real getAuth) + auth/proofs/
// analytics at module load; stub them so importing the component to render the
// isolated <TallyCard> never initializes Firebase or posthog.
vi.mock('../firebase', () => ({
  db: {},
  EVENT_ID: 'test-event',
  storage: {},
  auth: {},
  googleProvider: {},
  analytics: null,
}));

const H = vi.hoisted(() => ({ onSnapshot: vi.fn(), navigate: vi.fn() }));
H.onSnapshot.mockReturnValue(() => {});

vi.mock('firebase/firestore', () => {
  const makeRef = (kind: string, args: unknown[]) => {
    const ref: Record<string, unknown> = { kind, args };
    ref.withConverter = () => ref; // paths.ts chains .withConverter on refs
    return ref;
  };
  return {
    doc: (...args: unknown[]) => makeRef('doc', args),
    collection: (...args: unknown[]) => makeRef('collection', args),
    collectionGroup: (...args: unknown[]) => makeRef('collectionGroup', args),
    query: (...args: unknown[]) => ({ query: args }),
    where: (...args: unknown[]) => ({ where: args }),
    onSnapshot: H.onSnapshot,
  };
});
vi.mock('../data/proofs', () => ({ reportProof: vi.fn(), deleteProof: vi.fn() }));
// ProofFeed's ＋ Proof / 🙋 Got it too navigate to the Card tab (#261); the
// module mock keeps the default-export integration renders router-free.
vi.mock('react-router-dom', () => ({ useNavigate: () => H.navigate }));
vi.mock('../analytics', () => ({ track: vi.fn() }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'viewer' } }) }));

import ProofFeed, { TallyCard, tallyCardAction, tallyActionTarget, doubtsClearedByProof } from './ProofFeed';
import { useOpenSquareIntent, __resetOpenSquareForTests } from '../hooks/useOpenSquare';
import { EVENT_ID } from '../firebase'; // the mock above: 'test-event'
import type { BoardDoc } from '../types';

// specs/d15-tally-cards.md — the Feed's Tally Card renderer + its per-viewer
// button gate (#216, daily-cards-spec § "Tally Cards"). The card shows the
// "first two + N" copy, the day chip, and an avatar stack; ＋ Proof / 🙋 Got it
// too render ONLY per the viewer's own marked/dealt state, never generically.

const marker = (uid: string, markedAt: number): TallyEntry => ({
  uid,
  displayName: uid,
  markedAt,
  dayIndex: 0,
  itemText: 'Balcony or porthole photo',
});

const card = (over: Partial<TallyCardData> = {}): TallyCardData => ({
  itemId: 'p1',
  dayIndex: 0,
  itemText: 'Balcony or porthole photo',
  count: 3,
  markers: [marker('alice', 1), marker('bob', 2), marker('carol', 3)],
  lastMarkedAt: 3,
  displayBump: 3,
  ...over,
});

describe('TallyCard — Feed rendering (specs/d15-tally-cards.md)', () => {
  it('renders "first two + N" names, the Prompt text, and a day chip', () => {
    render(<TallyCard card={card()} action={null} days={undefined} />);
    // first two names + "+1" for the third marker
    expect(screen.getByText(/alice, bob \+1/)).toBeTruthy();
    expect(screen.getByText(/Balcony or porthole photo/)).toBeTruthy();
    expect(screen.getByText(/Day 1/)).toBeTruthy(); // 1-based day chip, theme-less fallback
  });

  it('drops the "+N" when only two markers, and shows one name for a single marker', () => {
    render(<TallyCard card={card({ count: 2, markers: [marker('alice', 1), marker('bob', 2)] })} action={null} days={undefined} />);
    expect(screen.getByText(/alice, bob/)).toBeTruthy();
    expect(screen.queryByText(/\+/)).toBeNull();
  });

  it('tapping the card body opens the who-list sheet', () => {
    const onOpenWhoList = vi.fn();
    render(<TallyCard card={card()} action={null} days={undefined} onOpenWhoList={onOpenWhoList} />);
    fireEvent.click(screen.getByTitle('See who marked this'));
    expect(onOpenWhoList).toHaveBeenCalledOnce();
  });

  it('renders ＋ Proof only for the proof action, wired to onAddProof', () => {
    const onAddProof = vi.fn();
    render(<TallyCard card={card()} action="proof" days={undefined} onAddProof={onAddProof} />);
    const btn = screen.getByTitle('Add a proof');
    fireEvent.click(btn);
    expect(onAddProof).toHaveBeenCalledWith('p1');
    expect(screen.queryByTitle(/Got it/)).toBeNull();
  });

  it('renders 🙋 Got it too only for the gotit action', () => {
    render(<TallyCard card={card()} action="gotit" days={undefined} />);
    expect(screen.getByText(/Got it too/)).toBeTruthy();
    expect(screen.queryByTitle('Add a proof')).toBeNull();
  });

  it('renders NO button for the informational (null) action', () => {
    render(<TallyCard card={card()} action={null} days={undefined} />);
    expect(screen.queryByTitle('Add a proof')).toBeNull();
    expect(screen.queryByText(/Got it too/)).toBeNull();
  });

  it('#366: the tappable card body carries an explicit color — the marker names never fall back to UA ButtonText', () => {
    render(<TallyCard card={card()} action={null} days={undefined} />);
    const body = screen.getByTitle('See who marked this') as HTMLButtonElement;
    // Inline `color: inherit` resolves to the surrounding ink (body sets
    // `color: var(--ink)`; no ancestor between overrides it), so the names in
    // the .name span render themed on every platform instead of near-black.
    expect(body.style.color).toBe('inherit');
  });

  it('#366: the global button reset in index.css also inherits color (jsdom never applies the stylesheet, so pin the rule itself)', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.css'), 'utf-8');
    const m = css.match(/(?:^|\n)button\s*\{([^}]*)\}/);
    if (!m) throw new Error('button reset rule not found in index.css');
    expect(m[1]).toMatch(/color:\s*inherit/);
  });
});

describe('tallyCardAction — per-viewer button gate (specs/d15-tally-cards.md)', () => {
  it('＋ Proof when the viewer has MARKED that Prompt', () => {
    expect(tallyCardAction('p1', new Set(['p1']), new Set())).toBe('proof');
  });

  it('🙋 Got it too when the Prompt is UNMARKED on the viewer’s own dealt card', () => {
    expect(tallyCardAction('p1', new Set(), new Set(['p1']))).toBe('gotit');
  });

  it('informational (null) when the Prompt is not on the viewer’s card at all', () => {
    expect(tallyCardAction('p1', new Set(['other']), new Set(['another']))).toBeNull();
  });

  it('＋ Proof wins if a Prompt is somehow both — a marked Prompt is never also unmarked', () => {
    expect(tallyCardAction('p1', new Set(['p1']), new Set(['p1']))).toBe('proof');
  });
});

// #216 gap closure — the LIVE `ProofFeed` default export now wires its
// Feed-level `TallyCard`'s `onOpenWhoList` to a read-only who-list sheet built
// straight off the tally doc's own `markers[]`. Drives the REAL `useFeed`
// (proofs/moments/tally streams stubbed via `onSnapshot`) rather than the
// isolated `<TallyCard>` above, so the wiring itself — not just the
// presentational component — is under test.
const emptyColSnap = { docs: [], metadata: { fromCache: false } };
const emptyDocSnap = { exists: () => false, data: () => undefined, metadata: { fromCache: false } };

function markerDoc(itemId: string, entry: TallyEntry) {
  return {
    data: () => entry,
    // The full ancestor chain useTallyCards guards on:
    // events/{EVENT_ID}/tally/{itemId}/markers/{uid} — including the event id
    // (a sibling event's markers are filtered out, never merged into a card).
    ref: { parent: { parent: { id: itemId, parent: { id: 'tally', parent: { id: EVENT_ID } } } } },
  };
}

function captureOnNext(): {
  fire: (tally: unknown, proofs?: unknown, moments?: unknown, event?: unknown) => void;
  fireBoard: (dayIndex: number, board: BoardDoc | null) => void;
} {
  const captured: { proofs: ((s: unknown) => void) | null; moments: ((s: unknown) => void) | null; events: ((s: unknown) => void)[]; tally: ((s: unknown) => void) | null; doubtsAll: ((s: unknown) => void) | null; boards: Record<number, (s: unknown) => void> } = {
    proofs: null,
    moments: null,
    // EVERY event-doc subscription (#262: useAllDoubts' moderation read opens
    // a second one) — fire() feeds them all so none starves.
    events: [],
    tally: null,
    doubtsAll: null,
    boards: {},
  };
  H.onSnapshot.mockImplementation((target: unknown, optionsOrNext: unknown, maybeNext?: (s: unknown) => void) => {
    // useMyDayBoards (#261) subscribes WITHOUT an options arg; useDocSub passes
    // one. Normalize so both shapes capture their onNext.
    const onNext = (typeof optionsOrNext === 'function' ? optionsOrNext : maybeNext) as (s: unknown) => void;
    const kind = target && typeof target === 'object' ? (target as { kind?: string }).kind : undefined;
    const args = target && typeof target === 'object' ? ((target as { args?: unknown[] }).args ?? []) : [];
    if (target && typeof target === 'object' && 'query' in (target as object)) captured.proofs = onNext;
    else if (kind === 'doc' && args[3] === 'days') captured.boards[Number(args[4])] = onNext;
    else if (kind === 'doc') captured.events.push(onNext);
    else if (kind === 'collectionGroup') captured.tally = onNext;
    // #262: the Feed also opens the flat doubts subscription; route it by its
    // own path segment so it can't clobber the moments capture.
    else if (kind === 'collection' && args[3] === 'doubts') captured.doubtsAll = onNext;
    else captured.moments = onNext;
    return () => {};
  });
  return {
    fire: (tally, proofs = emptyColSnap, moments = emptyColSnap, event = emptyDocSnap) => {
      act(() => {
        captured.proofs?.(proofs);
        captured.moments?.(moments);
        captured.events.forEach((fn) => fn(event));
        captured.tally?.(tally);
        captured.doubtsAll?.(emptyColSnap);
      });
    },
    fireBoard: (dayIndex: number, board: BoardDoc | null) => {
      act(() => {
        captured.boards[dayIndex]?.({
          exists: () => board != null,
          data: () => board ?? undefined,
          metadata: { fromCache: false },
        });
      });
    },
  };
}

describe('ProofFeed (default export) — Feed-level who-list sheet (#216 acceptance: "Tap opens the who-list sheet")', () => {
  it('tapping a live Feed Tally Card opens a read-only sheet listing its markers', () => {
    H.onSnapshot.mockReset();
    const sub = captureOnNext();
    render(<ProofFeed />);

    const entry: TallyEntry = {
      uid: 'alice',
      displayName: 'Alice Anchor',
      markedAt: 1000,
      dayIndex: 0,
      itemText: 'Balcony or porthole photo',
    };
    sub.fire({ docs: [markerDoc('p1', entry)], metadata: { fromCache: false } });

    const tallyCard = document.querySelector('.tally-card');
    expect(tallyCard).toBeTruthy();
    // No who-list sheet until the card is tapped.
    expect(screen.queryByText(/^Who got/)).toBeNull();

    fireEvent.click(tallyCard!.querySelector('.tally-card-body')!);

    // The sheet opens, names the SAME Prompt, and lists the marker — read-only
    // (no Doubt affordance; the Board-side who-list owns that).
    expect(screen.getByText(/Who got/)).toBeTruthy();
    const sheetRows = document.querySelectorAll('.sheet .list .row');
    expect(sheetRows).toHaveLength(1);
    expect(sheetRows[0].querySelector('.name')?.textContent).toBe('Alice Anchor');
    expect(document.querySelector('.sheet .doubt-btn')).toBeNull();

    // Close dismisses it.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText(/^Who got/)).toBeNull();
  });

  it('the open sheet re-derives its markers from the live tally (#333): arrivals appear, unmarks leave', () => {
    H.onSnapshot.mockReset();
    const sub = captureOnNext();
    render(<ProofFeed />);

    const alice: TallyEntry = {
      uid: 'alice',
      displayName: 'Alice Anchor',
      markedAt: 1000,
      dayIndex: 0,
      itemText: 'Balcony or porthole photo',
    };
    const bob: TallyEntry = {
      uid: 'bob',
      displayName: 'Bob Bosun',
      markedAt: 2000,
      dayIndex: 0,
      itemText: 'Balcony or porthole photo',
    };
    sub.fire({ docs: [markerDoc('p1', alice)], metadata: { fromCache: false } });
    fireEvent.click(document.querySelector('.tally-card .tally-card-body')!);
    expect(document.querySelectorAll('.sheet .list .row')).toHaveLength(1);

    // A new marker arrives while the sheet is open — the sheet shows the LIVE
    // list, not the tap-time snapshot.
    sub.fire({ docs: [markerDoc('p1', alice), markerDoc('p1', bob)], metadata: { fromCache: false } });
    let rows = document.querySelectorAll('.sheet .list .row');
    expect(rows).toHaveLength(2);
    expect([...rows].map((r) => r.querySelector('.name')?.textContent)).toContain('Bob Bosun');

    // A marker unmarks while the sheet is open — the stale row leaves.
    sub.fire({ docs: [markerDoc('p1', bob)], metadata: { fromCache: false } });
    rows = document.querySelectorAll('.sheet .list .row');
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector('.name')?.textContent).toBe('Bob Bosun');
    // The sheet itself stayed open throughout — same dialog, live content.
    expect(screen.getByText(/Who got/)).toBeTruthy();
  });
});

// --- #261: Feed Tally Card actions — target resolution + live wiring -------

const boardWith = (cells: { itemId: string; marked?: boolean; free?: boolean }[], dayIndex = 0): BoardDoc => ({
  uid: 'viewer',
  dayIndex,
  seed: 1,
  createdAt: 0,
  cells: cells.map((c, index) => ({
    index,
    itemId: c.free ? '' : c.itemId,
    text: c.itemId,
    spicy: false,
    free: !!c.free,
    marked: !!c.marked,
    markedAt: c.marked ? 1 : null,
  })),
});

describe('tallyActionTarget — where a Tally Card button lands (#261)', () => {
  it('resolves the Day carrying the Prompt, marked-ness included', () => {
    const boards = new Map([[1, boardWith([{ itemId: 'p1' }], 1)]]);
    expect(tallyActionTarget({ itemId: 'p1', dayIndex: 0 }, boards)).toEqual({ dayIndex: 1, itemId: 'p1', marked: false });
  });

  it('a marked hit anywhere beats an unmarked one (＋ Proof beats 🙋 Got it too)', () => {
    const boards = new Map([
      [0, boardWith([{ itemId: 'p1' }], 0)],
      [2, boardWith([{ itemId: 'p1', marked: true }], 2)],
    ]);
    expect(tallyActionTarget({ itemId: 'p1', dayIndex: 0 }, boards)).toEqual({ dayIndex: 2, itemId: 'p1', marked: true });
  });

  it("prefers the card's own Day among equal marked-ness, then the latest Day", () => {
    const boards = new Map([
      [0, boardWith([{ itemId: 'p1' }], 0)],
      [3, boardWith([{ itemId: 'p1' }], 3)],
    ]);
    expect(tallyActionTarget({ itemId: 'p1', dayIndex: 3 }, boards)?.dayIndex).toBe(3);
    expect(tallyActionTarget({ itemId: 'p1', dayIndex: 7 }, boards)?.dayIndex).toBe(3);
  });

  it('null when the Prompt is on none of the viewer cards (informational card)', () => {
    const boards = new Map([[0, boardWith([{ itemId: 'other' }, { itemId: '', free: true }], 0)]]);
    expect(tallyActionTarget({ itemId: 'p1', dayIndex: 0 }, boards)).toBeNull();
  });
});

describe('ProofFeed — Tally Card actions wired to the Board sheet (#261)', () => {
  const dayFixture = (index: number) => ({
    index,
    date: `2026-07-${15 + index}`,
    port: `Port ${index}`,
    portEmoji: '🇭🇷',
    theme: 'get-sporty',
    pool: 'main',
    tutorial: false,
    unlockAt: 0,
  });
  const eventSnap = {
    exists: () => true,
    data: () => ({ days: [dayFixture(0)] }),
    metadata: { fromCache: false },
  };
  const IntentProbe = () => {
    const intent = useOpenSquareIntent();
    return <div data-testid="intent">{intent ? `${intent.dayIndex}:${intent.itemId}` : ''}</div>;
  };
  const markers = { docs: [markerDoc('p1', { uid: 'alice', displayName: 'Alice', markedAt: 1, dayIndex: 0, itemText: 'Balcony or porthole photo' })], metadata: { fromCache: false } };

  it('🙋 Got it too renders for an unmarked Prompt on the viewer card; tap records the intent and navigates to the Card tab', () => {
    __resetOpenSquareForTests();
    H.navigate.mockReset();
    H.onSnapshot.mockReset();
    const sub = captureOnNext();
    render(
      <>
        <ProofFeed />
        <IntentProbe />
      </>,
    );
    sub.fire(markers, emptyColSnap, emptyColSnap, eventSnap);
    sub.fireBoard(0, boardWith([{ itemId: 'p1' }], 0));

    const btn = screen.getByText(/Got it too/);
    fireEvent.click(btn);
    expect(H.navigate).toHaveBeenCalledWith('/');
    expect(screen.getByTestId('intent').textContent).toBe('0:p1');
  });

  it('＋ Proof renders for a marked Prompt; an off-card Prompt stays informational', () => {
    __resetOpenSquareForTests();
    H.navigate.mockReset();
    H.onSnapshot.mockReset();
    const sub = captureOnNext();
    render(<ProofFeed />);
    sub.fire(markers, emptyColSnap, emptyColSnap, eventSnap);

    // Board arrives with the Prompt already marked → ＋ Proof.
    sub.fireBoard(0, boardWith([{ itemId: 'p1', marked: true }], 0));
    expect(screen.getByTitle('Add a proof')).toBeTruthy();
    expect(screen.queryByText(/Got it too/)).toBeNull();

    // Board swaps to one without the Prompt → no button at all.
    sub.fireBoard(0, boardWith([{ itemId: 'other' }], 0));
    expect(screen.queryByTitle('Add a proof')).toBeNull();
    expect(screen.queryByText(/Got it too/)).toBeNull();
  });
});

describe('doubtsClearedByProof — the wireframes\' "👀 cleared N doubts" pill (#262)', () => {
  const mapping = new Map([['item-1', 'Lost passport']]);
  const doubt = (over: Record<string, unknown>) => ({
    id: 'd', itemId: 'item-1', cellIndex: 0, fromUid: 'f', fromDisplayName: 'F',
    targetUid: 'bob', targetDisplayName: 'Bob', createdAt: 1000, ...over,
  }) as import('../types').DoubtDoc;
  const proof = { id: 'p-late', uid: 'bob', itemText: 'Lost passport', createdAt: 2000 };

  it('counts only doubts against the prover, on the same Prompt, satisfied by THIS proof', () => {
    const doubts = [
      doubt({ id: 'd1' }), // cleared
      doubt({ id: 'd2', createdAt: 1500 }), // cleared
      doubt({ id: 'd3', targetUid: 'carol' }), // wrong target
      doubt({ id: 'd4', itemId: 'other-item' }), // wrong prompt
    ];
    expect(doubtsClearedByProof(proof, doubts, mapping)).toBe(2);
  });

  it('zero when nothing matches (no pill renders)', () => {
    expect(doubtsClearedByProof(proof, [], mapping)).toBe(0);
  });

  it('a once-only Doubt belongs to the EARLIEST satisfying proof — later proofs on the same Prompt do not re-count it (Codex P2, round 2)', () => {
    const doubts = [doubt({ id: 'd1' })];
    const earliest = { id: 'p-early', uid: 'bob', itemText: 'Lost passport', createdAt: 1500 };
    const stream = [earliest, proof];
    // The earliest satisfying proof wears the pill…
    expect(doubtsClearedByProof(earliest, doubts, mapping, stream)).toBe(1);
    // …and the later proof does NOT re-claim the already-answered Doubt.
    expect(doubtsClearedByProof(proof, doubts, mapping, stream)).toBe(0);
    // A same-timestamp tie breaks deterministically by id (ascending).
    const twin = { id: 'p-a', uid: 'bob', itemText: 'Lost passport', createdAt: 2000 };
    expect(doubtsClearedByProof(twin, doubts, mapping, [twin, proof])).toBe(1);
    expect(doubtsClearedByProof(proof, doubts, mapping, [twin, proof])).toBe(0);
  });

  it('a proof that predates the Doubt never steals it from the real answer', () => {
    const doubts = [doubt({ id: 'd1', createdAt: 1000 })];
    // 200s before the doubt — outside the satisfaction skew, so NOT satisfying.
    const before = { id: 'p-before', uid: 'bob', itemText: 'Lost passport', createdAt: 800000 - 999999 };
    expect(doubtsClearedByProof(proof, doubts, mapping, [before, proof])).toBe(1);
  });
});
