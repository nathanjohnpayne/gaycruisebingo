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

export default function App() {
  const { user, loading, dealError, dealing, retryDeal } = useAuth();

  if (loading) return <div className="center muted">Loading…</div>;
  if (!user) return <SignIn />;

  // The deal is client-driven honor-system work (ADR 0001), so a failure — most
  // often the ADR-0003/0004 pool-below-24 guard — used to vanish into a swallowed
  // `.catch`, leaving a blank Board. Surface it instead: the Player sees why and
  // can retry without a full reload. `AuthContext` owns the deal + error state.
  if (dealError) return <DealError message={dealError} onRetry={retryDeal} retrying={dealing} />;

  // Frozen route -> page-component mapping, one entry per stable mount
  // point in `./components/tabs`. `Record<TabId, ReactElement>` makes the
  // mapping exhaustive at compile time: adding a tab to `TABS` without a
  // matching page here fails `npm run typecheck`. Wave-1+ tickets change
  // what THEIR tab renders inside their own component file, not this map.
  const pages: Record<TabId, ReactElement> = {
    card: <Board />,
    feed: <ProofFeed />,
    ranks: <Leaderboard />,
    prompts: <ItemPool />,
    admin: <Admin />,
  };

  return (
    <div className="app">
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
