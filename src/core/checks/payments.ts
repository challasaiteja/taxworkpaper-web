import { formatValue } from '../format';
import { lineRef } from '../refs/refs';
import type { Check } from './types';

interface Txn { date: string; code: string; description: string; amount: number | string }
interface Agency {
  irs_account_transcript_2025?: { as_of: string; transactions: Txn[] }[];
  ftb_account?: { tax_year_2025_payments?: { amount: number }[] };
}

const federalEstimates: Check = {
  id: 'T10a', title: 'Federal estimated payments vs IRS transcript', kind: 'tax',
  run(ctx) {
    const line = ctx.line('F1040.26');
    const snaps = (ctx.index.packet.tax_agency_records as Agency).irs_account_transcript_2025 ?? [];
    // Use what the IRS showed when this version was computed; later snapshots add extension and balance payments.
    const asOfVersion = ctx.version.computed_at.slice(0, 10);
    const i = snaps.reduce((best, s, k) => (s.as_of <= asOfVersion ? k : best), -1);
    if (!line || i < 0) return [];
    // TC 660/670 are estimated-tax payments; TC 710/716 apply a prior-year overpayment as a credit.
    const credits = snaps[i]!.transactions.filter((t) =>
      typeof t.amount === 'number' &&
      ((['660', '670'].includes(t.code) && /estimated tax/i.test(t.description)) || ['710', '716'].includes(t.code)));
    if (!credits.length) return [];
    const onFile = credits.reduce((s, t) => s + Number(t.amount), 0);
    const claimed = ctx.num('F1040.26');
    if (onFile === claimed) return [];
    return [{
      checkId: 'T10a', key: 'F1040.26', severity: 'error',
      title: `Estimated payments ${formatValue(claimed)} vs ${formatValue(onFile)} on the IRS transcript`,
      refs: [lineRef(ctx.version.version, 'F1040.26'), `agency:/irs_account_transcript_2025/${i}`, ...line.sources],
      expected: onFile, actual: claimed,
      effect: { federal: claimed - onFile, california: 0, basis: 'direct', note: 'Balance due changes 1:1; underpayment penalty may change' },
      explain: `The transcript (as of ${snaps[i]!.as_of}) is the IRS's record of payments received. ${line.note ?? ''}`.trim(),
      nextAction: 'Use the transcript amounts; ask the client for proof of any payment not on it.',
    }];
  },
};

const californiaEstimates: Check = {
  id: 'T10b', title: 'California estimated payments vs FTB account', kind: 'tax',
  run(ctx) {
    const key = ctx.version.lines.find((l) => l.rule === 'R-CA-ESTIMATED-PAYMENTS')?.key;
    if (!key) return [];
    const evs = ctx.sourceEvs(key);
    const wrongYear = evs.filter((e) => /_year$/.test(e.field) && String(e.value) !== String(ctx.taxYear));
    const amounts = wrongYear.flatMap((y) => evs.filter((e) => e.document_id === y.document_id && e.field === y.field.replace(/_year$/, '_amount')));
    const ftb = (ctx.index.packet.tax_agency_records as Agency).ftb_account?.tax_year_2025_payments;
    const removed = amounts.reduce((s, e) => s + Number(e.value), 0);
    if (!removed) return [];
    const claimed = ctx.num(key);
    return [{
      checkId: 'T10b', key, severity: 'error',
      title: `${formatValue(removed)} of California payments were designated to tax year ${wrongYear.map((e) => e.value).join(', ')}`,
      refs: [lineRef(ctx.version.version, key), ...wrongYear.map((e) => e.id), ...amounts.map((e) => e.id), 'agency:/ftb_account'],
      expected: claimed - removed, actual: claimed,
      effect: { federal: 0, california: removed, basis: 'direct', note: 'Refund falls 1:1; the credit sits on the prior year' },
      explain: `The payment confirmation prints the designated tax year.` +
        (ftb ? ` The FTB account shows ${formatValue(ftb.reduce((s, p) => s + p.amount, 0))} for ${ctx.taxYear}.` : ''),
      nextAction: 'Remove it from this year; ask FTB to transfer the credit or claim it on the prior-year account.',
    }];
  },
};

export const PAYMENT_CHECKS: Check[] = [federalEstimates, californiaEstimates];
