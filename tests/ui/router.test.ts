import { describe, expect, it } from 'vitest';
import { buildHash, parseHash } from '../../src/ui/router';

describe('router', () => {
  it('parses path, page and trace', () => {
    expect(parseHash('#/documents/D28?page=3&trace=ev-0498')).toEqual({
      path: ['documents', 'D28'], page: 3, trace: 'ev-0498',
    });
  });
  it('defaults to empty path', () => {
    expect(parseHash('')).toEqual({ path: [] });
  });
  it('round-trips refs containing slashes and colons', () => {
    const route = { path: ['return'], trace: 'line:v3/F1040.1a' };
    expect(parseHash(buildHash(route))).toEqual(route);
  });

  it('does not throw on malformed percent-encoding', () => {
    expect(parseHash('#/documents/%E0')).toEqual({ path: ['documents', '%E0'] });
  });
});
