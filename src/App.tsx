import { type ReactElement } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import SignIn, { DealError } from './components/SignIn';
import CachedCardFallback from './components/CachedCardFallback';
import { loadCardSnapshot } from './data/cardCache';
import Nav from './components/Nav';
import Board from './components/Board';
import Leaderboard from './components/Leaderboard';
import ProofFeed from './components/ProofFeed';
import More from './components/More';
import { BugReportProvider } from './components/BugReport';
import PullToRefresh from './components/PullToRefresh';
import { TABS, FALLBACK_PATH, type TabId } from './components/tabs';
import LoadingState from './components/LoadingState';

export default function App() {
  const { user, loading, dealError, dealing, retryDeal } = useAuth();
  // The tab-switch transition's key (specs/motion-polish.md): the TOP-LEVEL
  // route segment only, so `.route-view` replays its entrance when the tab
  // changes but sub-navigation inside a tab (More → admin → section) never
  // re-animates the page it is already on.
  const location = useLocation();
  const section = location.pathname.split('/')[1] || 'card';

  if (loading) return <LoadingState label="Checking your cruise pass…" />;
  if (!user) return <SignIn />;

  // Frozen route -> page-component mapping, one entry per stable mount
  // point in `./components/tabs`. `Record<TabId, ReactElement>` makes the
  // mapping exhaustive at compile time: adding a tab to `TABS` without a
  // matching page here fails `npm run typecheck`. Wave-1+ tickets change
  // what THEIR tab renders inside their own component file, not this map.
  //
  // Card is this ticket's exception: the client-driven deal (ADR 0001) used to
  // fail into a swallowed `.catch`, leaving a blank Board. A failure — most
  // often the ADR-0003/0004 pool-below-24 guard — now renders the retry surface
  // AS the Card tab's content, scoped there so the shell, Nav, and every other
  // route stay mounted while the error is up (Codex P2). `AuthContext` owns the
  // deal + error state.
  //
  // #434: on a deal failure, PREFER this device's durable card snapshot over the
  // full-screen reload screen. A Player who was already dealt in still sees their
  // card (read-only, refreshing in the background via Retry) instead of a
  // dead-end — the exact "it should be cached and load in the background" ask.
  // `loadCardSnapshot` is a synchronous localStorage read (no network), scoped to
  // this event + uid; Board writes the snapshot whenever it paints a real card.
  // The full DealError stays for a genuine first-timer with nothing cached.
  //
  // Phase 1.5 (#203): Prompts (ItemPool) and Admin are no longer routed,
  // tab-driven pages — they mount inside the More tab's menu (#208), not the
  // route table. The set is Card · Feed · Ranks · More.
  const cachedCard = dealError ? loadCardSnapshot(user.uid) : null;
  const pages: Record<TabId, ReactElement> = {
    card: dealError ? (
      cachedCard ? (
        <CachedCardFallback snapshot={cachedCard} onRetry={retryDeal} retrying={dealing} />
      ) : (
        <DealError message={dealError} onRetry={retryDeal} retrying={dealing} />
      )
    ) : (
      <Board />
    ),
    feed: <ProofFeed />,
    ranks: <Leaderboard />,
    more: <More />,
  };

  return (
    <div className="app">
      {/* The confirm-path Moment emitter (#41) is mounted in AuthProvider so it
          survives the attestation gate (Codex #116 R3 finding 2), not here. */}
      {/* BugReportProvider hosts the report sheet + pick-a-screen bar at the
          shell so the flow survives tab navigation; More's Support row is just
          the launcher (#324, specs/w4-bug-report-inbox.md). Inside `.app` so
          the surface stays under captureAppSurface()'s own exclusion marker. */}
      <BugReportProvider>
        {/* Shell chrome (specs/pull-to-refresh.md): one gesture surface for
            every tab — pull from the very top of any page to reload
            (reconnects wedged listeners, picks up a fresh deploy). */}
        <PullToRefresh />
        <Nav />
        {/* Keyed per top-level section so switching tabs replays the page-in
            rise (index.css `.route-view`); the wrapper is a plain block, so
            layout inside is unchanged. */}
        <div className="route-view" key={section}>
        <Routes>
          {/* The More tab alone mounts with a splat (specs/admin-console-ia.md):
              the admin console lives at REAL sub-routes (/more/admin[/section])
              rendered by More itself, so the browser/PWA back button walks
              admin detail → hub → More. The TAB SET is unchanged — this is
              sub-navigation inside the frozen `more` mount point, not a new
              tab (./components/tabs stays the one source of truth). */}
          {TABS.map((tab) => (
            <Route key={tab.id} path={tab.id === 'more' ? `${tab.path}/*` : tab.path} element={pages[tab.id]} />
          ))}
          <Route path="*" element={<Navigate to={FALLBACK_PATH} replace />} />
        </Routes>
        </div>
      </BugReportProvider>
    </div>
  );
}
