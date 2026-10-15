import { formatValue } from '../format';
import { lineRef } from '../refs/refs';
import type { Check, Finding } from './types';

interface CallNote { id: string; notes: string[] }
interface Answer { id: string; question: string; answer: string }

const clientOf = (ctx: Parameters<Check['run']>[0]) =>
  ctx.index.packet.client as { call_notes?: CallNote[]; questionnaire?: Answer[] };

const BUSINESS_PCT = /business[^.%]*?(\d+)%|(\d+)%[^.]*?business/i;

const BUSINESS_USE = [
  { fields: /telephone|phone/i, words: /mobile|phone/i },
  { fields: /internet/i, words: /internet/i },
];

const personalUse: Check = {
  id: 'T3', title: 'Personal share of business expenses', kind: 'tax',
  run(ctx) {
    const notes = (clientOf(ctx).call_notes ?? []).flatMap((c) => c.notes.map((text) => ({ id: c.id, text })));
    const out: Finding[] = [];
    const seen = new Set<string>();
    const booksLines = ctx.version.lines.filter((l) => l.form === 'SchC' && l.rule === 'R-BOOKS-LINE');
    for (const line of booksLines) {
      for (const ev of ctx.sourceEvs(line.key)) {
        const rule = BUSINESS_USE.find((r) => r.fields.test(ev.field));
        const note = rule && notes.find((n) => rule.words.test(n.text) && BUSINESS_PCT.test(n.text));
        if (!note || typeof ev.value !== 'number' || seen.has(ev.id)) continue;
        seen.add(ev.id);
        const m = BUSINESS_PCT.exec(note.text)!;
        const pct = Number(m[1] ?? m[2]);
        const personal = Math.round(ev.value * (1 - pct / 100));
        out.push({
          checkId: 'T3', key: ev.id, severity: 'warning',
          title: `${ev.label} ${formatValue(ev.value)} booked at 100%; client says ${pct}% business`,
          refs: [ev.id, lineRef(ctx.version.version, line.key), note.id],
          expected: ev.value - personal, actual: ev.value,
          effect: ctx.rateEffect('schc_profit', personal),
          explain: `"${note.text}"`,
          nextAction: `Deduct ${pct}% and record the client's estimate as the basis for the allocation.`,
        });
      }
    }
    for (const ev of ctx.index.packet.extracted_values) {
      // Only transaction-level detail: a P&L category total is never wholly personal because one note mentions it.
      if (ctx.doc(ev.document_id)?.document_type !== 'books_transaction_detail' || typeof ev.value !== 'number' || seen.has(ev.id)) continue;
      const word = ev.label.split(' ')[0]!;
      const note = notes.find((n) => /personal/i.test(n.text) && word.length > 3 && n.text.includes(word));
      if (!note) continue;
      seen.add(ev.id);
      out.push({
        checkId: 'T3', key: ev.id, severity: 'warning',
        title: `${ev.label} ${formatValue(ev.value)} is personal`,
        refs: [ev.id, note.id, ...ctx.linesCiting(ev.id)],
        expected: 0, actual: ev.value,
        effect: ctx.rateEffect('schc_profit', ev.value),
        explain: `"${note.text}"`,
        nextAction: 'Remove it from business expenses.',
      });
    }
    return out;
  },
};

const seHealthInsurance: Check = {
  id: 'T4', title: 'Self-employed health insurance eligibility', kind: 'tax',
  run(ctx) {
    const line = ctx.line('Sch1.17');
    const qa = (clientOf(ctx).questionnaire ?? []).find((q) => /eligible for health coverage/i.test(q.question));
    if (!line || !qa || !/^yes/i.test(qa.answer) || ctx.num('Sch1.17') <= 0) return [];
    return [{
      checkId: 'T4', key: 'Sch1.17', severity: 'error',
      title: `Self-employed health insurance ${formatValue(line.value)} although spouse's employer coverage was available`,
      refs: [lineRef(ctx.version.version, 'Sch1.17'), qa.id, ...line.sources],
      expected: 0, actual: ctx.num('Sch1.17'),
      effect: ctx.rateEffect('adjustment', -ctx.num('Sch1.17'), 'QBI effect not included'),
      explain: `No deduction for any month the taxpayer was eligible for an employer plan, including a spouse's. Client: "${qa.answer}"`,
      nextAction: 'Remove the deduction; partner sign-off required (effect over 1,000).',
    }];
  },
};

const sepExcess: Check = {
  id: 'T5', title: 'SEP contribution over the limit', kind: 'tax',
  run(ctx) {
    const line = ctx.line('Sch1.16');
    const contributed = ctx.sourceEvs('Sch1.16').find((e) => typeof e.value === 'number');
    if (!line || !contributed || Number(contributed.value) <= ctx.num('Sch1.16')) return [];
    const excess = Number(contributed.value) - ctx.num('Sch1.16');
    return [{
      checkId: 'T5', key: 'Sch1.16', severity: 'warning',
      title: `SEP contribution ${formatValue(contributed.value)} exceeds the ${formatValue(line.value)} limit by ${formatValue(excess)}`,
      refs: [lineRef(ctx.version.version, 'Sch1.16'), contributed.id],
      expected: ctx.num('Sch1.16'), actual: Number(contributed.value),
      effect: { federal: Math.round(excess * 0.1), california: 0, basis: 'direct', note: '10% excise on nondeductible contributions unless withdrawn' },
      explain: 'Only the limit is deductible. The excess stays in the account and draws a 10% excise each year unless withdrawn with earnings.',
      nextAction: 'Tell the client to withdraw the excess with earnings before the extended due date (10-15-2026).',
    }];
  },
};

export const BUSINESS_CHECKS: Check[] = [personalUse, seHealthInsurance, sepExcess];
