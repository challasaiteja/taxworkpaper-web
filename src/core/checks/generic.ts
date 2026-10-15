import { locateOnPage } from '../documents/locate';
import { formatValue } from '../format';
import { lineRef, pageRef, type Ref } from '../refs/refs';
import { NO_EFFECT, type Check, type Finding } from './types';

const LOCATABLE = new Set(['money', 'ein', 'ssn', 'date', 'account_number']);

const valueNotOnPage: Check = {
  id: 'G1', title: 'Value not on its page', kind: 'generic',
  run(ctx) {
    const out: Finding[] = [];
    for (const doc of ctx.index.packet.documents) {
      for (const page of doc.pages) {
        const evs = ctx.index.evsByPage.get(pageRef(doc.id, page.page)) ?? [];
        const spans = locateOnPage(page.printed_content, evs);
        for (const ev of evs) {
          if (!LOCATABLE.has(ev.value_type) || !ev.text_as_read || spans.get(ev.id)) continue;
          const lines = ctx.linesCiting(ev.id);
          out.push({
            checkId: 'G1', key: ev.id, severity: lines.length ? 'warning' : 'info',
            title: `${ev.label} (${formatValue(ev.value)}) is not printed on ${doc.id} page ${page.page}`,
            refs: [ev.id, pageRef(doc.id, page.page), ...lines],
            actual: formatValue(ev.value), effect: NO_EFFECT,
            explain: `The pipeline read "${ev.text_as_read}" at confidence ${ev.confidence}, but no such text is on the page.` +
              (lines.length ? ` ${lines.length} return line(s) use it.` : ' No return line uses it.'),
            nextAction: 'Compare with the page; correct the value or confirm it from another source.',
          });
        }
      }
    }
    return out;
  },
};

function numbers(text: string): string[] {
  return text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
}

