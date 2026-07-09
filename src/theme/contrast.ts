/* WCAG 2.1 contrast + sRGB compositing helpers, plus a themes.css token-block
 * parser. Extracted here so every contrast check in the suite computes from one
 * implementation instead of hand-transcribing a color table:
 *   - src/theme/w1-themes.test.tsx
 *   - src/theme/a11y-badge-contrast.test.tsx
 *   - src/theme/theme-on-color-contrast.test.tsx
 * See specs/w1-themes.md, specs/a11y-badge-contrast.md, and
 * specs/theme-on-color-contrast.md. */

export type Rgb = [r: number, g: number, b: number];
export type ThemeVars = Record<string, string>;

/** Parse `#rgb` / `#rrggbb` (ignoring any leading `#` and surrounding space). */
export function hexToRgb(hex: string): Rgb {
  const h = hex.trim().replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const num = parseInt(full, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/** WCAG 2.1 relative luminance of an sRGB color. https://www.w3.org/TR/WCAG21/#dfn-relative-luminance */
export function relativeLuminance([r, g, b]: Rgb): number {
  const [R, G, B] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** WCAG 2.1 contrast ratio between two opaque sRGB colors. https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const lA = relativeLuminance(a);
  const lB = relativeLuminance(b);
  const [lighter, darker] = lA >= lB ? [lA, lB] : [lB, lA];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * CSS `color-mix(in srgb, a <aWeight*100>%, b)` for two OPAQUE colors: a
 * per-channel linear blend in gamma-encoded sRGB (the space `in srgb` mixes in),
 * rounded to 8-bit. `aWeight` is a's fraction in [0,1]; b takes the rest.
 */
export function mixSrgb(a: Rgb, b: Rgb, aWeight: number): Rgb {
  return [0, 1, 2].map((i) => Math.round(a[i] * aWeight + b[i] * (1 - aWeight))) as Rgb;
}

/**
 * Source-over compositing of a translucent `fg` at `alpha` painted onto an
 * OPAQUE `bg` — the composited color a `rgba(fg, alpha)` fill shows over `bg`.
 * Identical blend math to {@link mixSrgb} with the alpha as fg's weight; named
 * separately so call sites read as "this scrim over that backdrop".
 */
export function alphaCompositeOver(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return mixSrgb(fg, bg, alpha);
}

/**
 * Parse `:root, [data-theme='x']` (and bare / comma-chained `[data-theme='x']`)
 * blocks out of a CSS source into `{ themeId: { varName: value } }`. Lets a test
 * read the real token values straight from themes.css so it can never drift from
 * the CSS it polices.
 */
export function parseThemeBlocks(source: string): Record<string, ThemeVars> {
  const blocks: Record<string, ThemeVars> = {};
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
