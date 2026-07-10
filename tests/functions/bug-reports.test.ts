import { describe, expect, it } from 'vitest';
import { BugReportInputError, nextRateState, validateBugReportInput } from '../../functions/src/bugReportCore';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

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

  it('allows only three reports in every rolling 15-minute window, including across the boundary', () => {
    const first = nextRateState(undefined, 1_000);
    const second = nextRateState(first, 2_000);
    const third = nextRateState(second, 3_000);
    expect(third.submissionMs).toEqual([1_000, 2_000, 3_000]);
    expect(() => nextRateState(third, 4_000)).toThrow(BugReportInputError);
    const atBoundary = nextRateState(third, 1_000 + 15 * 60 * 1000);
    expect(atBoundary.submissionMs).toEqual([2_000, 3_000, 901_000]);
    expect(() => nextRateState(atBoundary, 901_001)).toThrow(BugReportInputError);
  });
});
