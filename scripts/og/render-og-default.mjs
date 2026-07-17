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

// The design template pulls Anton/Bebas Neue/Oswald from Google Fonts at
// render time (og-default.html's <link>). Every family+weight pair the
// design actually uses (grep the template's `font-weight` declarations)
// is asserted below so a blocked or degraded font load fails the render
// instead of silently shipping a system-font-fallback PNG (#380, a Codex
// P2 follow-up on #379 — this exact line used to check only the default
// weight of each family, and only via document.fonts, with no check that
// the stylesheet request itself succeeded).
const GOOGLE_FONTS_CSS_PATTERN = /^https:\/\/fonts\.googleapis\.com\/css2\?/;
const EXPECTED_FACES = [
  { family: 'Anton', weight: 400 },
  { family: 'Bebas Neue', weight: 400 },
  { family: 'Oswald', weight: 300 },
  { family: 'Oswald', weight: 400 },
  { family: 'Oswald', weight: 500 },
  { family: 'Oswald', weight: 600 },
  { family: 'Oswald', weight: 700 },
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 2400, height: 1260 },
    deviceScaleFactor: 1,
  });

  // Track the Google Fonts stylesheet request directly: document.fonts
  // checks alone can't distinguish "the stylesheet 404'd" from "the
  // stylesheet loaded but a font file 404'd" from "everything worked",
  // and on a flaky network the clearer signal makes the failure
  // actionable instead of just "some fonts are missing".
  let stylesheetResponse = null;
  let stylesheetRequestFailure = null;
  page.on('response', (response) => {
    if (GOOGLE_FONTS_CSS_PATTERN.test(response.url())) {
      stylesheetResponse = response;
    }
  });
  page.on('requestfailed', (request) => {
    if (GOOGLE_FONTS_CSS_PATTERN.test(request.url())) {
      stylesheetRequestFailure = request.failure()?.errorText ?? 'unknown error';
    }
  });

  // `load` + FontFaceSet.ready gates on what actually matters (the Google
  // Fonts faces being applied) without the flakiness of `networkidle` on a
  // slow network; the generous timeout rides out slow font CDN responses.
  await page.goto(pathToFileURL(template).href, { waitUntil: 'load', timeout: 120_000 });
  await page.evaluate(() => document.fonts.ready);

  const problems = [];
  if (!stylesheetResponse) {
    problems.push(
      `Google Fonts stylesheet request never completed (${stylesheetRequestFailure ?? 'network unreachable or blocked before a response arrived'})`,
    );
  } else if (!stylesheetResponse.ok()) {
    problems.push(`Google Fonts stylesheet request returned HTTP ${stylesheetResponse.status()} (${stylesheetResponse.url()})`);
  }

  const missingFaces = await page.evaluate(
    (faces) => faces.filter(({ family, weight }) => !document.fonts.check(`${weight} 24px "${family}"`)),
    EXPECTED_FACES,
  );
  if (missingFaces.length > 0) {
    problems.push(`web font faces failed to load: ${missingFaces.map(({ family, weight }) => `${family} ${weight}`).join(', ')}`);
  }

  if (problems.length > 0) {
    throw new Error(
      [
        'render-og-default.mjs: refusing to write a degraded og-default.png.',
        ...problems.map((problem) => `  - ${problem}`),
        '  Check network access to fonts.googleapis.com / fonts.gstatic.com (Google Fonts) and retry.',
      ].join('\n'),
    );
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
