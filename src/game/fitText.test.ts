import { describe, it, expect } from 'vitest';
import { fitTextSize } from './fitText';

// specs/d15-text-size.md: the auto-fit guard's measure-and-shrink primitive.
// The guard always wins over the S/M/L base — a long prompt at Large steps
// its font down until it fits; a short one is returned unshrunk at the base.

describe('fitTextSize', () => {
  it('returns the base size unshrunk for a short string that already fits', () => {
    const size = fitTextSize('Hi', { width: 60, height: 60 }, { baseSize: 14 });
    expect(size).toBe(14);
  });

  it('shrinks an oversized prompt below the base size, without going below the floor', () => {
    const longPrompt =
      'Got a stranger to take a photo of the entire group at the pool deck sail-away party';
    const size = fitTextSize(longPrompt, { width: 60, height: 60 }, { baseSize: 14 });
    expect(size).toBeLessThan(14);
    expect(size).toBeGreaterThanOrEqual(6); // default minSize floor
  });

  it('never shrinks past the configured minSize floor, even for a pathological prompt', () => {
    const veryLongPrompt = 'A'.repeat(500);
    const size = fitTextSize(veryLongPrompt, { width: 40, height: 40 }, { baseSize: 14, minSize: 8 });
    expect(size).toBe(8);
  });

  it('never exceeds baseSize — Large is a ceiling, never a guarantee', () => {
    const size = fitTextSize('short', { width: 200, height: 200 }, { baseSize: 16 });
    expect(size).toBeLessThanOrEqual(16);
  });

  it('is monotonic: a smaller box never yields a LARGER fitted size than a bigger box', () => {
    const prompt = 'Made a new friend at the welcome aboard mixer on the pool deck';
    const smallBoxSize = fitTextSize(prompt, { width: 50, height: 50 }, { baseSize: 14 });
    const bigBoxSize = fitTextSize(prompt, { width: 120, height: 120 }, { baseSize: 14 });
    expect(smallBoxSize).toBeLessThanOrEqual(bigBoxSize);
  });

  it('treats an unmeasured (zero-area) box as "not yet laid out" and returns the base size', () => {
    const size = fitTextSize('anything at all here', { width: 0, height: 0 }, { baseSize: 14 });
    expect(size).toBe(14);
  });

  it('treats empty/whitespace-only text as nothing to shrink for', () => {
    const size = fitTextSize('   ', { width: 40, height: 40 }, { baseSize: 14 });
    expect(size).toBe(14);
  });
});
