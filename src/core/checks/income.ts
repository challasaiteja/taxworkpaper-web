import { formatValue } from '../format';
import type { ExtractedValue } from '../packet/types';
import { lineRef } from '../refs/refs';
import { NO_EFFECT, type Check, type Finding } from './types';

const prefixOf = (field: string, suffix: string) => field.slice(0, -suffix.length);

const rsuBasis: Check = {
  id: 'T1', title: 'Stock-compensation basis missing', kind: 'tax',
  run(ctx) {
    const all = ctx.index.packet.extracted_values;
    const wageRsu = all.filter((e) => /RSU/i.test(e.field) && ctx.doc(e.document_id)?.document_type === 'W-2');
    const out: Finding[] = [];
    for (const ev of all) {
      if (!ev.field.endsWith('_basis') || ev.text_as_read !== '' || (ev.value !== 0 && ev.value !== null)) continue;
      const lines = ctx.linesCiting(ev.id).filter((r) => r.includes('/F8949.'));
      if (!lines.length) continue;
      const lot = prefixOf(ev.field, '_basis');
      const fields = new Map(ctx.evsOf(ev.document_id).map((e) => [e.field, e]));
      const acquired = fields.get(`${lot}_acquired`)?.value;
      const term = fields.get(`${lot}_term`)?.value;
      const supp = all.find((e) => e.document_id !== ev.document_id && e.field.endsWith('_acquired') && e.value === acquired);
      if (!supp) continue;
      const basisEv = ctx.evsOf(supp.document_id).find((e) => e.field === `${prefixOf(supp.field, '_acquired')}_adjusted_basis`);
      if (!basisEv || typeof basisEv.value !== 'number') continue;
      out.push({
        checkId: 'T1', key: `${ev.document_id}/${lot}`, severity: 'error',
        title: `Lot ${lot}: basis taken as 0; supplemental statement shows ${formatValue(basisEv.value)}`,
        refs: [ev.id, basisEv.id, supp.id, ...lines, ...wageRsu.map((e) => e.id)],
        expected: basisEv.value, actual: 0,
        effect: ctx.rateEffect(term === 'long' ? 'ltcg' : 'stcg', -basisEv.value),
        explain: 'The broker printed "(not reported)" for a noncovered lot and the pipeline read it as zero. The shares vested as wages already on the W-2, so a zero basis taxes the same income twice.',
        nextAction: `Use the adjusted basis from ${supp.document_id} and adjust the lot (Form 8949 code B).`,
      });
    }
    return out;
  },
};

const receiptsDoubleCount: Check = {
  id: 'T2', title: '1099-K counted on top of book receipts', kind: 'tax',
  run(ctx) {
    const line = ctx.line('SchC.1');
    if (!line) return [];
    const out: Finding[] = [];
    for (const k of ctx.sourceEvs('SchC.1').filter((e) => ctx.doc(e.document_id)?.document_type === '1099-K')) {
      const inside = ctx.index.packet.extracted_values.find((e) =>
        e.document_id !== k.document_id && e.value === k.value && ctx.doc(e.document_id)?.document_type.startsWith('books'));
      if (!inside) continue;
      out.push({
        checkId: 'T2', key: k.id, severity: 'error',
        title: `1099-K ${formatValue(k.value)} is already inside book receipts`,
        refs: [lineRef(ctx.version.version, 'SchC.1'), k.id, inside.id, ...line.sources.filter((s) => s !== k.id)],
        expected: Number(line.value) - Number(k.value), actual: Number(line.value),
        effect: ctx.rateEffect('schc_profit', -Number(k.value)),
        explain: `The books (${inside.document_id}) record the same ${formatValue(k.value)} as receipts, so adding the 1099-K counts it twice.`,
        nextAction: 'Remove the 1099-K amount from gross receipts and keep the reconciliation as evidence.',
      });
    }
    return out;
  },
};