function multisetJaccard(a: string[], b: string[]): number {
  const count = (xs: string[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>());
  const ca = count(a), cb = count(b);
  let inter = 0, union = 0;
  for (const k of new Set([...ca.keys(), ...cb.keys()])) {
    inter += Math.min(ca.get(k) ?? 0, cb.get(k) ?? 0);
    union += Math.max(ca.get(k) ?? 0, cb.get(k) ?? 0);
  }
  return union ? inter / union : 0;
}

const duplicatePage: Check = {
  id: 'G2', title: 'Duplicate page', kind: 'generic',
  run(ctx) {
    const out: Finding[] = [];
    const params = (ctx.index.packet.engine_reference as { parameters?: { mileage_rate?: number } } | undefined)?.parameters;
    for (const doc of ctx.index.packet.documents) {
      for (let i = 0; i < doc.pages.length; i++) {
        for (let j = i + 1; j < doc.pages.length; j++) {
          const a = numbers(doc.pages[i]!.printed_content), b = numbers(doc.pages[j]!.printed_content);
          if (a.length < 3 || b.length < 3) continue;
          const sim = multisetJaccard(a, b);
          if (sim <= 0.8) continue;
          const dupPage = doc.pages[j]!.page;
          const dupEvs = ctx.evsOf(doc.id).filter((e) => e.page === dupPage);
          const cited = dupEvs.flatMap((e) => ctx.linesCiting(e.id).map((line) => ({ e, line })));
          const mileage = cited.filter(({ line }) => ctx.index.lines.get(line)?.rule === 'R-MILEAGE-PAGE-TOTALS');
          const miles = mileage.reduce((s, { e }) => s + (typeof e.value === 'number' ? e.value : 0), 0);
          const mileageLine = mileage[0]?.line;
          const actual = mileageLine ? Number(ctx.index.lines.get(mileageLine)!.value) : undefined;
          const finding: Finding = {
            checkId: 'G2', key: pageRef(doc.id, dupPage), severity: cited.length ? 'error' : 'warning',
            title: `${doc.id} page ${dupPage} repeats page ${doc.pages[i]!.page} (${Math.round(sim * 100)}% same figures)`,
            refs: [pageRef(doc.id, doc.pages[i]!.page), pageRef(doc.id, dupPage), ...new Set(cited.map((c) => c.line))],
            effect: miles && params?.mileage_rate
              ? ctx.rateEffect('schc_profit', miles * params.mileage_rate, `${miles} duplicate miles × ${params.mileage_rate}`)
              : NO_EFFECT,
            explain: `The two pages print nearly the same numbers.` +
              (cited.length ? ` Values from the repeat feed ${new Set(cited.map((c) => c.line)).size} line(s), so they are counted twice.` : ''),
            nextAction: 'Confirm it is a second scan, mark the page as a duplicate, and remove its values from the return.',
          };
          if (actual !== undefined) {
            finding.actual = actual;
            finding.expected = actual - miles;
          }
          out.push(finding);
        }
      }
    }
    return out;
  },
};

const duplicateInterest: Check = {
  id: 'G3', title: 'Same interest or dividend counted twice', kind: 'generic',
  run(ctx) {
    const out: Finding[] = [];
    const lines = ctx.version.lines.filter((l) => /^SchB\.(1|5)\./.test(l.key) && typeof l.value === 'number' && l.value > 0);
    const byPartAndValue = new Map<string, typeof lines>();
    for (const l of lines) {
      const k = `${l.key.split('.')[1]}:${l.value}`;
      byPartAndValue.set(k, [...(byPartAndValue.get(k) ?? []), l]);
    }
    for (const group of byPartAndValue.values()) {
      const value = group[0]!.value as number;
      if (group.length < 2) continue;
      const docs = new Set(group.flatMap((l) => ctx.sourceEvs(l.key).map((e) => e.document_id)));
      if (docs.size < 2) continue;
      const firstWords = new Set([...docs].map((d) => ctx.doc(d)?.issuer.split(' ')[0]));
      const [first, ...rest] = group;
      for (const dup of rest) {
        const refs: Ref[] = [lineRef(ctx.version.version, first!.key), lineRef(ctx.version.version, dup.key), ...first!.sources, ...dup.sources];
        out.push({
          checkId: 'G3', key: dup.key, severity: firstWords.size === 1 ? 'error' : 'warning',
          title: `${formatValue(value)} appears on two payer lines: "${first!.label}" and "${dup.label}"`,
          refs, expected: 0, actual: value,
          effect: ctx.rateEffect('interest', -value),
          explain: 'Two documents report the same amount, and both are on Schedule B. A composite brokerage statement often repeats a bank sweep 1099-INT.',
          nextAction: 'Confirm both documents describe the same account; keep one line.',
        });
      }
    }
    return out;
  },
};

const summaryVsDetail: Check = {
  id: 'G4', title: 'Printed total does not match detail', kind: 'generic',
  run(ctx) {
    const out: Finding[] = [];
    const used = new Set(ctx.version.documents_used.filter((d) => !ctx.version.documents_superseded.includes(d)));
    for (const docId of used) {
      const evs = ctx.evsOf(docId);
      const summary = evs.find((e) => /summary_proceeds$/.test(e.field));
      if (!summary || typeof summary.value !== 'number') continue;
      const detail = evs.filter((e) => /^[A-Z]+\d+_proceeds$/.test(e.field)).reduce((s, e) => s + (typeof e.value === 'number' ? e.value : 0), 0);
      if (Math.abs(detail - summary.value) < 0.5) continue;
      const doc = ctx.doc(docId)!;
      out.push({
        checkId: 'G4', key: docId, severity: 'warning',
        title: `${docId} summary proceeds ${formatValue(summary.value)} vs lots read ${formatValue(detail)}`,
        refs: [summary.id, docId], expected: summary.value, actual: detail,
        effect: { ...NO_EFFECT, note: `Missing proceeds ${formatValue(summary.value - detail)}; gain depends on the unread lot's basis` },
        explain: `The broker's summary is ${formatValue(summary.value - detail)} more than the lots extracted.` +
          (doc.extraction.status !== 'extracted' ? ` Extraction was ${doc.extraction.status}: ${doc.extraction.reason ?? 'no reason given'}.` : ''),
        nextAction: 'Find the unread lot(s) on the document and add them; the IRS matches the summary figure.',
      });
    }
    return out;
  },
};

const documentUse: Check = {
  id: 'G5', title: 'Document use', kind: 'generic',
  run(ctx) {
    const cited = new Set(ctx.version.lines.flatMap((l) => ctx.sourceEvs(l.key).map((e) => e.document_id)));
    const out: Finding[] = ctx.version.documents_superseded.filter((d) => cited.has(d)).map((d) => ({
      checkId: 'G5', key: `superseded-${d}`, severity: 'error' as const,
      title: `${d} is superseded but lines still cite it`, refs: [d], effect: NO_EFFECT,
      explain: 'A corrected or replacement document exists, yet values from the old one are still on the return.',
      nextAction: 'Re-point those lines to the replacement document.',
    }));
    const uncited = ctx.index.packet.documents.map((d) => d.id).filter((d) => !cited.has(d));
    if (uncited.length) {
      out.push({
        checkId: 'G5', key: 'uncited', severity: 'info',
        title: `${uncited.length} documents are not cited by any ${ctx.version.version} line`,
        refs: uncited, effect: NO_EFFECT,
        explain: 'Each needs a recorded reason: duplicate, superseded, reference only, or evidence for a judgment.',
        nextAction: 'Record a disposition for each document.',
      });
    }
    return out;
  },
};

interface Person { id: string; name: string; ssn?: string }

const identityMismatch: Check = {
  id: 'G6', title: 'Identity mismatch', kind: 'generic',
  run(ctx) {
    const people = ((ctx.index.packet.household as { people?: Person[] }).people) ?? [];
    const ssnEvs = ctx.index.packet.extracted_values.filter((e) => e.value_type === 'ssn' && typeof e.value === 'string');
    const digits = (s: string) => s.replace(/\D/g, '').split('').sort().join('');
    return people.flatMap((p): Finding[] => {
      if (!p.ssn) return [];
      const conflicts = ssnEvs.filter((e) => {
        const v = e.value as string;
        return v !== p.ssn && v.slice(0, 6) === p.ssn!.slice(0, 6) && digits(v) === digits(p.ssn!);
      });
      if (!conflicts.length) return [];
      return [{
        checkId: 'G6', key: p.id, severity: 'error',
        title: `${p.name}'s SSN in the household record differs from ${conflicts.length} document(s)`,
        refs: [`household:${p.id}`, ...conflicts.map((e) => e.id)],
        expected: conflicts[0]!.value as string, actual: p.ssn,
        effect: { ...NO_EFFECT, note: 'E-file rejects on a mismatched dependent SSN; credits for this person are at risk' },
        explain: 'The same digits in a different order: a transposition when the client typed the household record.',
        nextAction: 'Confirm against the Social Security card and correct the household record before filing.',
      }];
    });
  },
};

const variance: Check = {
  id: 'G7', title: 'Swing from last year', kind: 'generic',
  run(ctx) {
    const prior = (ctx.index.packet.prior_years as { return_2024?: { lines?: Record<string, unknown> } }).return_2024?.lines ?? {};
    const rule = (ctx.index.packet.firm as { starter_standards?: { variance_review?: { flag_if_change_over_percent: number; and_over_amount: number } } })
      .starter_standards?.variance_review ?? { flag_if_change_over_percent: 10, and_over_amount: 1000 };
    const out: Finding[] = [];
    for (const [key, py] of Object.entries(prior)) {
      if (key.startsWith('SchB.') || typeof py !== 'number') continue;
      const line = ctx.line(key);
      if (!line || typeof line.value !== 'number') continue;
      const diff = line.value - py;
      const pct = py === 0 ? Infinity : (Math.abs(diff) / Math.abs(py)) * 100;
      if (Math.abs(diff) <= rule.and_over_amount || pct <= rule.flag_if_change_over_percent) continue;
      out.push({
        checkId: 'G7', key, severity: 'info',
        title: `${line.label}: ${formatValue(py)} → ${formatValue(line.value)} (${pct === Infinity ? 'new' : `${diff > 0 ? '+' : ''}${Math.round((diff / Math.abs(py)) * 100)}%`})`,
        refs: [lineRef(ctx.version.version, key), `py:/return_2024/lines/${key}`],
        expected: py, actual: line.value, effect: NO_EFFECT,
        explain: `Changed by more than ${rule.flag_if_change_over_percent}% and ${formatValue(rule.and_over_amount)} from the prior year.`,
        nextAction: 'Record why it changed, or link the finding that explains it.',
      });
    }
    return out;
  },
};

const lowConfidence: Check = {
  id: 'G8', title: 'Low-confidence read', kind: 'generic',
  run(ctx) {
    return ctx.index.packet.extracted_values.filter((e) => e.confidence < 0.9).map((e) => ({
      checkId: 'G8', key: e.id, severity: 'info' as const,
      title: `${e.label} read at confidence ${e.confidence}`,
      refs: [e.id, pageRef(e.document_id, e.page), ...ctx.linesCiting(e.id)],
      actual: formatValue(e.value), effect: NO_EFFECT,
      explain: 'Low confidence is a prompt to look, not evidence of an error: most planted errors were read at 0.97 or higher.',
      nextAction: 'Look at the page and verify the value.',
    }));
  },
};

export const GENERIC_CHECKS: Check[] = [
  valueNotOnPage, duplicatePage, duplicateInterest, summaryVsDetail, documentUse, identityMismatch, variance, lowConfidence,
];
