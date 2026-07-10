import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Covers specs/w3-security-hardening.md (jsdom / static-scan claims): index.html
// keeps serving `robots: noindex` (ADR 0005), the 18+ AcceptableUse page renders
// behind auth (nothing signed out) and is wired into the app chrome, and
// review-policy.yml proposes the security-rules + functions paths. The rules
// documentation-guard lives in tests/rules/self-writable.test.ts.

// useAuth is mocked so AcceptableUse can be exercised signed-in and signed-out
// without booting Firebase. `authState.current` is the live binding the mock
// re-reads on every render (hoisted above the imports Vitest hoists).
const { authState } = vi.hoisted(() => ({
  authState: { current: { user: null as { uid: string; displayName: string } | null } },
}));
vi.mock('./auth/AuthContext', () => ({ useAuth: () => authState.current }));

import AcceptableUse from './components/AcceptableUse';

const readRepoFile = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('index.html crawler posture (ADR 0005)', () => {
  it('index.html serves robots noindex', () => {
    const html = readRepoFile('../index.html');
    expect(html).toMatch(/<meta\s+name="robots"\s+content="noindex"\s*\/>/);
  });
});

describe('AcceptableUse page (behind auth — ADR 0005)', () => {
  it('AcceptableUse renders the 18+ guidelines and report path for a signed-in Player', async () => {
    authState.current = { user: { uid: 'alice', displayName: 'Alice' } };
    const user = userEvent.setup();
    render(<AcceptableUse />);

    await user.click(screen.getByRole('button', { name: /guidelines/i }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(/18\+/);
    expect(dialog).toHaveTextContent(/report a Prompt or Proof/i);
  });

  it('AcceptableUse renders nothing while signed out', () => {
    authState.current = { user: null };
    const { container } = render(<AcceptableUse />);
    expect(container).toBeEmptyDOMElement(); // null → no page/trigger reachable
  });

  it('keeps AcceptableUse reachable on Card and every other signed-in route', () => {
    // Rendered inline under the Board tally line (#143), centered, rather than
    // as a floating fixed element in the composition root.
    const board = readRepoFile('./components/Board.tsx');
    expect(board).toMatch(/<AcceptableUse\s*\/>/);

    // The composition root supplies the same affordance on non-Card routes;
    // the pathname guard prevents a duplicate trigger on Card.
    const main = readRepoFile('./main.tsx');
    expect(main).toMatch(/location\.pathname\s*!==\s*['"]\/['"]\s*&&\s*<AcceptableUse\s*\/>/);
  });

  it('does not promise automatic report-threshold hiding', async () => {
    // The report path only increments reportCount (src/data/api.ts,
    // src/data/proofs.ts); status only changes via an Admin action
    // (src/data/admin.ts). The copy must not claim otherwise.
    authState.current = { user: { uid: 'alice', displayName: 'Alice' } };
    const user = userEvent.setup();
    render(<AcceptableUse />);
    await user.click(screen.getByRole('button', { name: /guidelines/i }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(/Admin/);
    expect(dialog).not.toHaveTextContent(/enough reports hide/i);
  });
});

describe('AcceptableUse modal focus management (keyboard/screen-reader users)', () => {
  beforeEach(() => {
    authState.current = { user: { uid: 'alice', displayName: 'Alice' } };
  });

  it('moves focus into the dialog on open and restores it to the trigger when "Got it" closes it', async () => {
    const user = userEvent.setup();
    render(<AcceptableUse />);
    const trigger = screen.getByRole('button', { name: /guidelines/i });

    await user.click(trigger);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await user.click(screen.getByRole('button', { name: /got it/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('traps Tab and Shift+Tab within the dialog while it is open', async () => {
    const user = userEvent.setup();
    render(<AcceptableUse />);
    await user.click(screen.getByRole('button', { name: /guidelines/i }));
    const gotIt = screen.getByRole('button', { name: /got it/i });

    await user.tab();
    expect(gotIt).toHaveFocus();
    await user.tab(); // wraps forward — stays inside the dialog
    expect(gotIt).toHaveFocus();
    await user.tab({ shift: true }); // wraps backward — stays inside the dialog
    expect(gotIt).toHaveFocus();
  });

  it('closes on Escape and restores focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<AcceptableUse />);
    const trigger = screen.getByRole('button', { name: /guidelines/i });
    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('restores focus to the trigger when the backdrop closes the dialog', async () => {
    const user = userEvent.setup();
    render(<AcceptableUse />);
    const trigger = screen.getByRole('button', { name: /guidelines/i });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog');

    // The backdrop is the dialog's fixed positioned parent; clicking it
    // (not the dialog itself) is the "click outside" close path.
    await user.click(dialog.parentElement as HTMLElement);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });
});

describe('review-policy.yml protected paths (protected-path gap)', () => {
  it('review-policy.yml protects the security-rules and functions surfaces', () => {
    const policy = readRepoFile('../.github/review-policy.yml');

    // Scope the assertion to the external_review_paths block (up to the next
    // top-level YAML key) so a stray match elsewhere can't pass by accident.
    const blockText = policy.match(/\nexternal_review_paths:\n([\s\S]*?)\n[^\s#]/)?.[1] ?? '';
    expect(blockText).not.toHaveLength(0);

    expect(blockText).toMatch(/^\s*-\s*"firestore\.rules"\s*$/m);
    expect(blockText).toMatch(/^\s*-\s*"storage\.rules"\s*$/m);
    expect(blockText).toMatch(/^\s*-\s*"functions\/\*\*"\s*$/m);
  });
});
