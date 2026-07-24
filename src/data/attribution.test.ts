import { describe, expect, it } from 'vitest';
import { honorDisplayName, markerDisplayName } from './attribution';

describe('honorDisplayName', () => {
  it('rejects only the unresolved Anonymous sentinel', () => {
    expect(honorDisplayName(undefined, undefined)).toBeNull();
    expect(honorDisplayName(undefined, 'Anonymous')).toBeNull();
    expect(honorDisplayName(undefined, 'Alice')).toBe('Alice');
  });

  it('uses a resolved cached name when a stale Claim carries the Anonymous sentinel', () => {
    expect(markerDisplayName('Anonymous', 'Alice')).toBe('Alice');
    expect(honorDisplayName('Anonymous', 'Alice')).toBe('Alice');
  });
});
