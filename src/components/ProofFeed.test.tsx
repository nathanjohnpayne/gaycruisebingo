import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => ({ kind: 'doc', args, withConverter: () => ({}) }),
  collection: (...args: unknown[]) => ({ kind: 'collection', args, withConverter: () => ({}) }),
  collectionGroup: (...args: unknown[]) => ({ kind: 'collectionGroup', args }),
  query: (...args: unknown[]) => ({ query: args }),
  where: (...args: unknown[]) => ({ where: args }),
  onSnapshot: vi.fn(() => () => {}),
}));
vi.mock('../data/proofs', () => ({ reportProof: vi.fn(), deleteProof: vi.fn() }));
vi.mock('../analytics', () => ({ track: vi.fn() }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'viewer' } }) }));

import { TallyCard, tallyCardAction } from './ProofFeed';

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
