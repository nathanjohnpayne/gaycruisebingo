import { describe, expect, it } from 'vitest';
import {
  BUG_REPORT_SCREENSHOT_MAX_AREA,
  BUG_REPORT_SCREENSHOT_MAX_DIMENSION,
  planCaptureScale,
} from './screenshotFit';

// Server contract mirror (functions/src/bugReportContract.cjs rejects
// width > 8192, height > 8192, and width×height > 40,000,000).
const expectWithinCaps = (plan: { width: number; height: number }) => {
  expect(plan.width).toBeLessThanOrEqual(BUG_REPORT_SCREENSHOT_MAX_DIMENSION);
  expect(plan.height).toBeLessThanOrEqual(BUG_REPORT_SCREENSHOT_MAX_DIMENSION);
  expect(plan.width * plan.height).toBeLessThanOrEqual(BUG_REPORT_SCREENSHOT_MAX_AREA);
};

describe('planCaptureScale (#361)', () => {
  it('keeps the preferred ratio when the capture already fits', () => {
    expect(planCaptureScale(400, 700, 2)).toEqual({ pixelRatio: 2, width: 800, height: 1400, scaled: false });
  });

  it('passes a capture exactly at the dimension cap through unscaled', () => {
    // 8192 × 4882 = 39,993,344 px — at the edge cap, under the area cap.
    expect(planCaptureScale(8192, 4882, 1)).toEqual({ pixelRatio: 1, width: 8192, height: 4882, scaled: false });
  });

  it('passes a capture exactly at the area cap through unscaled', () => {
    // 8000 × 5000 = 40,000,000 px exactly; both edges under the edge cap.
    expect(planCaptureScale(8000, 5000, 1)).toEqual({ pixelRatio: 1, width: 8000, height: 5000, scaled: false });
  });

  it('downscales a capture one pixel over the height cap to fit it', () => {
    const plan = planCaptureScale(640, 8193, 1);
    expect(plan.scaled).toBe(true);
    expect(plan.height).toBeGreaterThanOrEqual(8191);
    expectWithinCaps(plan);
  });

  it('downscales a capture just over the area cap under it', () => {
    const plan = planCaptureScale(8000, 5001, 1);
    expect(plan.scaled).toBe(true);
    expect(plan.width * plan.height).toBeGreaterThan(39_900_000);
    expectWithinCaps(plan);
  });

  it('downscales a square-ish capture that only breaks the area cap', () => {
    const plan = planCaptureScale(7000, 7000, 1); // 49M px: edges fit, area does not
    expect(plan.scaled).toBe(true);
    expectWithinCaps(plan);
  });

  it('fits the long-feed shape that motivated #361 (640 CSS px wide at DPR 2)', () => {
    const plan = planCaptureScale(640, 20000, 2);
    expect(plan.scaled).toBe(true);
    expect(plan.pixelRatio).toBeLessThan(1);
    expect(plan.width).toBeGreaterThan(0);
    expectWithinCaps(plan);
  });

  it('collapses the short side to zero beyond an 8192:1 aspect ratio, never over the caps', () => {
    // No scale can hold both sides in [1, 8192] here; a 0-wide canvas makes
    // the capture fail loudly instead of submitting a contract-invalid PNG.
    const plan = planCaptureScale(2, 10_000_000, 1);
    expect(plan.width).toBe(0);
    expectWithinCaps(plan);
  });

  it('keeps the preferred ratio for non-measurable surfaces', () => {
    expect(planCaptureScale(0, 600, 2)).toEqual({ pixelRatio: 2, width: 0, height: 0, scaled: false });
    expect(planCaptureScale(Number.NaN, 600, 2).pixelRatio).toBe(2);
    expect(planCaptureScale(640, Number.POSITIVE_INFINITY, 2).pixelRatio).toBe(2);
  });

  it('normalizes a non-positive or non-finite preferred ratio to 1', () => {
    expect(planCaptureScale(500, 500, 0)).toEqual({ pixelRatio: 1, width: 500, height: 500, scaled: false });
    expect(planCaptureScale(500, 500, -3).pixelRatio).toBe(1);
    expect(planCaptureScale(500, 500, Number.NaN).pixelRatio).toBe(1);
  });

  it('never exceeds a cap or the preferred ratio across representative shapes', () => {
    const shapes: Array<[number, number, number]> = [
      [320, 480, 3], [640, 4096, 2], [640, 4097, 2], [1280, 100000, 2],
      [8192, 8192, 1], [8193, 8193, 2], [10000, 300, 1.5], [375.5, 12345.25, 2],
    ];
    for (const [width, height, preferred] of shapes) {
      const plan = planCaptureScale(width, height, preferred);
      expect(plan.pixelRatio).toBeGreaterThan(0);
      expect(plan.pixelRatio).toBeLessThanOrEqual(preferred);
      expect(plan.width).toBe(Math.trunc(width * plan.pixelRatio));
      expect(plan.height).toBe(Math.trunc(height * plan.pixelRatio));
      expectWithinCaps(plan);
    }
  });
});
