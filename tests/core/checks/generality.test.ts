import { describe, expect, it } from 'vitest';
import { BUSINESS_CHECKS } from '../../../src/core/checks/business';
import { makeContext } from '../../../src/core/checks/context';
import { GENERIC_CHECKS } from '../../../src/core/checks/generic';
import { PAYMENT_CHECKS } from '../../../src/core/checks/payments';
import { PROPERTY_CHECKS } from '../../../src/core/checks/property';
import type { Finding } from '../../../src/core/checks/types';
import { buildIndex } from '../../../src/core/graph/index';
import type { Document, ExtractedValue, Line, Packet } from '../../../src/core/packet/types';
import { miniPacket } from '../../fixtures/miniPacket';

const pos = { x0: 0.1, y0: 0.5, x1: 0.3, y1: 0.52 };
const CHECKS = [...GENERIC_CHECKS, ...BUSINESS_CHECKS, ...PROPERTY_CHECKS, ...PAYMENT_CHECKS];

function addDoc(p: Packet, id: string, type: string, issuer: string, text: string) {
  const d: Document = {
    id, title: `${type} ${issuer}`, document_type: type, issuer, belongs_to: 'joint', tax_year: 2025,
    received_at: '2026-02-01T00:00:00Z', uploaded_by: 'client', file_name: `${id}.pdf`, page_count: 1,
    pages: [{ page: 1, printed_content: text }], extraction: { status: 'extracted', values: 1, reason: null },
  };
  p.documents.push(d);
}
function addEv(p: Packet, id: string, doc: string, field: string, label: string, value: unknown, text = String(value)) {
  const e: ExtractedValue = { id, document_id: doc, page: 1, field, label, value, value_type: typeof value === 'number' ? 'money' : 'text', text_as_read: text, position: pos, confidence: 0.99 };
  p.extracted_values.push(e);
}
function addLine(p: Packet, key: string, value: number, sources: string[], extra: Partial<Line> = {}) {
  const [form, ...rest] = key.split('.');
  p.return_versions[0]!.lines.push({ key, jurisdiction: 'federal', form: form!, line: rest.join('.'), label: key, value, rule: 'R-TEST', inputs: [], sources, ...extra });
}
const run = (p: Packet, id: string): Finding[] => CHECKS.find((c) => c.id === id)!.run(makeContext(buildIndex(p)));

describe('T10a reads real transcript codes', () => {
  it('counts TC 660 estimated payments', () => {
    const p = miniPacket();
    p.tax_agency_records = { irs_account_transcript_2025: [{ as_of: '2026-03-01', transactions: [
      { date: '2025-04-15', code: '660', description: 'Estimated tax payment', amount: 3000 },
      { date: '2025-06-15', code: '660', description: 'Estimated tax payment', amount: 3000 },
    ] }] };
    addLine(p, 'F1040.26', 6000, []);
    expect(run(p, 'T10a')).toEqual([]);
  });

  it('stays silent when the transcript shows no estimated payments at all', () => {
    const p = miniPacket();
    p.tax_agency_records = { irs_account_transcript_2025: [{ as_of: '2026-03-01', transactions: [] }] };
    addLine(p, 'F1040.26', 6000, []);
    expect(run(p, 'T10a')).toEqual([]);
  });
});

describe('T7a seller tax credit', () => {
  const setup = (deducted: number) => {
    const p = miniPacket();
    addDoc(p, 'D90', 'closing_statement_buyer', 'Title Co', 'Seller credit for 2025 taxes 600.00');
    addEv(p, 'ev-0900', 'D90', 'tax_credit', 'Seller credit for 2025 taxes', 600, '600.00');
    addDoc(p, 'D91', 'property_tax_receipt', 'County', '2025 taxes paid 1,000.00');
    addEv(p, 'ev-0910', 'D91', 'paid', '2025 taxes paid', 1000, '1,000.00');
    addLine(p, 'SchA.5b', deducted, ['ev-0910']);
    return run(p, 'T7a');
  };
  it('is silent when only the buyer share was deducted', () => {
    expect(setup(400)).toEqual([]);
  });
  it('explains the credit in the right direction when the full bill was deducted', () => {
    const out = setup(1000);
    expect(out).toHaveLength(1);
    expect(out[0]!.explain).toMatch(/seller credited you/i);
    expect(out[0]!.expected).toBe(400);
  });
});

