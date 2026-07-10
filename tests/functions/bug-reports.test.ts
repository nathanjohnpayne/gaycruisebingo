import { describe, expect, it } from 'vitest';
import { BugReportInputError, nextRateState, validateBugReportInput } from '../../functions/src/bugReportCore';

const png = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]).toString('base64')}`;

const valid = () => ({
  schemaVersion: 1,
  description: 'The board stopped responding.',
  screenshotDataUrl: png,
  captureError: null,
  route: '/leaderboard?view=all',
  eventId: 'med-2026',
  appVersion: 'abc123',
  browser: 'Test Browser',
  viewport: { width: 390, height: 844 },
  online: true,
});

describe('bug-report server validation', () => {
  it('accepts bounded diagnostics and a real PNG signature', () => {
    const report = validateBugReportInput(valid());
    expect(report.description).toBe('The board stopped responding.');
    expect(report.screenshot?.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  it('accepts a text-only fallback with a bounded capture error', () => {
    const report = validateBugReportInput({ ...valid(), screenshotDataUrl: null, captureError: 'Canvas unavailable' });
    expect(report.screenshot).toBeNull();
    expect(report.captureError).toBe('Canvas unavailable');
  });

  it('rejects spoofed image content and non-app routes', () => {
    expect(() => validateBugReportInput({ ...valid(), screenshotDataUrl: 'data:image/png;base64,YWJj' })).toThrow(BugReportInputError);
    expect(() => validateBugReportInput({ ...valid(), route: 'https://attacker.example' })).toThrow('Route must be app-relative');
  });

  it('allows three reports per window, blocks the fourth, and resets at the boundary', () => {
    const first = nextRateState(undefined, 1_000);
    const second = nextRateState(first, 2_000);
    const third = nextRateState(second, 3_000);
    expect(third.count).toBe(3);
    expect(() => nextRateState(third, 4_000)).toThrow(BugReportInputError);
    expect(nextRateState(third, 1_000 + 15 * 60 * 1000)).toEqual({ windowStartMs: 901_000, count: 1 });
  });
});
