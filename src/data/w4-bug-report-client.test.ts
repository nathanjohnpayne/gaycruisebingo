import { describe, expect, it, vi } from 'vitest';

vi.mock('../firebase', () => ({ EVENT_ID: 'med-2026', functions: {} }));

import { buildBugReportInput } from './bugReports';

describe('bug-report client diagnostics', () => {
  it('records the screen path without potentially sensitive query parameters', () => {
    window.history.replaceState({}, '', '/leaderboard?invite=secret-token');
    const input = buildBugReportInput({
      description: 'The board froze.',
      screenshotDataUrl: null,
      captureError: 'Capture unavailable',
    });
    expect(input.route).toBe('/leaderboard');
  });
});
