import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { THEMES } from './themes';
import { ThemeProvider, useTheme } from './ThemeContext';

// Covers specs/w1-themes.md: WCAG AA contrast across all 8 [data-theme]
// blocks, ThemeContext's persistence + async-default invariants, the <5s PRD
// switch-latency metric, and the "no Atlantis marks" non-goal.

// ---------------------------------------------------------------------------
// Contrast utilities — WCAG 2.1 relative luminance + contrast ratio, computed
// over [data-theme] blocks parsed straight out of themes.css so this test can
// never drift from the CSS it polices (no hand-transcribed color table).
// ---------------------------------------------------------------------------

type ThemeVars = Record<string, string>;

function parseThemeBlocks(source: string): Record<string, ThemeVars> {
  const blocks: Record<string, ThemeVars> = {};
  // Matches ":root, [data-theme='x']" or a bare "[data-theme='x']" (optionally
  // comma-chained with more theme selectors) followed by its declaration body.
  const blockRe =
    /((?:\[data-theme='[\w-]+'\]|:root)(?:\s*,\s*\[data-theme='[\w-]+'\])*)\s*\{([^}]*)\}/g;
  for (const match of source.matchAll(blockRe)) {
    const ids = [...match[1].matchAll(/data-theme='([\w-]+)'/g)].map((m) => m[1]);
    const vars: ThemeVars = {};
    for (const decl of match[2].matchAll(/--([\w-]+):\s*([^;]+);/g)) {
      vars[decl[1]] = decl[2].trim();
    }
    for (const id of ids) blocks[id] = { ...(blocks[id] ?? {}), ...vars };
  }
  return blocks;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.trim().replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const num = parseInt(full, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/** WCAG 2.1 relative luminance of an sRGB color. https://www.w3.org/TR/WCAG21/#dfn-relative-luminance */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [R, G, B] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** WCAG 2.1 contrast ratio between two sRGB hex colors. https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio */
function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexToRgb(hexA));
  const lB = relativeLuminance(hexToRgb(hexB));
  const [lighter, darker] = lA >= lB ? [lA, lB] : [lB, lA];
  return (lighter + 0.05) / (darker + 0.05);
}

// `join(dirname(fileURLToPath(import.meta.url)), ...)` rather than
// `new URL('./themes.css', import.meta.url)`: Vite statically rewrites the
// latter two-argument form into a dev-server asset URL (its "explicit URL
// imports" asset handling), which isn't a file:// URL under Vitest.
const cssPath = join(dirname(fileURLToPath(import.meta.url)), 'themes.css');
const themeBlocks = parseThemeBlocks(readFileSync(cssPath, 'utf-8'));

// Foreground/background pairs actually rendered by src/index.css — see
// specs/w1-themes.md § WCAG AA contrast contract for the call-site inventory.
//
// Every one of --ink/--dim/--primary/--secondary/--accent is used as a real
// text fill somewhere in src/index.css (not merely a border or glow), so
// every pair below is held to the 4.5:1 normal-text floor (WCAG 1.4.3)
// rather than the looser 3:1 non-text/UI-component floor (1.4.11):
// --primary and --accent each drive a border/box-shadow *and* a text fill
// with the identical custom-property value, so the stricter bar is the
// binding constraint for the variable either way. Border/glow-only call
// sites that reuse these same pairs (.btn.primary / .chip.active / .cell.free
// borders, etc.) are covered for free since they share the checked value.
const TEXT_PAIRS: [fg: string, bg: string][] = [
  ['ink', 'bg'], // body text
  ['ink', 'panel'], // .row .name, .input text
  ['ink', 'cell'], // .cell text
  ['dim', 'bg'], // .muted, .count, .ack, inactive .tab
  ['dim', 'panel'], // .row .sub
  ['primary', 'bg'], // .brand b; .bingo-head span (the B-I-N-G-O header — normal text below ~400px viewports)
  ['primary', 'panel'], // .row .rank (leaderboard rank numbers, 22px normal weight)
  ['secondary', 'bg'], // .count b
  ['accent', 'cell'], // .cell.free text ("FREE")
  ['accent', 'panel'], // .badge ("1st BINGO")
];
const TEXT_MIN = 4.5; // WCAG 1.4.3 Contrast (Minimum), normal text

