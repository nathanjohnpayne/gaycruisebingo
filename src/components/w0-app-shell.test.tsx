import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';
import { TABS, FALLBACK_PATH, visibleTabs, type TabId } from './tabs';
import TabBar from './TabBar';

// Covers specs/w0-app-shell.md. Runs under Vitest's default `environment:
// 'node'` (no jsdom/RTL yet — that lands with w0-test-harness) by rendering
// via `react-dom/server`'s DOM-free `renderToStaticMarkup`. `TabBar` and
// `./tabs` are deliberately free of Firebase-backed imports so they can
// render here; `Nav.tsx`/`App.tsx` wire in the real hooks but are otherwise
// thin callers of the same contract exercised below.
//
// The tab SET was revised in Phase 1.5 (#203, specs/d15-tab-contract.md) from
// Card/Feed/Ranks/Prompts/Admin to Card/Feed/Ranks/More; the app-shell
// structure this spec owns (frozen mount points, one route per tab, `*`
// fallback) is unchanged.

describe('tabs contract (frozen stable mount points)', () => {
  it('defines exactly the four Card/Feed/Ranks/More tabs, in order', () => {
    expect(TABS.map((t) => t.id)).toEqual(['card', 'feed', 'ranks', 'more']);
    expect(TABS.map((t) => t.label)).toEqual(['Card', 'Feed', 'Ranks', 'More']);
    expect(TABS.map((t) => t.path)).toEqual(['/', '/feed', '/leaderboard', '/more']);
  });

  it('has unique ids and unique paths (no accidental mount-point collisions)', () => {
    const ids = TABS.map((t) => t.id);
    const paths = TABS.map((t) => t.path);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('points the unmatched-route fallback at the Card tab\'s path', () => {
    const card = TABS.find((t) => t.id === 'card');
    expect(card?.path).toBe(FALLBACK_PATH);
  });
});

describe('visibleTabs', () => {
  it('returns the full Card/Feed/Ranks/More set (admin is an in-menu concern now)', () => {
    expect(visibleTabs().map((t) => t.id)).toEqual(['card', 'feed', 'ranks', 'more']);
  });
});

// react-router-dom's NavLink/Navigate use useLayoutEffect internally, which
// logs React's stock "does nothing on the server" warning under
// renderToStaticMarkup. Harmless here: every assertion below reads markup
// produced by the synchronous render pass itself, not by the layout effect.
describe('TabBar (real render — no Firebase-backed hooks in this component)', () => {
  it('renders one link per tab in the frozen order', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <TabBar />
      </MemoryRouter>,
    );
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/feed"');
    expect(html).toContain('href="/leaderboard"');
    expect(html).toContain('href="/more"');
    expect(html.match(/<a /g)).toHaveLength(4);
  });
});

describe('route table (mirrors App.tsx\'s TABS -> <Route> mapping)', () => {
  function renderRoutesAt(path: string): string {
    return renderToStaticMarkup(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          {/* Mirrors App.tsx exactly: the `more` route alone mounts with a
              splat so the admin console's sub-routes (/more/admin[/section],
              specs/admin-console-ia.md) nest inside the frozen mount point. */}
          {TABS.map((tab) => (
            <Route key={tab.id} path={tab.id === 'more' ? `${tab.path}/*` : tab.path} element={<div data-tab={tab.id} />} />
          ))}
          <Route path="*" element={<Navigate to={FALLBACK_PATH} replace />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  const expected: Record<TabId, string> = {
    card: '/',
    feed: '/feed',
    ranks: '/leaderboard',
    more: '/more',
  };

  for (const [id, path] of Object.entries(expected) as [TabId, string][]) {
    it(`mounts the "${id}" mount point at ${path}`, () => {
      const html = renderRoutesAt(path);
      expect(html).toContain(`data-tab="${id}"`);
    });
  }

  it('mounts the "more" mount point for the admin sub-routes (/more/admin[/section])', () => {
    for (const path of ['/more/admin', '/more/admin/settings']) {
      expect(renderRoutesAt(path)).toContain('data-tab="more"');
    }
  });

  it('mounts none of the known tabs for an unrecognized path (defers to the "/" redirect)', () => {
    const html = renderRoutesAt('/this-route-does-not-exist');
    for (const tab of TABS) {
      expect(html).not.toContain(`data-tab="${tab.id}"`);
    }
  });
});

// The one piece of the `.tabs` CSS that IS machine-checkable. The spec's
// layout claims (44px targets, safe-area padding) still need a real layout
// engine and stay a code-review/device check — but "the fixed bar carries no
// compositing trigger" is a grep, and it is the rule that has now failed twice
// in production (#422's backdrop-filter, then #451). Pin it so a future polish
// pass has to argue with a red test instead of silently reintroducing it.
describe('.tabs compositing contract (#422, #451)', () => {
  const indexCss = readFileSync('src/index.css', 'utf8');
  // EVERY `.tabs` block, not just the first (CodeRabbit on #452): matching once
  // would let a later block — a media-query override, a duplicate — reintroduce
  // a promotion trigger with this suite still green, which is the exact silent
  // regression the contract exists to catch. The leading `[ \t]*` picks up
  // nested/indented blocks too.
  const tabsRules = [...indexCss.matchAll(/^[ \t]*\.tabs\s*\{[^}]*\}/gm)].map((m) => m[0]);
  // The base rule is the only unindented one; the assertions about what the bar
  // IS (rather than what it must not carry) belong to it.
  const baseRules = tabsRules.filter((rule) => !/^[ \t]/.test(rule));

  it('declares exactly one base .tabs rule', () => {
    // A second unindented block would mean the properties below are split
    // across rules and last-one-wins decides the real value.
    expect(baseRules).toHaveLength(1);
  });

  it('keeps the bar pinned to the viewport bottom', () => {
    expect(baseRules[0]).toMatch(/position:\s*fixed/);
    expect(baseRules[0]).toMatch(/bottom:\s*0/);
  });

  // On iOS WebKit a `position: fixed` element promoted to its own compositing
  // layer is not reliably kept pinned to the visual viewport during scroll: it
  // detaches and freezes mid-screen, most visibly in a standalone home-screen
  // PWA on a scrolling route. Every property below is a promotion trigger.
  for (const trigger of ['backdrop-filter', 'filter', 'transform', 'will-change', 'perspective']) {
    it(`carries no \`${trigger}\` in any .tabs rule, vendor-prefixed spellings included`, () => {
      // Anchored on a declaration boundary (`{`, `;`, or whitespace) with an
      // OPTIONAL vendor prefix, which matters more here than anywhere else
      // (Codex P2 on #452): the platform this contract protects is WebKit, and
      // `-webkit-backdrop-filter` is the spelling iOS Safari actually honours.
      // The first cut excluded any trigger preceded by `-`, so the one property
      // most likely to detach the bar would have sailed through green.
      // The boundary still keeps `backdrop-filter` off the bare `filter` case
      // and `text-transform` off `transform` — neither `backdrop-` nor `text-`
      // is a vendor prefix, and neither is a declaration boundary.
      const pattern = new RegExp(`(?:^|[{;\\s])(?:-(?:webkit|moz|ms|o)-)?${trigger}\\s*:`, 'm');
      for (const rule of tabsRules) expect(rule).not.toMatch(pattern);
    });
  }

  it('paints a fully opaque background (no blending work on the fixed layer)', () => {
    expect(baseRules[0]).toMatch(/background:\s*var\(--bg\)/);
    for (const rule of tabsRules) expect(rule).not.toMatch(/transparent/);
  });
});
