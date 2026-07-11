import { afterEach, describe, expect, it } from 'vitest';
import { isSyntheticProbe, SYNTHETIC_UA_MARKER } from './synthetic-probe';

// Restore the real UA after each test so nothing leaks into other suites.
const realUA = navigator.userAgent;
function setUA(value: string) {
  Object.defineProperty(navigator, 'userAgent', { value, configurable: true });
}
afterEach(() => setUA(realUA));

describe('isSyntheticProbe (#142)', () => {
  it('is true when the UA carries the synthetic marker', () => {
    setUA(`Mozilla/5.0 (Macintosh) Chrome/140 ${SYNTHETIC_UA_MARKER}`);
    expect(isSyntheticProbe()).toBe(true);
  });

  it('is false for a normal Chrome UA', () => {
    setUA('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/140 Safari/537.36');
    expect(isSyntheticProbe()).toBe(false);
  });

  it('is false for an empty UA', () => {
    setUA('');
    expect(isSyntheticProbe()).toBe(false);
  });
});
