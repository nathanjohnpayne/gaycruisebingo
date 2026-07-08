import { useEffect } from 'react';
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

  return (
    <div className="app">
      <Nav />
      <Routes>
        <Route path="/" element={<Board />} />
        <Route path="/feed" element={<ProofFeed />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/items" element={<ItemPool />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
