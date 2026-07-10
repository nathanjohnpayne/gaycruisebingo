import { type ReactElement } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import SignIn, { DealError } from './components/SignIn';
import Nav from './components/Nav';
import Board from './components/Board';
import Leaderboard from './components/Leaderboard';
import ItemPool from './components/ItemPool';
import ProofFeed from './components/ProofFeed';
import Admin from './components/Admin';
import { TABS, FALLBACK_PATH, type TabId } from './components/tabs';
import LoadingState from './components/LoadingState';

export default function App() {
  const { user, loading, dealError, dealing, retryDeal } = useAuth();

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
  // route stay mounted: recovery for the pool guard is adding Prompts on
  // /items, which must stay reachable while the error is up (Codex P2).
  // `AuthContext` owns the deal + error state.
  const pages: Record<TabId, ReactElement> = {
    card: dealError ? (
      <DealError message={dealError} onRetry={retryDeal} retrying={dealing} />
    ) : (
      <Board />
    ),
    feed: <ProofFeed />,
    ranks: <Leaderboard />,
    prompts: <ItemPool />,
    admin: <Admin />,
  };

  return (
    <div className="app">
      {/* The confirm-path Moment emitter (#41) is mounted in AuthProvider so it
          survives the attestation gate (Codex #116 R3 finding 2), not here. */}
      <Nav />
      <Routes>
        {TABS.map((tab) => (
          <Route key={tab.id} path={tab.path} element={pages[tab.id]} />
        ))}
        <Route path="*" element={<Navigate to={FALLBACK_PATH} replace />} />
      </Routes>
    </div>
  );
}
