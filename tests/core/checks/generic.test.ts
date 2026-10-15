import { describe, expect, it } from 'vitest';
import { makeContext } from '../../../src/core/checks/context';
import { GENERIC_CHECKS } from '../../../src/core/checks/generic';
import type { Finding } from '../../../src/core/checks/types';
import { buildIndex } from '../../../src/core/graph/index';
import { loadPacket } from '../../../src/core/packet/load';
import { miniPacket } from '../../fixtures/miniPacket';
import { hasRealPacket, readRealPacket } from '../../fixtures/realPacket';

const run = (id: string, index = buildIndex(miniPacket()), version?: string): Finding[] =>
  GENERIC_CHECKS.find((c) => c.id === id)!.run(makeContext(index, version));

describe('generic checks on the mini packet', () => {
  it('G1 flags a money value whose printed text is not on its page', () => {
    const out = run('G1');
    expect(out.map((f) => f.key)).toEqual(['ev-0012']);
    expect(out[0]!.severity).toBe('info');
  });

  it('G5 flags a superseded document that a line still cites', () => {
    const p = miniPacket();
    p.return_versions[0]!.documents_superseded = ['D02'];
    const out = run('G5', buildIndex(p));
    expect(out.find((f) => f.key === 'superseded-D02')?.severity).toBe('error');
  });

  it('G8 lists low-confidence reads only', () => {
    const p = miniPacket();
    p.extracted_values[0]!.confidence = 0.41;
    expect(run('G8', buildIndex(p)).map((f) => f.key)).toEqual(['ev-0001']);
  });
});

describe.skipIf(!hasRealPacket)('generic checks on the real packet', () => {
  const r = loadPacket(readRealPacket());
  if (!r.ok) throw new Error(r.error);
  const index = buildIndex(r.packet);

  it('G1 includes the transposed EIN and the invented zeros', () => {
    const keys = run('G1', index).map((f) => f.key);
    for (const id of ['ev-1045', 'ev-0022', 'ev-0501', 'ev-0510', 'ev-0519', 'ev-0528', 'ev-0537', 'ev-1049']) {
      expect(keys).toContain(id);
    }
    const ein = run('G1', index).find((f) => f.key === 'ev-1045')!;
    expect(ein.severity).toBe('warning');
    expect(ein.refs).toContain('line:v3/F2441.1b');
  });

  it('G2 finds exactly the duplicated mileage page and its effect', () => {
    const out = run('G2', index);
    expect(out).toHaveLength(1);
    expect(out[0]!.refs).toEqual(expect.arrayContaining(['D23#page2', 'D23#page3', 'line:v3/SchC.44a']));
    expect(out[0]!.expected).toBe(8100);
    expect(out[0]!.effect).toMatchObject({ federal: 919, california: 80, basis: 'rate' });
  });

  it('G3 finds exactly the double-counted Northlake interest', () => {
    const out = run('G3', index);
    expect(out).toHaveLength(1);
    expect(out[0]!.refs).toEqual(expect.arrayContaining(['line:v3/SchB.1.1', 'line:v3/SchB.1.2']));
    expect(out[0]!.effect).toMatchObject({ federal: -640, california: -127 });
  });

  it('G4 finds the broker summary that does not match its lots', () => {
    const out = run('G4', index);
    expect(out).toHaveLength(1);
    expect(out[0]!.refs).toContain('ev-0703');
    expect(out[0]!.expected).toBe(71965);
    expect(out[0]!.actual).toBe(71715);
  });

  it('G5 lists documents no v3 line cites and no superseded citations', () => {
    const out = run('G5', index);
    expect(out.map((f) => f.key)).toEqual(['uncited']);
    expect(out[0]!.refs).toEqual(expect.arrayContaining(['D10', 'D15', 'D47', 'D54', 'D73']));
  });

  it('G6 catches Theo\'s transposed SSN', () => {
    const out = run('G6', index);
    expect(out).toHaveLength(1);
    expect(out[0]!).toMatchObject({ key: 'theo', severity: 'error', expected: '666-74-3390', actual: '666-74-3309' });
    expect(out[0]!.refs).toEqual(expect.arrayContaining(['household:theo', 'ev-1080', 'ev-0012']));
  });

  it('G7 applies the firm variance rule and skips positional Schedule B keys', () => {
    const out = run('G7', index);
    expect(out.length).toBeGreaterThan(10);
    expect(out.some((f) => f.key.startsWith('SchB.'))).toBe(false);
    expect(out.every((f) => f.severity === 'info')).toBe(true);
    expect(out.map((f) => f.key)).toContain('Sch1.17');
  });

  it('G8 lists exactly the two low-confidence reads', () => {
    expect(run('G8', index).map((f) => f.key).sort()).toEqual(['ev-0919', 'ev-1049']);
  });
});
