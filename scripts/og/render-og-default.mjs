// Renders scripts/og/og-default.html -> public/og-default.png (2400x1260).
//
// The design source next to this script is the committed original of the
// bare-URL unfurl image (ADR 0005; v1 PR #337, v2 issue #338). Rendering is
// manual and local — the PNG is a committed asset, not a build artifact —
// so this script is not wired into `npm run build` or CI.
//
// Usage:
//   node scripts/og/render-og-default.mjs
//
// Requirements:
//   - dev deps installed (`npm install`; uses the repo's playwright)
//   - Playwright's chromium downloaded (`npx playwright install chromium`)
//   - network at render time (the template pulls Oswald/Bebas Neue from
//     Google Fonts; emoji come from the host OS, so render on macOS to keep
//     the Apple emoji set the shipped asset uses)
//   - pngquant on PATH (optional but expected: crushes ~1.6 MB to well under
//     WhatsApp's 600 KB og:image cap; the script warns and keeps the
//     lossless PNG if pngquant is missing)
import { execFileSync } from 'node:child_process';
import { existsSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const template = join(here, 'og-default.html');
const out = join(here, '..', '..', 'public', 'og-default.png');

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 2400, height: 1260 },
    deviceScaleFactor: 1,
  });
  // `load` + FontFaceSet.ready gates on what actually matters (the Google
  // Fonts faces being applied) without the flakiness of `networkidle` on a
  // slow network; the generous timeout rides out slow font CDN responses.
  await page.goto(pathToFileURL(template).href, { waitUntil: 'load', timeout: 120_000 });
  await page.evaluate(() => document.fonts.ready);
  const faces = await page.evaluate(() =>
    ['Anton', 'Oswald', 'Bebas Neue'].filter((f) => !document.fonts.check(`24px "${f}"`)),
  );
  if (faces.length > 0) {
    throw new Error(`web fonts failed to load: ${faces.join(', ')} — check network and retry`);
  }
  await page.screenshot({ path: out });
} finally {
  await browser.close();
}

const rawBytes = statSync(out).size;

// pngquant in place (same treatment as the shipped v1: --quality floor keeps
// the radial glows band-free). --force because the output exists; --strip
// drops ancillary chunks messengers ignore.
let quantized = false;
try {
  execFileSync('pngquant', ['--quality=75-95', '--speed', '1', '--strip', '--force', '--output', `${out}.quant`, out], { stdio: 'inherit' });
  quantized = true;
} catch {
  console.warn('pngquant not available (or quality floor not reachable); keeping the lossless render.');
}
if (quantized && existsSync(`${out}.quant`)) {
  renameSync(`${out}.quant`, out);
}

const finalBytes = statSync(out).size;
console.log(`rendered ${out}`);
console.log(`  lossless: ${(rawBytes / 1024).toFixed(0)} KB -> shipped: ${(finalBytes / 1024).toFixed(0)} KB`);
if (finalBytes > 600 * 1024) {
  console.warn('  WARNING: over WhatsApp\'s 600 KB og:image cap — tighten the design or quality range.');
}
