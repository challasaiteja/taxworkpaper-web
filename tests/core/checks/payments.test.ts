import { describe, expect, it } from 'vitest';
import { makeContext } from '../../../src/core/checks/context';
import { PAYMENT_CHECKS } from '../../../src/core/checks/payments';
import { runChecks } from '../../../src/core/checks/registry';
import { buildIndex } from '../../../src/core/graph/index';
import { loadPacket } from '../../../src/core/packet/load';
import { hasRealPacket, readRealPacket } from '../../fixtures/realPacket';

describe.skipIf(!hasRealPacket)('payment checks on the real packet', () => {
  const r = loadPacket(readRealPacket());
  if (!r.ok) throw new Error(r.error);
  const index = buildIndex(r.packet);
  const ctx = makeContext(index);
  const run = (id: string) => PAYMENT_CHECKS.find((c) => c.id === id)!.run(ctx);

  it('T10a reconciles federal estimates to the IRS transcript', () => {
    const out = run('T10a');
    expect(out).toHaveLength(1);
    expect(out[0]!).toMatchObject({ expected: 12000, actual: 13000 });
    expect(out[0]!.effect).toMatchObject({ federal: 1000, california: 0, basis: 'direct' });
    expect(out[0]!.refs).toContain('agency:/irs_account_transcript_2025/0');
  });

  it('T10b removes the payment designated to the prior year', () => {
    const out = run('T10b');
    expect(out).toHaveLength(1);
    expect(out[0]!).toMatchObject({ expected: 10500, actual: 14000 });
    expect(out[0]!.effect).toMatchObject({ federal: 0, california: 3500, basis: 'direct' });
  });

  it('the full registry surfaces every planted error and nothing crashes', () => {
    const all = runChecks(index);
    expect(all.filter((f) => f.key === 'could-not-run')).toEqual([]);
    for (const id of ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7a', 'T7b', 'T8', 'T9', 'T10a', 'T10b', 'T11', 'T12']) {
      expect(all.some((f) => f.checkId === id)).toBe(true);
    }
    expect(all[0]!.checkId).toBe('T1');
  });
});
