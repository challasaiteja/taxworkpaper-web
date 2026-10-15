import { consumersOf, type PacketIndex } from '../graph/index';
import type { Document, ExtractedValue, Line, ReturnVersion } from '../packet/types';
import type { Ref } from '../refs/refs';
import type { Effect } from './types';

export interface CheckContext {
  index: PacketIndex;
  version: ReturnVersion;
  taxYear: number;
  line(key: string): Line | undefined;
  num(key: string): number;
  ev(id: string): ExtractedValue | undefined;
  doc(id: string): Document | undefined;
  evsOf(docId: string): ExtractedValue[];
  sourceEvs(key: string): ExtractedValue[];
  linesCiting(ref: Ref): Ref[];
  rateEffect(category: string, delta: number, note?: string): Effect;
  whatIfEffect(id: string): Effect | null;
}

interface WhatIf { id: string; federal?: { total_tax_change?: number }; california?: { total_tax_change?: number } }

export function makeContext(index: PacketIndex, versionId = index.latest): CheckContext {
  const version = index.versions.get(versionId)!;
  const lines = new Map(version.lines.map((l) => [l.key, l]));
  const byDoc = new Map<string, ExtractedValue[]>();
  for (const e of index.packet.extracted_values) byDoc.set(e.document_id, [...(byDoc.get(e.document_id) ?? []), e]);
  const household = index.packet.household as { tax_year?: number } | undefined;

  return {
    index,
    version,
    taxYear: household?.tax_year ?? new Date(version.computed_at).getFullYear() - 1,
    line: (key) => lines.get(key),
    num: (key) => {
      const v = lines.get(key)?.value;
      return typeof v === 'number' ? v : 0;
    },
    ev: (id) => index.evs.get(id),
    doc: (id) => index.docs.get(id),
    evsOf: (docId) => byDoc.get(docId) ?? [],
    sourceEvs: (key) => (lines.get(key)?.sources ?? []).flatMap((s) => index.evs.get(s) ?? []),
    linesCiting: (ref) => consumersOf(index, ref).filter((r) => r.startsWith(`line:${version.version}/`)),
    rateEffect: (category, delta, note) => {
      const rate = version.tax_effect_rates[category];
      if (!rate) return { federal: 0, california: 0, basis: 'none', note: `No tax-effect rate for "${category}" in ${version.version}` };
      const effect: Effect = {
        federal: Math.round(delta * rate.federal_per_dollar) || 0,
        california: Math.round(delta * rate.california_per_dollar) || 0,
        basis: 'rate',
      };
      if (note) effect.note = note;
      return effect;
    },
    whatIfEffect: (id) => {
      const alts = (index.packet.what_if as { alternatives?: WhatIf[] } | undefined)?.alternatives ?? [];
      const alt = alts.find((a) => a.id === id);
      if (!alt) return null;
      return {
        federal: alt.federal?.total_tax_change ?? 0,
        california: alt.california?.total_tax_change ?? 0,
        basis: 'what_if',
        note: `Engine what-if "${id}"`,
      };
    },
  };
}
