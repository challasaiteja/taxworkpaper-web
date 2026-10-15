import { describe, expect, it } from 'vitest';
import { makeContext } from '../../../src/core/checks/context';
import { INCOME_CHECKS } from '../../../src/core/checks/income';
import { buildIndex } from '../../../src/core/graph/index';
import { loadPacket } from '../../../src/core/packet/load';
import { hasRealPacket, readRealPacket } from '../../fixtures/realPacket';

describe.skipIf(!hasRealPacket)('income checks on the real packet', () => {
  const r = loadPacket(readRealPacket());
  if (!r.ok) throw new Error(r.error);
  const ctx = makeContext(buildIndex(r.packet));
  const run = (id: string) => INCOME_CHECKS.find((c) => c.id === id)!.run(ctx);

  it('T1 restores RSU basis from the supplemental statement', () => {
    const out = run('T1');
    expect(out.map((f) => f.key).sort()).toEqual(['D28/N1', 'D28/N3', 'D28/N4']);
    const total = out.reduce((s, f) => ({ federal: s.federal + f.effect.federal, california: s.california + f.effect.california }), { federal: 0, california: 0 });
    expect(total.federal).toBeCloseTo(-15536, -1);
    expect(total.california).toBeCloseTo(-1619, -1);
    expect(out.find((f) => f.key === 'D28/N4')!).toMatchObject({ expected: 9420, actual: 0 });
    expect(out[0]!.refs).toEqual(expect.arrayContaining(['ev-0027']));
  });

  it('T2 finds the 1099-K already inside book receipts', () => {
    const out = run('T2');
    expect(out).toHaveLength(1);
    expect(out[0]!).toMatchObject({ expected: 151300, actual: 163700 });
    expect(out[0]!.effect).toMatchObject({ federal: -4402, california: -384 });
    expect(out[0]!.refs).toEqual(expect.arrayContaining(['ev-0127', 'ev-0109', 'line:v3/SchC.1']));
  });

  it('T9 finds the prior-year exchange rate', () => {
    const out = run('T9');
    expect(out).toHaveLength(1);
    expect(out[0]!).toMatchObject({ key: 'SchB.1.6', expected: 1871, actual: 1747 });
    expect(out[0]!.effect).toMatchObject({ federal: 43, california: 9 });
  });

  it('T11 recomputes California wages from the paystub', () => {
    const out = run('T11');
    expect(out).toHaveLength(1);
    expect(out[0]!).toMatchObject({ expected: 129569, actual: 218400 });
    expect(out[0]!.effect).toMatchObject({ federal: 0, california: -5685 });
    expect(out[0]!.title).toMatch(/paystub/);
  });

  it('T12 flags the transfer-in lot without basis or date', () => {
    const out = run('T12');
    expect(out.map((f) => f.key)).toEqual(['D35/C6']);
    expect(out[0]!.refs).toContain('line:v3/F8949.H.C6');
  });
});