const fxYear: Check = {
  id: 'T9', title: 'Exchange rate from the wrong year', kind: 'tax',
  run(ctx) {
    const fx = (ctx.index.packet.engine_reference as { parameters?: { fx?: Record<string, Record<string, number>> } }).parameters?.fx ?? {};
    const out: Finding[] = [];
    for (const line of ctx.version.lines) {
      for (const src of line.sources) {
        const m = /^ref:fx\.([A-Z]{3})\.(\d{4})_average$/.exec(src);
        if (!m || Number(m[2]) === ctx.taxYear) continue;
        const usedRate = fx[m[1]!]?.[`${m[2]}_average`];
        const rightRate = fx[m[1]!]?.[`${ctx.taxYear}_average`];
        const foreign = ctx.sourceEvs(line.key).find((e) => typeof e.value === 'number');
        if (!usedRate || !rightRate || !foreign) continue;
        const expected = Math.round(Number(foreign.value) / rightRate);
        out.push({
          checkId: 'T9', key: line.key, severity: 'warning',
          title: `${line.label} converted at the ${m[2]} average rate`,
          refs: [lineRef(ctx.version.version, line.key), foreign.id, src, `ref:fx.${m[1]}.${ctx.taxYear}_average`],
          expected, actual: Number(line.value),
          effect: ctx.rateEffect('interest', expected - Number(line.value)),
          explain: `${formatValue(foreign.value)} ${m[1]} ÷ ${usedRate} (${m[2]}) instead of ÷ ${rightRate} (${ctx.taxYear}).`,
          nextAction: `Convert at the ${ctx.taxYear} average rate.`,
        });
      }
    }
    return out;
  },
};

const caWages: Check = {
  id: 'T11', title: 'California-source wages', kind: 'tax',
  run(ctx) {
    const key = ctx.version.lines.find((l) => l.rule === 'R-CA-WAGES-SOURCE')?.key;
    if (!key) return [];
    const box16 = ctx.sourceEvs(key).filter((e) => e.field === 'box16');
    const out: Finding[] = [];
    for (const w of box16) {
      const box1 = ctx.evsOf(w.document_id).find((e) => e.field === 'box1');
      const issuer = ctx.doc(w.document_id)!.issuer;
      // Box 16 above box 1 alone is normal (California taxes HSA contributions); require residency-period evidence.
      const stub = ctx.index.packet.extracted_values.find((e) =>
        /ca_wages/i.test(e.field) && ctx.doc(e.document_id)?.document_type === 'paystub' && ctx.doc(e.document_id)?.issuer === issuer);
      if (!box1 || !stub || Number(stub.value) >= Number(w.value)) continue;
      const actual = ctx.num(key);
      const expected = actual - Number(w.value) + Number(stub.value);
      const f: Finding = {
        checkId: 'T11', key: w.id, severity: 'error',
        title: `${issuer} W-2 reports ${formatValue(w.value)} California wages; the paystub shows ${formatValue(stub.value)} through the move`,
        refs: [lineRef(ctx.version.version, key), w.id, box1.id, stub.id],
        actual, expected,
        effect: ctx.rateEffect('ca_source_income', expected - actual),
        explain: `The employer kept California as the work state after the move. Only wages earned while a California resident (or for California work) are California-source. The ${stub.document_id} paystub shows ${formatValue(stub.value)} through the move date.`,
        nextAction: 'Use the residency-period wages for California and ask the employer for a corrected W-2.',
      };
      out.push(f);
    }
    return out;
  },
};

const transferInLot: Check = {
  id: 'T12', title: 'Transferred-in lot without basis', kind: 'tax',
  run(ctx) {
    const out: Finding[] = [];
    for (const ev of ctx.index.packet.extracted_values) {
      if (!ev.field.endsWith('_acquired') || ev.value !== null) continue;
      const lot = prefixOf(ev.field, '_acquired');
      const lines = ctx.linesCiting(ev.id).filter((r) => r.includes('/F8949.'));
      if (!lines.length) continue;
      const basis: ExtractedValue | undefined = ctx.evsOf(ev.document_id).find((e) => e.field === `${lot}_basis`);
      out.push({
        checkId: 'T12', key: `${ev.document_id}/${lot}`, severity: 'warning',
        title: `Lot ${lot}: no acquisition date${basis?.value == null ? ' and no basis' : ''} (read "${ev.text_as_read}")`,
        refs: [ev.id, ...(basis ? [basis.id] : []), ...lines],
        effect: { ...NO_EFFECT, note: 'Engine used zero basis and short term; real basis lowers the gain' },
        explain: 'The asset was transferred in from another wallet or exchange, so this platform has no cost record. Zero basis overstates the gain.',
        nextAction: 'Ask the client for the purchase record (date and cost) and document it, or keep zero basis as a judgment.',
      });
    }
    return out;
  },
};

export const INCOME_CHECKS: Check[] = [rsuBasis, receiptsDoubleCount, fxYear, caWages, transferInLot];
