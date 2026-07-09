import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Reconciliation guard for ADR 0005 (issue #39), not an app unit test: it
// asserts on the *contents* (and, for cloud-run/, the *absence*) of the repo
// files the scaffolded server-side Open Graph pipeline touched, proving the
// Cloud Run OG renderer, the `share` Function, the `/s/**` hosting rewrite,
// and the inert `/og/**` Storage block all stay removed, while the static
// bare-URL unfurl path (public/og-default.png + the index.html OG meta) and
// on-device Share Cards (#36) stay intact. It lives under src/ (not
// tests/reconciliation/, despite the issue's suggested path) so the mandated
// `npm test` run (vitest, `include: ['src/**/*.test.{ts,tsx}']`) actually
// executes it — the same reason src/recon-recompute-stats.test.ts (issue #40)
// lives under src/ rather than tests/.
const resolve = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url).href);
const read = (rel: string): string => readFileSync(resolve(rel), 'utf8');

const functionsIndex = read('../functions/src/index.ts');
const firebaseJson = read('../firebase.json');
const storageRules = read('../storage.rules');
const indexHtml = read('../index.html');
const rootReadme = read('../README.md');
const appReadme = read('../docs/app/README.md');
const deployGuide = read('../docs/app/phase-1-deploy.md');
const multiEventSpec = read('../specs/x-multi-event-schema.md');

describe('recon: cloud-run/og-renderer is gone (#39, ADR 0005)', () => {
  it('cloud-run/ does not exist', () => {
    expect(existsSync(resolve('../cloud-run'))).toBe(false);
  });
});

describe('recon: share Function + escapeHtml + OG_RENDERER_URL removed from functions/src/index.ts', () => {
  it('functions/src/index.ts no longer defines share, escapeHtml, or OG_RENDERER_URL', () => {
    expect(functionsIndex).not.toMatch(/export const share\b/);
    expect(functionsIndex).not.toMatch(/escapeHtml/);
    expect(functionsIndex).not.toMatch(/OG_RENDERER_URL/);
    expect(functionsIndex).not.toMatch(/from 'firebase-functions\/v2\/https'/);
  });

  it('keeps moderateProof intact', () => {
    expect(functionsIndex).toMatch(/export const moderateProof\b/);
  });
});

describe('recon: firebase.json drops the /s/** rewrite and header rule, keeps the SPA fallback', () => {
  it('firebase.json has no /s/** rewrite or header rule, and keeps the SPA fallback', () => {
    expect(firebaseJson).not.toMatch(/"source":\s*"\/s\/\*\*"/);
    expect(firebaseJson).not.toMatch(/"function":\s*"share"/);
    expect(firebaseJson).toMatch(/"source":\s*"\*\*",\s*"destination":\s*"\/index\.html"/);
  });
});

describe('recon: storage.rules drops the inert /og/** block', () => {
  it('storage.rules has no /og/ match block', () => {
    expect(storageRules).not.toMatch(/match \/og\//);
  });
});

describe('recon: bare-URL unfurl keeps working with no server', () => {
  it('keeps public/og-default.png and the static index.html OG meta', () => {
    expect(existsSync(resolve('../public/og-default.png'))).toBe(true);
    expect(indexHtml).toMatch(/<meta property="og:image" content="https:\/\/gaycruisebingo\.com\/og-default\.png" \/>/);
  });
});

describe('recon: docs no longer instruct deploying/configuring the removed pipeline', () => {
  it('phase-1-deploy.md configures no OG_RENDERER_URL and retires the Cloud Run service instead of deploying it', () => {
    // No configure-it step: the share Function that read this env var is gone.
    expect(deployGuide).not.toMatch(/OG_RENDERER_URL/);
    // No CREATE step for the renderer (the old `gcloud run deploy og-renderer`).
    expect(deployGuide).not.toMatch(/gcloud run deploy og-renderer/);
    // Finding 3: a one-time RETIRE step for the separately-deployed Cloud Run
    // service must be present (Firebase deploys never remove it).
    expect(deployGuide).toMatch(/gcloud run services delete og-renderer/);
    // Finding 2: the forced-cleanup note must name `share` (not just
    // recomputeStats) so an operator knows the functions deploy prompts to
    // delete it and needs --force.
    expect(deployGuide).toMatch(/recomputeStats/);
    expect(deployGuide).toMatch(/`share`/);
    expect(deployGuide).toMatch(/--force/);
  });

  it('README.md drops the cloud-run/og-renderer references', () => {
    // Root README and app guide: no live surface for the removed pipeline.
    expect(rootReadme).not.toMatch(/cloud-run\/og-renderer/);
    expect(rootReadme).not.toMatch(/OG_RENDERER_URL/);
    expect(rootReadme).not.toMatch(/Cloud Run OG renderer/);
    expect(rootReadme).not.toMatch(/Playwright-rendered OG/);
    expect(appReadme).not.toMatch(/cloud-run\/og-renderer/);
    expect(appReadme).not.toMatch(/OG_RENDERER_URL/);
    expect(appReadme).not.toMatch(/Cloud Run OG renderer/);
  });

  it('x-multi-event-schema.md no longer instructs redeploying the removed share Function', () => {
    // Finding 1: the design-only spec described the share Function as a live
    // surface (query-param OG endpoint, a branding-sweep --only functions
    // redeploy exception). It must now describe it as removed, and never as
    // something to edit/redeploy.
    expect(multiEventSpec).not.toMatch(/OG_RENDERER_URL/);
    // The old present-tense instruction phrasings that treated share as a live,
    // editable/redeployable surface must be gone.
    expect(multiEventSpec).not.toMatch(/does redeploy a Function/);
    expect(multiEventSpec).not.toMatch(/share Function['’]s OG (description|copy)/);
    // It should acknowledge the removal by ADR/issue reference.
    expect(multiEventSpec).toMatch(/ADR 0005/);
  });
});
