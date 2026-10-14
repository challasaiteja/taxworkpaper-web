import { describe, expect, it } from 'vitest';
import { lineRef, pageRef, parseRef } from '../../src/core/refs/refs';

describe('parseRef', () => {
  it.each([
    ['D28', { kind: 'doc', docId: 'D28' }],
    ['D28#page3', { kind: 'page', docId: 'D28', page: 3 }],
    ['doc:D30#page32', { kind: 'page', docId: 'D30', page: 32 }],
    ['ev-0498', { kind: 'ev', id: 'ev-0498' }],
    ['line:v3/F1040.1a', { kind: 'line', version: 'v3', key: 'F1040.1a' }],
    ['qa-25', { kind: 'client', id: 'qa-25' }],
    ['msg-07', { kind: 'client', id: 'msg-07' }],
    ['call-01', { kind: 'client', id: 'call-01' }],
    ['py:/return_2024/lines/F8606.14', { kind: 'prefixed', prefix: 'py', rest: '/return_2024/lines/F8606.14' }],
    ['asset:SAC-BLDG', { kind: 'prefixed', prefix: 'asset', rest: 'SAC-BLDG' }],
    ['ref:fx.SEK.2024_average', { kind: 'prefixed', prefix: 'ref', rest: 'fx.SEK.2024_average' }],
    ['timeline:extension-2026-04-14', { kind: 'prefixed', prefix: 'timeline', rest: 'extension-2026-04-14' }],
    ['nonsense', { kind: 'unknown', raw: 'nonsense' }],
  ])('%s', (input, expected) => {
    expect(parseRef(input)).toEqual(expected);
  });

  it('formats line and page refs round-trip', () => {
    expect(parseRef(lineRef('v3', 'SchB.1.1'))).toEqual({ kind: 'line', version: 'v3', key: 'SchB.1.1' });
    expect(pageRef('D23', 3)).toBe('D23#page3');
  });
});