describe('themes.css — WCAG AA contrast (specs/w1-themes.md)', () => {
  it('defines a [data-theme] block for every ThemeId', () => {
    for (const t of THEMES) {
      expect(themeBlocks[t.id], `missing [data-theme='${t.id}'] block in themes.css`).toBeDefined();
    }
  });

  for (const t of THEMES) {
    const vars = themeBlocks[t.id] ?? {};

    for (const [fg, bg] of TEXT_PAIRS) {
      it(`${t.id}: --${fg} on --${bg} meets ${TEXT_MIN}:1`, () => {
        expect(contrastRatio(vars[fg], vars[bg])).toBeGreaterThanOrEqual(TEXT_MIN);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// ThemeContext — persistence, the async-default invariant, and switch latency.
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'gcb.theme';

// This repo's Vitest jsdom project doesn't configure a same-origin `url`, so
// jsdom leaves `window.localStorage` unset (ThemeContext.tsx's try/catch
// around every localStorage call is defensive against exactly this). Install
// a minimal in-memory Storage so the persistence behavior under test is real
// rather than a silently-swallowed no-op; scoped to this file only.
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

function ThemeProbe() {
  const { theme, setTheme } = useTheme();
  return (
    <button type="button" onClick={() => setTheme('seriously-pink')}>
      {theme}
    </button>
  );
}

describe('ThemeContext — persistence and defaults (specs/w1-themes.md)', () => {
  afterEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('defaults to neon-playground and does not auto-persist the default', () => {
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button')).toHaveTextContent('neon-playground');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('applies an explicit pick to <html data-theme> and persists it, well under the 5s PRD budget', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    const startedAt = performance.now();
    await user.click(screen.getByRole('button'));
    const elapsedMs = performance.now() - startedAt;

    expect(screen.getByRole('button')).toHaveTextContent('seriously-pink');
    expect(document.documentElement.dataset.theme).toBe('seriously-pink');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('seriously-pink');
    expect(elapsedMs).toBeLessThan(5000); // PRD: a Theme switch applies in <5s.
  });

  it('adopts an async-arriving event/player default when the user has not chosen', () => {
    const { rerender } = render(
      <ThemeProvider defaultTheme="neon-playground">
        <ThemeProbe />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button')).toHaveTextContent('neon-playground');

    // Simulate the Firestore-sourced event/player default resolving after mount.
    rerender(
      <ThemeProvider defaultTheme="get-sporty">
        <ThemeProbe />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button')).toHaveTextContent('get-sporty');
  });

  it('never lets an async-arriving default override an explicit user pick', () => {
    window.localStorage.setItem(STORAGE_KEY, 'seriously-pink');
    const { rerender } = render(
      <ThemeProvider defaultTheme="neon-playground">
        <ThemeProbe />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button')).toHaveTextContent('seriously-pink');

    rerender(
      <ThemeProvider defaultTheme="get-sporty">
        <ThemeProbe />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button')).toHaveTextContent('seriously-pink');
  });
});

describe('Theme metadata (specs/w1-themes.md)', () => {
  it('keeps Neon Playground as the first/default Theme', () => {
    expect(THEMES[0]?.id).toBe('neon-playground');
  });

  it('carries no Atlantis mark, trademark, or affiliation text (PRD non-goal)', () => {
    const bannedPatterns = [/atlantis/i, /[®™]/];
    for (const t of THEMES) {
      for (const pattern of bannedPatterns) {
        expect(t.label, `Theme "${t.id}" label leaks a mark: "${t.label}"`).not.toMatch(pattern);
      }
    }
  });
});
