import { describe, expect, it } from 'vitest';
import { honorDisplayName } from './attribution';

describe('honorDisplayName', () => {
  it('rejects only the unresolved Anonymous sentinel', () => {
    expect(honorDisplayName(undefined, undefined)).toBeNull();
    expect(honorDisplayName(undefined, 'Anonymous')).toBeNull();
    expect(honorDisplayName(undefined, 'Alice')).toBe('Alice');
  });
});
