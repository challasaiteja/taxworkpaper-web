import { describe, expect, it } from 'vitest';
import { BUSINESS_CHECKS } from '../../../src/core/checks/business';
import { makeContext } from '../../../src/core/checks/context';
import { PROPERTY_CHECKS } from '../../../src/core/checks/property';
import { buildIndex } from '../../../src/core/graph/index';
import { loadPacket } from '../../../src/core/packet/load';
import { hasRealPacket, readRealPacket } from '../../fixtures/realPacket';

describe.skipIf(!hasRealPacket)('business and property checks on the real packet', () => {
  const r = loadPacket(readRealPacket());
  if (!r.ok) throw new Error(r.error);
  const ctx = makeContext(buildIndex(r.packet));
  const run = (id: string) => [...BUSINESS_CHECKS, ...PROPERTY_CHECKS].find((c) => c.id === id)!.run(ctx);

  it('T3 applies the business-use percentages from the call notes', () => {
    const out = run('T3');
    expect(out.map((f) => f.key).sort()).toEqual(['ev-0095', 'ev-0101', 'ev-0106']);
    expect(out.reduce((s, f) => s + f.effect.federal, 0)).toBeCloseTo(541, -1);
    expect(out.every((f) => f.refs.includes('call-01'))).toBe(true);
  });

  it('T4 disallows self-employed health insurance when spouse coverage was available', () => {
    const out = run('T4');
    expect(out).toHaveLength(1);
    expect(out[0]!).toMatchObject({ expected: 0, actual: 14400 });
    expect(out[0]!.effect).toMatchObject({ federal: 4464, california: 605 });
    expect(out[0]!.refs).toContain('qa-25');
  });

  it('T5 flags the SEP contribution above the limit', () => {
    const out = run('T5');
    expect(out).toHaveLength(1);
    expect(out[0]!).toMatchObject({ expected: 15214, actual: 18000 });
    expect(out[0]!.effect).toMatchObject({ federal: 279, basis: 'direct' });
  });

  it('T6 flags the HVAC replacement booked as a repair, with the engine what-if', () => {
    const out = run('T6');
    expect(out).toHaveLength(1);
    expect(out[0]!.refs).toEqual(expect.arrayContaining(['D47', 'line:v3/SchE.14A']));
    expect(out[0]!.effect).toMatchObject({ federal: 3633, california: 896, basis: 'what_if' });
  });

  it('T7a removes the seller-paid property tax', () => {
    const out = run('T7a');
    expect(out).toHaveLength(1);
    expect(out[0]!).toMatchObject({ expected: 6508, actual: 13420 });
    expect(out[0]!.effect.california).toBe(332);
  });

  it('T7b catches payoff interest counted twice', () => {
    const out = run('T7b');
    expect(out).toHaveLength(1);
    expect(out[0]!).toMatchObject({ expected: 19697, actual: 21847 });
    expect(out[0]!.effect).toMatchObject({ federal: 559, california: 103 });
  });

  it('T8 caps the vehicle donation at the charity sale price', () => {
    const out = run('T8');
    expect(out).toHaveLength(1);
    expect(out[0]!).toMatchObject({ expected: 2900, actual: 6000 });
    expect(out[0]!.effect).toMatchObject({ federal: 806, california: 149 });
  });
});
