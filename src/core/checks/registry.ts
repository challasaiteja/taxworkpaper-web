import type { PacketIndex } from '../graph/index';
import { BUSINESS_CHECKS } from './business';
import { makeContext } from './context';
import { GENERIC_CHECKS } from './generic';
import { INCOME_CHECKS } from './income';
import { PAYMENT_CHECKS } from './payments';
import { PROPERTY_CHECKS } from './property';
import { effectSize, NO_EFFECT, type Check, type Finding } from './types';

export const CHECKS: Check[] = [...GENERIC_CHECKS, ...INCOME_CHECKS, ...BUSINESS_CHECKS, ...PROPERTY_CHECKS, ...PAYMENT_CHECKS];

const SEVERITY = { error: 0, warning: 1, info: 2 } as const;

export function runChecks(index: PacketIndex, versionId = index.latest, checks: Check[] = CHECKS): Finding[] {
  const ctx = makeContext(index, versionId);
  const findings = checks.flatMap((check): Finding[] => {
    try {
      return check.run(ctx);
    } catch (e) {
      return [{
        checkId: check.id, key: 'could-not-run', title: `${check.title}: check could not run`,
        severity: 'warning', refs: [], effect: NO_EFFECT,
        explain: e instanceof Error ? e.message : String(e),
        nextAction: 'Review this area manually; the packet is missing data this check expects.',
      }];
    }
  });
  return findings.sort(
    (a, b) =>
      Number(a.severity === 'info') - Number(b.severity === 'info') ||
      effectSize(b.effect) - effectSize(a.effect) ||
      SEVERITY[a.severity] - SEVERITY[b.severity],
  );
}
