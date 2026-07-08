import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Covers specs/w1-auth-google.md — the App-level surfacing of a swallowed
// join/deal failure and the DealError retry affordance.

// Drive App off a controllable auth value instead of the real Firebase-backed
// provider; `authState.value.dealError` is set per test.
const authState = vi.hoisted(() => ({
  value: { dealError: null as string | null, dealing: false, retryDeal: vi.fn() },
}));

vi.mock('./auth/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'sailor-1' }, loading: false, ...authState.value }),
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

// App imports the tab page components, which transitively pull in the real
// Firebase SDK; App short-circuits to <DealError> before any of them render, so
// a stub firebase module keeps the SDK from initializing.
vi.mock('./firebase', () => ({
  auth: {}, googleProvider: {}, db: {}, storage: {}, analytics: null, app: {}, EVENT_ID: 'x',
}));

import App from './App';
import { DealError } from './components/SignIn';

const POOL_MESSAGE =
  "We couldn't deal your card yet — the prompt pool is below the 24 a card needs. Ask an admin to add a few prompts, then retry.";

beforeEach(() => {
  vi.clearAllMocks();
  authState.value = { dealError: null, dealing: false, retryDeal: vi.fn() };
});

describe('App surfaces a failed deal instead of a blank Board', () => {
  it('renders the retry surface — not the app shell / Board — when the deal failed', async () => {
    authState.value.dealError = POOL_MESSAGE;
    const { container } = render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    // The Player sees a Player-worded reason...
    expect(screen.getByRole('alert')).toHaveTextContent(/24 a card needs/);
    // ...and the app shell / Board never mounted (no blank Board behind a toast).
    expect(container.querySelector('.app')).toBeNull();

    // Retry re-invokes the deal in place (no full reload).
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(authState.value.retryDeal).toHaveBeenCalledTimes(1);
  });
});

describe('DealError retry affordance', () => {
  it('re-invokes the deal when the Player taps Retry, and shows progress while dealing', async () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <DealError message="pool too small" onRetry={onRetry} retrying={false} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('pool too small');

    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(<DealError message="pool too small" onRetry={onRetry} retrying={true} />);
    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.getByRole('button')).toHaveTextContent(/dealing/i);
  });
});
