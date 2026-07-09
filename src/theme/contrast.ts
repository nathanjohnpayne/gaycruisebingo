// WCAG 2.1 contrast-ratio utilities shared by the theme test suites
// (src/theme/w1-themes.test.tsx, src/theme/theme-on-color-contrast.test.tsx)
// so both suites compute contrast the same way and can never drift out of
// sync with each other's math. Originally lived only in w1-themes.test.tsx
// (PR #63); extracted here by issue #72 (specs/theme-on-color-contrast.md)
// when a second suite needed the same math.

export type ThemeVars = Record<string, string>;

/**
 * Parses `[data-theme='<id>']` blocks (and the `:root, [data-theme='x']`
 * default block) straight out of a themes.css source string into a map of
 * ThemeId -> custom-property values. Used so contrast tests can never
 * hand-transcribe a color and drift out of sync with the CSS they police.
 */
export function parseThemeBlocks(source: string): Record<string, ThemeVars> {
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

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.trim().replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const num = parseInt(full, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/** WCAG 2.1 relative luminance of an sRGB color. https://www.w3.org/TR/WCAG21/#dfn-relative-luminance */
export function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [R, G, B] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** WCAG 2.1 contrast ratio between two sRGB hex colors. https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio */
export function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexToRgb(hexA));
  const lB = relativeLuminance(hexToRgb(hexB));
  const [lighter, darker] = lA >= lB ? [lA, lB] : [lB, lA];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Mixes two sRGB hex colors in the sRGB (gamma-encoded) space at `weightA`
 * for `hexA` — the same math `color-mix(in srgb, hexA <weightA*100>%,
 * hexB)` performs, and specifically what `color-mix(in srgb, var(--x) N%,
 * transparent)` painted directly over an opaque `hexB` base composites to
 * (mixing toward `transparent` scales alpha only, so compositing that layer
 * "over" an opaque base is equivalent to mixing straight toward the base
 * color at the same weight). Used to check text-safe-color choices against
 * a `color-mix(...)` tint layered over a flat token, e.g. `.celebrate`'s
 * backdrop or `body`'s gradient-tinted background (src/index.css).
 */
export function mixSrgb(hexA: string, hexB: string, weightA: number): string {
  const [r1, g1, b1] = hexToRgb(hexA);
  const [r2, g2, b2] = hexToRgb(hexB);
  const mix = (a: number, b: number) => Math.round(a * weightA + b * (1 - weightA));
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(mix(r1, r2))}${toHex(mix(g1, g2))}${toHex(mix(b1, b2))}`;
}
