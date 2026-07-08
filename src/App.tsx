import { useEffect, type ReactElement } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { joinAndDeal } from './data/api';
import { track } from './analytics';
import SignIn from './components/SignIn';
import Nav from './components/Nav';
import Board from './components/Board';
import Leaderboard from './components/Leaderboard';
import ItemPool from './components/ItemPool';
import ProofFeed from './components/ProofFeed';
import Admin from './components/Admin';
import { TABS, FALLBACK_PATH, type TabId } from './components/tabs';

export default function App() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (user) {
      joinAndDeal(user)
        .then(() => track('join_event'))
        .catch(() => {});
    }
  }, [user]);

  if (loading) return <div className="center muted">Loading…</div>;
  if (!user) return <SignIn />;

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
