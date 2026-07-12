import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Covers specs/d15-more-menu.md § Theme: the Auto chip must un-save any
// earlier cross-device pick, not just the local `gcb.theme` override, or a
// Player who explicitly re-picks Auto keeps getting re-pinned to their old
// concrete theme on the next load/device (Codex P2 on #232).

const { authState } = vi.hoisted(() => ({
  authState: { current: { user: null as { uid: string } | null } },
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => authState.current }));

const { savePlayerTheme, clearPlayerTheme } = vi.hoisted(() => ({
  savePlayerTheme: vi.fn().mockResolvedValue(undefined),
  clearPlayerTheme: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../data/api', () => ({ savePlayerTheme, clearPlayerTheme }));

vi.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({ preference: 'seriously-pink', setTheme: vi.fn() }),
}));

vi.mock('../analytics', () => ({ track: vi.fn() }));

import ThemeSwitcher from './ThemeSwitcher';

describe('ThemeSwitcher — Auto un-saves the cross-device pick (specs/d15-more-menu.md § Theme)', () => {
  afterEach(() => {
    savePlayerTheme.mockClear();
    clearPlayerTheme.mockClear();
  });

  it('clears the saved player theme when a signed-in Player picks Auto', async () => {
    authState.current = { user: { uid: 'alice' } };
    const user = userEvent.setup();
    render(<ThemeSwitcher />);

    await user.click(screen.getByRole('button', { name: /auto/i }));

    expect(clearPlayerTheme).toHaveBeenCalledWith('alice');
    expect(savePlayerTheme).not.toHaveBeenCalled();
  });

  it('does not attempt a Firestore write for a signed-out Player picking Auto', async () => {
    authState.current = { user: null };
    const user = userEvent.setup();
    render(<ThemeSwitcher />);

    await user.click(screen.getByRole('button', { name: /auto/i }));

    expect(clearPlayerTheme).not.toHaveBeenCalled();
  });

  it('still saves a concrete pick (unaffected by the Auto fix)', async () => {
    authState.current = { user: { uid: 'alice' } };
    const user = userEvent.setup();
    render(<ThemeSwitcher />);

    await user.click(screen.getByRole('button', { name: /get sporty/i }));

    expect(savePlayerTheme).toHaveBeenCalledWith('alice', 'get-sporty');
    expect(clearPlayerTheme).not.toHaveBeenCalled();
  });
});
