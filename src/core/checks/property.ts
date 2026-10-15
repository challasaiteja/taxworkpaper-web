import { formatValue } from '../format';
import { lineRef } from '../refs/refs';
import { NO_EFFECT, type Check, type Finding } from './types';

const IMPROVEMENT_WORDS = /installed new|new [\w-]+(?: [\w-]+)* (?:system|unit)|permit #?\w+/i;

interface WhatIfAlt { id: string; base_version?: string; changed_lines?: { key: string }[] }

const repairVsImprovement: Check = {
  id: 'T6', title: 'Improvement expensed as a repair', kind: 'tax',
  run(ctx) {
    const repairs = ctx.version.lines.filter((l) => l.form === 'SchE' && /repair/i.test(l.label) && typeof l.value === 'number');
    const alts = (ctx.index.packet.what_if as { alternatives?: WhatIfAlt[] } | undefined)?.alternatives ?? [];
    const out: Finding[] = [];
    for (const doc of ctx.index.packet.documents.filter((d) => d.document_type === 'invoice')) {
      const text = doc.pages.map((p) => p.printed_content).join(' ');
      const total = /Total ([\d,]+\.\d{2})/.exec(text);
      const words = IMPROVEMENT_WORDS.exec(text);
      if (!total || !words) continue;
      const amount = Number(total[1]!.replace(/,/g, ''));
      if (amount < 2500) continue;
      // The repairs line must actually include this invoice: its source document names the vendor and amount.
      const vendor = doc.issuer.split(/[ ,]/)[0]!;
      const line = repairs.find((l) => ctx.sourceEvs(l.key).some((e) => {
        const page = ctx.doc(e.document_id)?.pages.find((p) => p.page === e.page)?.printed_content ?? '';
        return page.includes(total[1]!) && page.includes(vendor);
      }));
      if (!line) continue;
      const alt = alts.find((a) => (a.base_version ?? ctx.version.version) === ctx.version.version && a.changed_lines?.some((c) => c.key === line.key));
      out.push({
        checkId: 'T6', key: doc.id, severity: 'warning',
        title: `${doc.issuer} invoice ${formatValue(amount)} looks like an improvement, not a repair`,
        refs: [doc.id, lineRef(ctx.version.version, line.key), ...line.sources],
        actual: Number(line.value), expected: Number(line.value) - amount,
        effect: (alt && ctx.whatIfEffect(alt.id)) ?? { ...NO_EFFECT, note: 'Capitalizing changes depreciation; needs a recompute' },
        explain: `The invoice describes new equipment ("${words[0]}"). Replacing a whole system is a betterment or restoration: capitalize and depreciate.`,
        nextAction: 'Decide repair vs improvement and record the judgment (safe-harbor elections considered).',
      });
    }
    return out;
  },
};

const sellerTaxCredit: Check = {
  id: 'T7a', title: 'Seller-paid property tax deducted', kind: 'tax',
  run(ctx) {
    const line = ctx.line('SchA.5b');
    const credit = ctx.index.packet.extracted_values.find((e) =>
      e.field === 'tax_credit' && ctx.doc(e.document_id)?.document_type === 'closing_statement_buyer' && typeof e.value === 'number');
    if (!line || !credit) return [];
    const bill = ctx.sourceEvs('SchA.5b')
      .filter((e) => ctx.doc(e.document_id)?.document_type === 'property_tax_receipt' && typeof e.value === 'number')
      .reduce((s, e) => s + Number(e.value), 0);
    // Only when the full bill was deducted; a buyer who already deducted their own share is fine.
    if (!bill || ctx.num('SchA.5b') < bill) return [];
    const expected = ctx.num('SchA.5b') - Number(credit.value);
    return [{
      checkId: 'T7a', key: credit.id, severity: 'error',
      title: `Property tax includes the seller's ${formatValue(credit.value)} share`,
      refs: [lineRef(ctx.version.version, 'SchA.5b'), credit.id, ...line.sources],
      expected, actual: ctx.num('SchA.5b'),
      effect: ctx.rateEffect('salt', -Number(credit.value), 'Federal effect is 0 while AMT applies; may cross the SALT cap'),
      explain: `At closing the seller credited you ${formatValue(credit.value)} for their share of the year's tax. You then paid the full bill, but only the tax for your ownership period is deductible.`,
      nextAction: 'Deduct the bill less the seller credit.',
    }];
  },
};

const payoffInterest: Check = {
  id: 'T7b', title: 'Payoff interest counted twice', kind: 'tax',
  run(ctx) {
    const line = ctx.line('SchA.8a');
    if (!line) return [];
    const srcs = ctx.sourceEvs('SchA.8a');
    const out: Finding[] = [];
    for (const payoff of srcs.filter((e) => ctx.doc(e.document_id)?.document_type === 'payoff_statement')) {
      const issuer = ctx.doc(payoff.document_id)!.issuer;
      const form1098 = srcs.find((e) => e.field === 'box1' && ctx.doc(e.document_id)?.document_type === '1098' && ctx.doc(e.document_id)?.issuer === issuer);
      if (!form1098) continue;
      out.push({
        checkId: 'T7b', key: payoff.id, severity: 'error',
        title: `${issuer}: payoff interest ${formatValue(payoff.value)} is already in the 1098`,
        refs: [lineRef(ctx.version.version, 'SchA.8a'), payoff.id, form1098.id],
        expected: ctx.num('SchA.8a') - Number(payoff.value), actual: ctx.num('SchA.8a'),
        effect: ctx.rateEffect('itemized', -Number(payoff.value)),
        explain: `The lender's 1098 box 1 (${formatValue(form1098.value)}) covers all interest received in the year, including the payoff.`,
        nextAction: 'Count the payoff interest once.',
      });
    }
    return out;
  },
};

const vehicleDonation: Check = {
  id: 'T8', title: 'Vehicle donation above the sale price', kind: 'tax',
  run(ctx) {
    const out: Finding[] = [];
    const sold = ctx.index.packet.extracted_values.find((e) => e.field === 'box4c' && ctx.doc(e.document_id)?.document_type === '1098-C');
    if (!sold || typeof sold.value !== 'number') return out;
    for (const line of ctx.version.lines.filter((l) => l.form === 'F8283' && /vehicle/i.test(l.key) && typeof l.value === 'number')) {
      if (Number(line.value) <= sold.value) continue;
      out.push({
        checkId: 'T8', key: line.key, severity: 'error',
        title: `Vehicle deducted at ${formatValue(line.value)}; the charity sold it for ${formatValue(sold.value)}`,
        refs: [lineRef(ctx.version.version, line.key), sold.id, ...line.sources],
        expected: sold.value, actual: Number(line.value),
        effect: ctx.rateEffect('itemized', sold.value - Number(line.value)),
        explain: 'When the charity sells a donated vehicle, the deduction is limited to the gross proceeds on Form 1098-C box 4c, not the owner\'s estimate of value.',
        nextAction: 'Limit the deduction to box 4c and attach the 1098-C.',
      });
    }
    return out;
  },
};

export const PROPERTY_CHECKS: Check[] = [repairVsImprovement, sellerTaxCredit, payoffInterest, vehicleDonation];
