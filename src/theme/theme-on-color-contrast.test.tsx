import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { THEMES } from './themes';
import { contrastRatio, hexToRgb, mixSrgb, parseThemeBlocks } from './contrast';

// Covers specs/theme-on-color-contrast.md (issue #72): the hardcoded-#fff
// text/border fills in src/index.css that never adapted to [data-theme]
// (Scope A), and the primary/secondary text sitting directly on
// gradient-tinted backdrops that specs/w1-themes.md's "Known bound"
// carve-out deliberately didn't check (Scope B). Reuses the contrast math
// from ./contrast.ts (shared with src/theme/w1-themes.test.tsx) so both
// suites can never drift apart on how they compute a contrast ratio.

const themeDir = dirname(fileURLToPath(import.meta.url));
// See w1-themes.test.tsx for why this join(dirname(...), ...) form is used
// over `new URL(..., import.meta.url)` (Vite rewrites the latter under Vite,
// which isn't a file:// URL under Vitest).
const themeBlocks = parseThemeBlocks(readFileSync(join(themeDir, 'themes.css'), 'utf-8'));
const indexCss = readFileSync(join(themeDir, '..', 'index.css'), 'utf-8');

const TEXT_MIN = 4.5; // WCAG 1.4.3 Contrast (Minimum), normal text
const UI_MIN = 3.0; // WCAG 1.4.11 Non-text Contrast, graphical objects / UI component boundaries

// ---------------------------------------------------------------------------
// Scope A pin: no target rule regressed back to a literal #fff text/border
// fill. Parses the rule block straight out of index.css (not a hand-copied
// snippet) so this can't drift from the file it polices. Decorative
// text-shadow glows are stripped before the check — a glow layered around a
// fill is not the fill itself and does not count toward contrast (the same
// treatment index.css's own comments give .signin h1 / .celebrate .big's
// glows).
// ---------------------------------------------------------------------------

function ruleBlock(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`rule not found in src/index.css: ${selector}`);
  return match[1];
}

function stripDecorativeGlow(block: string): string {
  // Strip CSS comments first — this file's own /* ... */ comments document
  // the old #fff value by name (see the edits above), which would otherwise
  // false-positive this check. Then strip text-shadow declarations — a glow
  // layered around a fill is not the fill itself and does not count toward
  // contrast.
  return block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/text-shadow:[^;]*;/g, '');
}

const FIXED_RULES = [
  '.cell.marked',
  '.cell.marked::after',
  '.celebrate .big',
  '.signin h1',
  '.share-card-cell.marked', // bonus fix: same hardcoded-#fff pattern as .cell.marked, same file
];

