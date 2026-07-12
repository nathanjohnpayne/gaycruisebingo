import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DayDef } from '../types';
import TutorialBanner, { WarmUpTag } from './TutorialBanner';

// Covers specs/d15-tutorial-banners.md: the embark "How this works" banner,
// the farewell goodbye banner, and the "Warm-up" tag (daily-cards-spec §§
// "Embark (tutorial) view" / "Farewell view").

function day(overrides: Partial<DayDef> & Pick<DayDef, 'index' | 'pool' | 'tutorial'>): DayDef {
  return {
    date: '2026-07-15',
    port: 'Trieste',
    portEmoji: '🇮🇹',
    theme: 'welcome-aboard',
    unlockAt: 0,
    ...overrides,
  };
}

const EMBARK_DAY = day({ index: 0, pool: 'embark', tutorial: true, theme: 'welcome-aboard' });
const FAREWELL_DAY = day({
  index: 9,
  pool: 'farewell',
  tutorial: true,
  theme: 'so-long-farewell',
  port: 'Barcelona',
  portEmoji: '🇪🇸',
});
const MAIN_DAY = day({ index: 2, pool: 'main', tutorial: false, theme: 'get-sporty', port: 'Split' });

describe('TutorialBanner — embark banner', () => {
  it('renders all three beats + the warm-up caption on the Welcome Aboard Day', () => {
    render(<TutorialBanner day={EMBARK_DAY} />);
    expect(
      screen.getByText('Mark what happens. Tap a square when you see it, do it, or survive it.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Five in a row is BINGO. The center is free. Blackout the card if you're ambitious.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('The feed is the proof. Attach a pic, doubt a friend, watch the Moments roll in.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This one's a warm-up—easy squares, all on the ship. The real chaos starts tomorrow at 8.",
      ),
    ).toBeInTheDocument();
  });

  it('dismisses on tap', () => {
    render(<TutorialBanner day={EMBARK_DAY} />);
    const banner = screen.getByRole('button', { name: /how this works/i });
    fireEvent.click(banner);
    expect(screen.queryByText(/mark what happens/i)).not.toBeInTheDocument();
  });

  it('does not render on any non-tutorial Day', () => {
    render(<TutorialBanner day={MAIN_DAY} />);
    expect(screen.queryByText(/mark what happens/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /how this works/i })).not.toBeInTheDocument();
  });
});

describe('TutorialBanner — farewell banner', () => {
  it('renders the goodbye copy on the So Long, Farewell Day, with no dismiss affordance', () => {
    render(<TutorialBanner day={FAREWELL_DAY} />);
    expect(
      screen.getByText('Last one. Mark your goodbyes—then go book next year.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('does not render on any non-tutorial Day', () => {
    render(<TutorialBanner day={MAIN_DAY} />);
    expect(screen.queryByText(/mark your goodbyes/i)).not.toBeInTheDocument();
  });
});

describe('WarmUpTag', () => {
  it('renders the "Warm-up" label', () => {
    render(<WarmUpTag />);
    expect(screen.getByText('Warm-up')).toBeInTheDocument();
  });
});