describe('T6 repair vs improvement', () => {
  const setup = (invoice: string, statement: string) => {
    const p = miniPacket();
    addDoc(p, 'D92', 'invoice', 'Acme Plumbing', invoice);
    addDoc(p, 'D93', 'rental_owner_statement', 'PM Co', statement);
    addEv(p, 'ev-0930', 'D93', 'repairs_total', 'Repairs', 5000, '5,000.00');
    addLine(p, 'SchE.14A', 5000, ['ev-0930'], { form: 'SchE', label: 'Repairs' });
    return run(p, 'T6');
  };
  it('ignores ordinary repair invoices that mention a warranty or a replaced part', () => {
    expect(setup('Replaced filter and valve. 2-year warranty. Total 3,000.00', 'Repairs 5,000.00: Acme Plumbing 3,000.00')).toEqual([]);
  });
  it('ignores an improvement invoice that no repairs line includes', () => {
    expect(setup('Installed new water heater unit. Permit #12. Total 3,000.00', 'Repairs 5,000.00: painting 5,000.00')).toEqual([]);
  });
  it('flags an improvement inside a repairs line without inventing a what-if effect', () => {
    const out = setup('Installed new water heater unit. Permit #12. Total 3,000.00', 'Repairs 5,000.00: Acme Plumbing 3,000.00');
    expect(out).toHaveLength(1);
    expect(out[0]!.refs).toEqual(expect.arrayContaining(['D92', 'line:v1/SchE.14A']));
    expect(out[0]!.effect.basis).toBe('none');
  });
});

describe('T3 personal use', () => {
  const p = miniPacket();
  addDoc(p, 'D94', 'books_profit_loss', 'Books', 'Travel 5,000.00 Telephone 1,000.00');
  addEv(p, 'ev-0940', 'D94', 'Travel', 'Travel', 5000, '5,000.00');
  addEv(p, 'ev-0941', 'D94', 'Telephone', 'Telephone', 1000, '1,000.00');
  addLine(p, 'SchC.24a', 5000, ['ev-0940'], { form: 'SchC', rule: 'R-BOOKS-LINE' });
  addLine(p, 'SchC.25', 1000, ['ev-0941'], { form: 'SchC', rule: 'R-BOOKS-LINE' });
  p.client = { call_notes: [{ id: 'call-01', date: '2026-03-26', notes: ['Travel to Lisbon was personal.', 'Phone: personal use about 30%.'] }] };

  it('does not treat a P&L total as personal because a note mentions its category', () => {
    expect(run(p, 'T3').filter((f) => f.key === 'ev-0940')).toEqual([]);
  });
  it('does not read a personal-use percentage as the business share', () => {
    expect(run(p, 'T3').filter((f) => f.key === 'ev-0941')).toEqual([]);
  });
});

describe('G3 duplicate interest', () => {
  const p = miniPacket();
  addEv(p, 'ev-0950', 'D01', 'div', 'Dividends', 50, '50.00');
  addLine(p, 'SchB.5.1', 50, ['ev-0950']);
  it('does not pair an interest line with a dividend line', () => {
    expect(run(p, 'G3')).toEqual([]);
  });
  it('is a warning, not an error, when the payers differ', () => {
    const q = miniPacket();
    addEv(q, 'ev-0951', 'D01', 'int', 'Interest', 50, '50.00');
    addLine(q, 'SchB.1.2', 50, ['ev-0951']);
    const out = run(q, 'G3');
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe('warning');
  });
});