describe('src/index.css — no hardcoded #fff text/border fill (specs/theme-on-color-contrast.md)', () => {
  for (const selector of FIXED_RULES) {
    it(`${selector} does not fill color/border-color with a literal #fff`, () => {
      const fillOnly = stripDecorativeGlow(ruleBlock(indexCss, selector));
      expect(fillOnly.toLowerCase()).not.toMatch(/#fff\b/);
    });
  }

  it('documents the pre-fix regression: literal #fff on summer-white --bg fails WCAG AA', () => {
    // Historical value from issue #72's own audit — the worst contrast
    // failure in the app before this fix (.signin h1 / .cell.marked border
    // both painted #fff directly against summer-white's light --bg).
    const bg = themeBlocks['summer-white']?.bg;
    expect(bg).toBeDefined();
    expect(contrastRatio(hexToRgb('#ffffff'), hexToRgb(bg!))).toBeLessThan(1.2);
    expect(contrastRatio(hexToRgb('#ffffff'), hexToRgb(bg!))).toBeLessThan(TEXT_MIN);
  });
});

// ---------------------------------------------------------------------------
// Scope A: --on-gradient (src/theme/themes.css) against BOTH endpoints of
// the `.cell.marked` / `.share-card-cell.marked` gradient
// (linear-gradient(var(--primary), var(--secondary))) — position-independent
// and therefore a stricter bound than sampling any single point on the
// gradient. The ✓ glyph and the border are graphical/UI-component objects
// (WCAG 1.4.11, 3:1 floor) but --on-gradient clears the stricter 4.5:1 text
// floor everywhere, so one assertion covers both floors for both call sites.
// ---------------------------------------------------------------------------

describe('--on-gradient vs both .cell.marked gradient endpoints (specs/theme-on-color-contrast.md)', () => {
  it('every ThemeId defines --on-gradient', () => {
    for (const t of THEMES) {
      expect(themeBlocks[t.id]?.['on-gradient'], `missing --on-gradient for ${t.id}`).toBeDefined();
    }
  });

  for (const t of THEMES) {
    const vars = themeBlocks[t.id] ?? {};
    it(`${t.id}: --on-gradient meets ${TEXT_MIN}:1 against --primary`, () => {
      expect(contrastRatio(hexToRgb(vars['on-gradient']), hexToRgb(vars.primary))).toBeGreaterThanOrEqual(TEXT_MIN);
    });
    it(`${t.id}: --on-gradient meets ${TEXT_MIN}:1 against --secondary`, () => {
      expect(contrastRatio(hexToRgb(vars['on-gradient']), hexToRgb(vars.secondary))).toBeGreaterThanOrEqual(TEXT_MIN);
    });
  }
});

// ---------------------------------------------------------------------------
// Scope A: the `.cell.marked` / `.share-card-cell.marked` border stays on
// --ink, not --on-gradient — its job is to read against the page background
// surrounding the cell (--bg), not the gradient fill it encloses. --ink vs
// --bg is already asserted >=4.5:1 in w1-themes.test.tsx's TEXT_PAIRS; this
// suite re-asserts it explicitly (at the looser 3:1 UI-component floor this
// call site actually needs) so the border fix this spec documents is pinned
// here too, not just inherited implicitly from the other suite.
// ---------------------------------------------------------------------------

describe('--ink vs --bg for the .cell.marked border (specs/theme-on-color-contrast.md)', () => {
  for (const t of THEMES) {
    const vars = themeBlocks[t.id] ?? {};
    it(`${t.id}: --ink meets the ${UI_MIN}:1 UI-component floor against --bg`, () => {
      expect(contrastRatio(hexToRgb(vars.ink), hexToRgb(vars.bg))).toBeGreaterThanOrEqual(UI_MIN);
    });
  }
});

// ---------------------------------------------------------------------------
// .celebrate .big: --ink against the composited celebrate backdrop —
// color-mix(in srgb, var(--primary) 34%, transparent) painted over the
// opaque --bg base (index.css's radial-gradient hits its hottest, most
// primary-saturated point at the gradient's center, where `.big` renders).
// mixSrgb reproduces that composite: mixing toward "transparent" only
// scales alpha, so compositing a 34%-alpha primary layer over an opaque bg
// is equivalent to mixing straight toward bg at the same weight.
// ---------------------------------------------------------------------------

describe('.celebrate .big: --ink vs the composited celebrate backdrop (specs/theme-on-color-contrast.md)', () => {
  for (const t of THEMES) {
    const vars = themeBlocks[t.id] ?? {};
    it(`${t.id}: --ink meets ${TEXT_MIN}:1 against the 34% --primary tint over --bg`, () => {
      const composite = mixSrgb(hexToRgb(vars.primary), hexToRgb(vars.bg), 0.34);
      expect(contrastRatio(hexToRgb(vars.ink), composite)).toBeGreaterThanOrEqual(TEXT_MIN);
    });
  }
});

// ---------------------------------------------------------------------------
// .signin h1: no ancestor background between it and body (see App.tsx /
// SignIn.tsx), so this is the plain --ink/--bg pair — restated explicitly
// here (rather than only inherited from w1-themes.test.tsx) since it is one
// of this spec's four target rules.
// ---------------------------------------------------------------------------

describe('.signin h1: --ink vs --bg (specs/theme-on-color-contrast.md)', () => {
  for (const t of THEMES) {
    const vars = themeBlocks[t.id] ?? {};
    it(`${t.id}: --ink meets ${TEXT_MIN}:1 against --bg`, () => {
      expect(contrastRatio(hexToRgb(vars.ink), hexToRgb(vars.bg))).toBeGreaterThanOrEqual(TEXT_MIN);
    });
  }
});

// ---------------------------------------------------------------------------
// Scope B (retires w1-themes.md's former "Known bound: gradient-tinted
// backdrops are not checked"): `body`'s background (index.css) layers two
// radial-gradient tints over --bg — up to 32% --primary near the top-left,
// up to 26% --secondary near the top-right. .brand b / .bingo-head span (the
// B-I-N-G-O header) and .count b used to fill text with --primary/
// --secondary directly, a self-referential trap (the same token tints the
// backdrop *and* is the text sitting on it) that already dropped under
// 4.5:1 in 6 of the 8 themes at the gradient's actual max strength. All
// three now use --ink instead, checked here against the composited tint at
// its hottest (highest-alpha) point — a stricter, position-independent
// bound than any single on-screen sample, since every less-tinted point on
// the same gradient is closer to the already-covered flat---bg case.
// ---------------------------------------------------------------------------

describe('body gradient tints: --ink vs the composited backdrop (specs/theme-on-color-contrast.md)', () => {
  for (const t of THEMES) {
    const vars = themeBlocks[t.id] ?? {};
    it(`${t.id}: --ink meets ${TEXT_MIN}:1 against the 32% --primary tint over --bg (.brand b, .bingo-head span)`, () => {
      const composite = mixSrgb(hexToRgb(vars.primary), hexToRgb(vars.bg), 0.32);
      expect(contrastRatio(hexToRgb(vars.ink), composite)).toBeGreaterThanOrEqual(TEXT_MIN);
    });
    it(`${t.id}: --ink meets ${TEXT_MIN}:1 against the 26% --secondary tint over --bg (.count b)`, () => {
      const composite = mixSrgb(hexToRgb(vars.secondary), hexToRgb(vars.bg), 0.26);
      expect(contrastRatio(hexToRgb(vars.ink), composite)).toBeGreaterThanOrEqual(TEXT_MIN);
    });
  }

  it('documents the pre-fix regression: the old --primary/--secondary self-fill already failed 4.5:1 in most themes', () => {
    // Historical values (issue #72's own audit, verified independently here):
    // before this fix, .brand b / .bingo-head span filled with --primary
    // directly, and that same --primary tints the backdrop it sits on — a
    // self-referential pairing that already dropped under 4.5:1 well before
    // the gradient's actual 32% max in most themes. Pinned for
    // neon-playground (a mid-saturation theme, not just the summer-white
    // extreme this issue's table led with) so a future revert is caught.
    const vars = themeBlocks['neon-playground']!;
    const oldComposite = mixSrgb(hexToRgb(vars.primary), hexToRgb(vars.bg), 0.32);
    expect(contrastRatio(hexToRgb(vars.primary), oldComposite)).toBeLessThan(TEXT_MIN);
  });
});

// ---------------------------------------------------------------------------
// Bonus fix (same defect class, same file): .share-card-bhead span mirrors
// .bingo-head span inside the off-screen Share Card renderer
// (src/components/ShareCard.tsx) — its own background layers a 30%
// --primary / 24% --secondary radial-gradient tint over --bg, the same
// self-referential trap as body's.
// ---------------------------------------------------------------------------

describe('share-card gradient tints: --ink vs the composited backdrop (specs/theme-on-color-contrast.md)', () => {
  for (const t of THEMES) {
    const vars = themeBlocks[t.id] ?? {};
    it(`${t.id}: --ink meets ${TEXT_MIN}:1 against the 30% --primary tint over --bg (.share-card-bhead span)`, () => {
      const composite = mixSrgb(hexToRgb(vars.primary), hexToRgb(vars.bg), 0.3);
      expect(contrastRatio(hexToRgb(vars.ink), composite)).toBeGreaterThanOrEqual(TEXT_MIN);
    });
  }
});
