import { describe, expect, it } from 'vitest';
import { makeContext } from '../../../src/core/checks/context';
import { runChecks } from '../../../src/core/checks/registry';
import type { Check } from '../../../src/core/checks/types';
import { buildIndex } from '../../../src/core/graph/index';
import { miniPacket } from '../../fixtures/miniPacket';

const index = buildIndex(miniPacket());
const finding = (id: string, federal: number, severity: 'error' | 'warning' | 'info' = 'warning') => ({
  checkId: id, key: 'k', title: id, severity, refs: [], explain: '', nextAction: '',
  effect: { federal, california: 0, basis: 'rate' as const },
});

describe('runChecks', () => {
  it('turns a throwing check into a "could not run" finding', () => {
    const boom: Check = { id: 'X1', title: 'Boom', kind: 'generic', run: () => { throw new Error('no household'); } };
    const out = runChecks(index, undefined, [boom]);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toMatch(/could not run/);
    expect(out[0]!.explain).toMatch(/no household/);
  });

  it('ranks by tax effect, with info findings last', () => {
    const checks: Check[] = [
      { id: 'A', title: 'A', kind: 'tax', run: () => [finding('small', 10)] },
      { id: 'B', title: 'B', kind: 'tax', run: () => [finding('info-big', 9999, 'info')] },
      { id: 'C', title: 'C', kind: 'tax', run: () => [finding('big', -500)] },
    ];
    expect(runChecks(index, undefined, checks).map((f) => f.checkId)).toEqual(['big', 'small', 'info-big']);
  });
});

describe('context', () => {
  it('computes rate effects and tolerates unknown categories', () => {
    const ctx = makeContext(index);
    expect(ctx.rateEffect('wages', 100)).toEqual({ federal: 22, california: 9, basis: 'rate' });
    const missing = ctx.rateEffect('nope', 100);
    expect(missing.federal).toBe(0);
    expect(missing.note).toMatch(/No tax-effect rate/);
  });

  it('reads lines and their source values', () => {
    const ctx = makeContext(index);
    expect(ctx.num('F1040.11')).toBe(1050);
    expect(ctx.sourceEvs('F1040.1a').map((e) => e.id)).toEqual(['ev-0001']);
    expect(ctx.linesCiting('ev-0003')).toEqual(['line:v1/SchB.1.1']);
  });
});
