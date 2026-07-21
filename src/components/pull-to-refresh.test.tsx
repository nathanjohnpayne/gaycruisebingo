// specs/pull-to-refresh.md — the PWA refresh gesture. Two layers:
//   1. The pure resistance curve + constants (src/game/motion.ts).
//   2. PullToRefresh's gesture contract, driven by synthetic touch events
//      (jsdom has no TouchEvent constructor — plain Events with `touches`
//      pinned on, the same shape the handlers read) with an injected
//      onRefresh and fake timers.
// Plus the index.css structural pins. Real scroll physics are not
// assertable in jsdom; the e2e layer and live use cover feel.
import { readFileSync } from 'node:fs';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PullToRefresh from './PullToRefresh';
import {
  pullProgress,
  PTR_MAX_PULL_PX,
  PTR_SLOP_PX,
  PTR_THRESHOLD_PX,
} from '../game/motion';

const indexCss = readFileSync('src/index.css', 'utf8');

/** Synthetic touch event: jsdom lacks TouchEvent, so pin `touches` onto a
 * cancelable Event — exactly the fields the component reads. Dispatched on
 * `target` (bubbles to window, where the listeners live). */
function fireTouch(type: string, x: number, y: number, target: EventTarget = window) {
  const evt = new Event(type, { bubbles: true, cancelable: true });
  const touch = { clientX: x, clientY: y };
  Object.defineProperty(evt, 'touches', { value: type === 'touchend' ? [] : [touch] });
  act(() => {
    target.dispatchEvent(evt);
  });
  return evt;
}

/** A full pull gesture: start at (x, y0), drag to y1, release. */
function pullGesture(y0: number, y1: number, target: EventTarget = window) {
  fireTouch('touchstart', 100, y0, target);
  // Two moves: one to clear the slop/direction gate, one to the final pull.
  fireTouch('touchmove', 100, y0 + PTR_SLOP_PX + 4, target);
  fireTouch('touchmove', 100, y1, target);
  fireTouch('touchend', 100, y1, target);
}

function setScrollY(value: number) {
  Object.defineProperty(window, 'scrollY', { value, configurable: true, writable: true });
}

beforeEach(() => {
  vi.useFakeTimers();
  setScrollY(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('pullProgress — the resistance curve (specs/pull-to-refresh.md)', () => {
  it('is zero-clamped, monotonic, and capped', () => {
    expect(pullProgress(-50)).toBe(0);
    expect(pullProgress(0)).toBe(0);
    expect(pullProgress(Number.NaN)).toBe(0);
    let prev = 0;
    for (const dy of [10, 40, 80, 156, 300, 1000]) {
      const p = pullProgress(dy);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
    expect(pullProgress(10000)).toBe(PTR_MAX_PULL_PX);
  });

  it('the threshold is reachable with a deliberate but human drag', () => {
    // ~156px of finger travel crosses the 70px threshold; a graze does not.
    expect(pullProgress(160)).toBeGreaterThanOrEqual(PTR_THRESHOLD_PX);
    expect(pullProgress(60)).toBeLessThan(PTR_THRESHOLD_PX);
  });
});

describe('PullToRefresh — gesture contract', () => {
  it('a past-threshold pull spins, announces, and fires onRefresh after the show-the-spin delay', () => {
    const onRefresh = vi.fn();
    render(<PullToRefresh onRefresh={onRefresh} />);
    pullGesture(10, 10 + 200);
    const ptr = document.querySelector('.ptr')!;
    expect(ptr.className).toContain('ptr-refreshing');
    expect(document.querySelector('[role="status"]')!.textContent).toBe('Refreshing');
    expect(onRefresh).not.toHaveBeenCalled(); // the spin gets its beat first
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('a below-threshold pull snaps back and never refreshes', () => {
    const onRefresh = vi.fn();
    render(<PullToRefresh onRefresh={onRefresh} />);
    pullGesture(10, 10 + 60); // 60px raw → ~27px pull, well under 70
    const ptr = document.querySelector('.ptr')!;
    expect(ptr.className).not.toContain('ptr-refreshing');
    expect(ptr.getAttribute('style')).toContain('--ptr-pull: 0px');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('never arms when the page is scrolled down', () => {
    const onRefresh = vi.fn();
    render(<PullToRefresh onRefresh={onRefresh} />);
    setScrollY(240);
    pullGesture(10, 10 + 300);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onRefresh).not.toHaveBeenCalled();
    expect(document.querySelector('.ptr')!.className).toBe('ptr');
  });

  it('hands a horizontal-dominant swipe to the carousels — no pull engages', () => {
    const onRefresh = vi.fn();
    render(<PullToRefresh onRefresh={onRefresh} />);
    fireTouch('touchstart', 100, 10);
    const move = fireTouch('touchmove', 100 + 80, 10 + 40); // dx 80 ≥ dy 40
    expect(move.defaultPrevented).toBe(false); // scroll keeps its fast path
    fireTouch('touchend', 180, 50);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('never arms from inside a sheet overlay', () => {
    const onRefresh = vi.fn();
    render(
      <div className="sheet-backdrop">
        <div className="sheet" data-testid="sheet-body" />
      </div>,
    );
    render(<PullToRefresh onRefresh={onRefresh} />);
    const sheetBody = document.querySelector('[data-testid="sheet-body"]')!;
    pullGesture(10, 10 + 300, sheetBody);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('an engaged pull owns the touch: move events are defaultPrevented', () => {
    render(<PullToRefresh onRefresh={vi.fn()} />);
    fireTouch('touchstart', 100, 10);
    fireTouch('touchmove', 100, 10 + PTR_SLOP_PX + 4); // engages
    const move = fireTouch('touchmove', 100, 10 + 120);
    expect(move.defaultPrevented).toBe(true);
    expect(document.querySelector('.ptr')!.className).toContain('ptr-pulling');
    fireTouch('touchend', 100, 130);
  });

  it('crossing the threshold mid-drag wears the ready pop state', () => {
    render(<PullToRefresh onRefresh={vi.fn()} />);
    fireTouch('touchstart', 100, 10);
    fireTouch('touchmove', 100, 10 + PTR_SLOP_PX + 4);
    fireTouch('touchmove', 100, 10 + 200); // past threshold, still held
    expect(document.querySelector('.ptr')!.className).toContain('ptr-ready');
    fireTouch('touchend', 100, 210);
  });
});

describe('index.css — pull-to-refresh structure (specs/pull-to-refresh.md)', () => {
  it('defines the ptr keyframes ahead of the reduced-motion kill switch', () => {
    const killSwitchAt = indexCss.indexOf('reduced motion: the kill switch');
    expect(killSwitchAt).toBeGreaterThan(-1);
    for (const name of ['ptr-pop', 'ptr-spin']) {
      const at = indexCss.indexOf(`@keyframes ${name}`);
      expect(at).toBeGreaterThan(-1);
      expect(at).toBeLessThan(killSwitchAt);
    }
  });

  it('suppresses the browser-native pull gesture so the app one answers', () => {
    expect(indexCss).toMatch(/overscroll-behavior-y:\s*contain/);
  });

  it('the indicator follows the finger via inline vars, not an animation (reduced-motion functional)', () => {
    const ring = indexCss.match(/\.ptr-ring\s*\{[^}]*\}/)?.[0] ?? '';
    expect(ring).toMatch(/translateY\(calc\(var\(--ptr-pull/);
    expect(ring).not.toMatch(/animation/);
  });
});
