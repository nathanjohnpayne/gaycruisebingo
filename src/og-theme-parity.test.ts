import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Guard for issue #71, not an app unit test: it asserts on the *contents* of
// cloud-run/og-renderer/src/template.ts against the canonical
// src/theme/themes.css. The OG renderer hand-duplicates the theme palettes
// because its Cloud Run build context is cloud-run/og-renderer only (the
// Dockerfile copies just src/), so the container can never read the app's
// CSS at build or run time — parity has to be pinned from the outside. It
// lives under src/ so the mandated `npm test` run (vitest,
// `include: ['src/**/*.test.{ts,tsx}']`) actually executes it in app-ci.
// Scaffold-lifetime guard: #39 deletes the OG renderer, this file, and
// specs/og-theme-parity.md together.
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url).href), 'utf8');

const themesCss = read('./theme/themes.css');
const templateTs = read('../cloud-run/og-renderer/src/template.ts');

const SHARED_KEYS = ['bg', 'ink', 'primary', 'secondary', 'accent'] as const;
type PaletteKey = (typeof SHARED_KEYS)[number];
type Palette = Record<PaletteKey, string>;

// themes.css: one `[data-theme='<name>'] { --key: value; ... }` block per
// theme (the first block also carries `:root,`). Only the five keys the OG
// template mirrors are extracted; --panel/--dim/etc. are app-only.
function parseCssThemes(css: string): Record<string, Palette> {
  const out: Record<string, Palette> = {};
  for (const block of css.matchAll(/\[data-theme='([^']+)'\]\s*\{([^}]*)\}/g)) {
    const props = {} as Palette;
    for (const prop of block[2].matchAll(/--(bg|ink|primary|secondary|accent):\s*([^;]+);/g)) {
      props[prop[1] as PaletteKey] = prop[2].trim().toLowerCase();
    }
    out[block[1]] = props;
  }
  return out;
}

// template.ts: the `const THEMES: Record<string, Palette> = { ... };` literal,
// with quoted ('summer-white') and bare (glamiators) keys.
function parseTemplateThemes(src: string): Record<string, Palette> {
  const block = src.match(/const THEMES[^=]*=\s*\{([\s\S]*?)\n\};/);
  if (!block) return {};
  const out: Record<string, Palette> = {};
  for (const entry of block[1].matchAll(/(?:'([^']+)'|([A-Za-z][\w-]*)):\s*\{([^}]*)\}/g)) {
    const props = {} as Palette;
    for (const prop of entry[3].matchAll(/(bg|ink|primary|secondary|accent):\s*'([^']+)'/g)) {
      props[prop[1] as PaletteKey] = prop[2].toLowerCase();
    }
    out[entry[1] ?? entry[2]] = props;
  }
  return out;
}

describe('og-renderer palette parity with themes.css (issue #71)', () => {
  it('defines exactly the same theme set in both sources', () => {
    const cssThemes = parseCssThemes(themesCss);
    const templateThemes = parseTemplateThemes(templateTs);
    expect(Object.keys(cssThemes).length).toBeGreaterThan(0);
    expect(Object.keys(templateThemes).sort()).toEqual(Object.keys(cssThemes).sort());
  });

  it('matches themes.css on every shared palette key for every theme', () => {
    const cssThemes = parseCssThemes(themesCss);
    const templateThemes = parseTemplateThemes(templateTs);
    for (const [name, cssPalette] of Object.entries(cssThemes)) {
      for (const key of SHARED_KEYS) {
        expect(cssPalette[key], `themes.css ${name} --${key} missing`).toMatch(/^#[0-9a-f]{6}$/);
        expect(
          templateThemes[name]?.[key],
          `template.ts ${name}.${key} drifted from themes.css --${key}`
        ).toBe(cssPalette[key]);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// .title contrast: the OG headline fill must clear WCAG AA 4.5:1 over the
// composed body background in every theme. The background model below is
// derived from the template source itself (canvas size, both radial-gradient
// tints, their alphas and fade stops), so palette, tint, or geometry edits
// re-audit automatically instead of silently invalidating the guard.
// ---------------------------------------------------------------------------

type Gradient = { cx: number; cy: number; rx: number; ry: number; alpha: number; fadeEnd: number };

function parseGradient(src: string, channel: 'primary' | 'secondary', w: number, h: number): Gradient {
  const re = new RegExp(
    String.raw`radial-gradient\((\d+)% (\d+)% at (-?\d+)% (-?\d+)%, \$\{p\.${channel}\}([0-9a-fA-F]{2}), transparent (\d+)%\)`
  );
  const m = src.match(re);
  expect(m, `body ${channel} radial-gradient not parseable in template.ts`).not.toBeNull();
  return {
    rx: (Number(m![1]) / 100) * w,
    ry: (Number(m![2]) / 100) * h,
    cx: (Number(m![3]) / 100) * w,
    cy: (Number(m![4]) / 100) * h,
    alpha: parseInt(m![5], 16) / 255,
    fadeEnd: Number(m![6]) / 100,
  };
}

const hexToRgb = (hex: string): number[] =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

const luminance = ([r, g, b]: number[]): number => {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

const contrast = (a: number[], b: number[]): number => {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

const over = (top: number[], alpha: number, under: number[]): number[] =>
  under.map((u, i) => alpha * top[i] + (1 - alpha) * u);

// CSS radial-gradient(<rx> <ry> at <cx> <cy>, C<aa>, transparent <stop>%):
// alpha fades linearly from aa at the center to 0 at <stop> of the ellipse
// ray (premultiplied interpolation keeps the hue constant while alpha fades).
const tintAlpha = (g: Gradient, x: number, y: number): number => {
  const t = Math.sqrt(((x - g.cx) / g.rx) ** 2 + ((y - g.cy) / g.ry) ** 2);
  return t >= g.fadeEnd ? 0 : g.alpha * (1 - t / g.fadeEnd);
};

describe('og-renderer .title contrast over the composed background (issue #71)', () => {
  it('fills .title with the theme ink, not hardcoded white', () => {
    // Hardcoded #fff measured 1.13:1 on summer-white (light bg) — the fill
    // must follow the theme like .badge/.sub/.foot already do.
    expect(templateTs).toMatch(/\.title\{[^}]*color:\$\{p\.ink\}/);
  });

  it('clears WCAG AA 4.5:1 worst-case in every theme for the .title fill', () => {
    const canvas = templateTs.match(/width:(\d+)px;height:(\d+)px/);
    expect(canvas, 'canvas size not found in template.ts').not.toBeNull();
    const w = Number(canvas![1]);
    const h = Number(canvas![2]);
    const primaryTint = parseGradient(templateTs, 'primary', w, h);
    const secondaryTint = parseGradient(templateTs, 'secondary', w, h);
    const cssThemes = parseCssThemes(themesCss);
    expect(Object.keys(cssThemes).length).toBeGreaterThan(0);
    for (const [name, p] of Object.entries(cssThemes)) {
      const ink = hexToRgb(p.ink);
      let worst = Infinity;
      // Sample the full canvas — stricter than the title box, and cheap.
      for (let x = 0; x <= w; x += 5) {
        for (let y = 0; y <= h; y += 5) {
          let c = hexToRgb(p.bg);
          c = over(hexToRgb(p.secondary), tintAlpha(secondaryTint, x, y), c);
          c = over(hexToRgb(p.primary), tintAlpha(primaryTint, x, y), c);
          worst = Math.min(worst, contrast(ink, c));
        }
      }
      expect(worst, `${name}: .title ink over composed bg below AA`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
