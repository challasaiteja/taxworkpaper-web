import type { Ref } from '../refs/refs';
import type { CheckContext } from './context';

export type Severity = 'error' | 'warning' | 'info';

export interface Effect {
  federal: number;
  california: number;
  basis: 'rate' | 'direct' | 'what_if' | 'none';
  note?: string;
}

export interface Finding {
  checkId: string;
  key: string;
  title: string;
  severity: Severity;
  refs: Ref[];
  expected?: number | string;
  actual?: number | string;
  effect: Effect;
  explain: string;
  nextAction: string;
}

export interface Check {
  id: string;
  title: string;
  kind: 'generic' | 'tax';
  run(ctx: CheckContext): Finding[];
}

export const NO_EFFECT: Effect = { federal: 0, california: 0, basis: 'none' };
export const findingRef = (f: Pick<Finding, 'checkId' | 'key'>): Ref => `finding:${f.checkId}/${f.key}`;
export const effectSize = (e: Effect): number => Math.abs(e.federal) + Math.abs(e.california);
