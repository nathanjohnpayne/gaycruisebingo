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
          {TABS.map((tab) => (
            <Route key={tab.id} path={tab.path} element={<div data-tab={tab.id} />} />
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

  it('mounts none of the known tabs for an unrecognized path (defers to the "/" redirect)', () => {
    const html = renderRoutesAt('/this-route-does-not-exist');
    for (const tab of TABS) {
      expect(html).not.toContain(`data-tab="${tab.id}"`);
    }
  });
});
