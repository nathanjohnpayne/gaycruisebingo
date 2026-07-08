---
spec_id: og-theme-parity
status: accepted
---

# OG renderer: palette parity with `themes.css` + `.title` contrast (`cloud-run/og-renderer/src/template.ts`)

The Cloud Run OG renderer hand-maintains a second copy of the 8 Atlantis theme palettes in `template.ts`, separate from the canonical `src/theme/themes.css`, because its Docker build context is `cloud-run/og-renderer` alone (the Dockerfile copies only `src/`) — the container can never import the app's CSS at build or run time, so a shared source is structurally unavailable without a codegen step that issue #39 (which deletes the whole service, ADR 0005) would make pointless. The duplication had already drifted (`glamiators` accent `#ffffff` vs canonical `#fffefb`), and PR #63 deepening `summer-white` `--primary`/`--secondary` mid-flight demonstrated the recurring class — that PR had to carry its own og-renderer resync by hand because no guard existed. This spec pins the duplication from the outside with a guard test in the app suite (`src/og-theme-parity.test.ts`, runs under `npm test` in app-ci), and fixes the one real contrast failure the audit found: the `.title` headline was filled with hardcoded `#fff`, which measures ~1.13:1 against the `summer-white` light background — far under WCAG AA 4.5:1 on the public social preview image. The fill now follows the theme ink, the pattern `.badge`/`.sub`/`.foot` already use. Everything here is scaffold-lifetime: #39 deletes the OG renderer, the guard test, and this spec together, and until then any palette or tint edit re-runs the audit automatically because the guard derives its background model (canvas size, gradient geometry, tint alphas) from the template source itself.

## The two palette sources cannot drift silently

`npm test` fails if the OG template's `THEMES` record and `themes.css` disagree on the theme set or on any shared key, in either direction. This is what forces any later theme change to carry the one-line og-renderer resync inside the same change, instead of relying on someone remembering (as PR #63 had to).

- **Given** the canonical `src/theme/themes.css` and the duplicated `THEMES` in `template.ts` **when** either adds, removes, or renames a theme **then** the guard fails on the set difference. (Test: "defines exactly the same theme set in both sources".)
- **Given** the five shared keys (`bg`/`ink`/`primary`/`secondary`/`accent`) **when** any hex value differs between the two sources for any theme **then** the guard names the drifted theme and key. The `glamiators` accent is resynced to `#fffefb` by this change; `summer-white` matches the deepened values PR #63 merged (`#8f600d`/`#8a5c12`, carried into the template by that PR). (Test: "matches themes.css on every shared palette key for every theme".)

## The `.title` fill is theme-driven and clears WCAG AA in every theme

The audit modeled the body background exactly as the template composes it — `bg` under two corner radial-gradient tints (`primary` at 0x55 alpha, `secondary` at 0x44, both fading to transparent at the 60% stop) — and sampled the worst-case contrast across the full 1200x630 canvas. Hardcoded `#fff` fails only on `summer-white` (1.13:1; the 7 dark themes measure 8.5–14.0:1). With the theme ink as fill, every theme clears AA with margin (8.25–12.3:1 worst-case anywhere on canvas; 15.3:1+ inside the title band). The two tint ellipses never overlap, so tint alpha is not the binding factor and the palettes stay untouched. The `text-shadow` halo (`0 0 8px #fff` plus the primary glows) is deliberately kept: it is not the fill, and on `summer-white` a light halo around dark ink aids separation from the golden tints.

- **Given** the `.title` rule in `template.ts` **when** its declarations are read **then** the fill is `color:${p.ink}`, not a hardcoded white. (Test: "fills .title with the theme ink, not hardcoded white".)
- **Given** the composed background model derived from the template source **when** the worst-case ink-over-composite ratio is computed per theme **then** all 8 themes clear 4.5:1. (Test: "clears WCAG AA 4.5:1 worst-case in every theme for the .title fill".)
