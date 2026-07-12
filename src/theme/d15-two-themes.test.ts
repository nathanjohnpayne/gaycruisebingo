import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { THEMES } from './themes';
import { contrastRatio, hexToRgb, parseThemeBlocks } from './contrast';

// Covers specs/d15-two-themes.md: the two Phase 1.5 tutorial-Day Themes
// (welcome-aboard / so-long-farewell) as THEMES entries + themes.css token
// blocks. w1-themes.test.tsx and a11y-badge-contrast.test.tsx already cover
// these two Themes for free (they iterate THEMES / parse themes.css at test
// time), but this spec's own contrast claim gets a direct assertion here
// too, independent of that auto-pickup.

const cssPath = join(dirname(fileURLToPath(import.meta.url)), 'themes.css');
const themeBlocks = parseThemeBlocks(readFileSync(cssPath, 'utf-8'));

const EXPECTED = {
  'welcome-aboard': {
    label: 'Welcome Aboard',
    description: 'You made it. Learn the game, find the soft-serve, wave goodbye to land.',
    vars: {
      bg: '#051019',
      panel: '#0a1a28',
      ink: '#eaf6ff',
      dim: '#9fbcd0',
      primary: '#33c6ff',
      secondary: '#ffbe5c',
      accent: '#ffd23f',
      cell: '#0a1a28',
    },
  },
  'so-long-farewell': {
    label: 'So Long, Farewell',
    description: 'Last one. Mark your goodbyes—then go book next year.',
    vars: {
      bg: '#140b12',
      panel: '#1e1019',
      ink: '#fff0ea',
      dim: '#d0a8ab',
      primary: '#ff8b6a',
      secondary: '#feb47b',
      accent: '#ffd23f',
      cell: '#1e1019',
    },
  },
} as const;

// Same pairs/floor as w1-themes.test.tsx's TEXT_PAIRS, kept in sync there —
// duplicated here (rather than imported) so this spec's assertion doesn't
// silently go stale if that suite's pair list narrows.
const TEXT_PAIRS: [fg: string, bg: string][] = [
  ['ink', 'bg'],
  ['ink', 'panel'],
  ['ink', 'cell'],
  ['dim', 'bg'],
  ['dim', 'panel'],
  ['primary', 'panel'],
  ['accent', 'cell'],
  ['accent', 'panel'],
];
const TEXT_MIN = 4.5;

describe('THEMES — welcome-aboard / so-long-farewell entries (specs/d15-two-themes.md)', () => {
  it('keeps neon-playground first/default and appends the two new Themes at the end', () => {
    expect(THEMES[0]?.id).toBe('neon-playground');
    expect(THEMES[THEMES.length - 2]?.id).toBe('welcome-aboard');
    expect(THEMES[THEMES.length - 1]?.id).toBe('so-long-farewell');
  });

  for (const [id, expected] of Object.entries(EXPECTED)) {
    describe(id, () => {
      const theme = THEMES.find((t) => t.id === id);

      it('has the exact label and description from the spec', () => {
        expect(theme).toBeDefined();
        expect(theme?.label).toBe(expected.label);
        expect(theme?.description).toBe(expected.description);
      });

      it('has a matching [data-theme] block in themes.css with the spec palette', () => {
        const vars = themeBlocks[id];
        expect(vars, `missing [data-theme='${id}'] block in themes.css`).toBeDefined();
        for (const [key, value] of Object.entries(expected.vars)) {
          expect(vars?.[key]).toBe(value);
        }
      });

      for (const [fg, bg] of TEXT_PAIRS) {
        it(`--${fg} on --${bg} meets ${TEXT_MIN}:1`, () => {
          const vars = themeBlocks[id] ?? {};
          expect(contrastRatio(hexToRgb(vars[fg]), hexToRgb(vars[bg]))).toBeGreaterThanOrEqual(
            TEXT_MIN,
          );
        });
      }
    });
  }
});
