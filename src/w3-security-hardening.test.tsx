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

  it('AcceptableUse is linked from the app chrome', () => {
    // Mounted from the composition root, not the frozen tab route table.
    const main = readRepoFile('./main.tsx');
    expect(main).toMatch(/<AcceptableUse\s*\/>/);
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
