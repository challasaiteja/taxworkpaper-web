import type { Packet } from '../../src/core/packet/types';

const pos = (y0: number) => ({ x0: 0.1, y0, x1: 0.4, y1: y0 + 0.02 });

export function miniPacket(): Packet {
  return {
    packet: { name: 'Mini', version: '1', generated: '2026-06-23', client_id: 'C-MINI' },
    readme: {}, household: {}, client: {}, firm: {}, prior_years: {}, tax_agency_records: {},
    engine_reference: {}, what_if: {}, planning_reference_2026: {}, post_filing_rates: {}, fx_rates: {},
    documents: [
      { id: 'D01', title: 'W-2 Acme', document_type: 'W-2', issuer: 'Acme', belongs_to: 'taxpayer', tax_year: 2025,
        received_at: '2026-02-01T10:00:00Z', uploaded_by: 'client', file_name: 'w2.pdf', page_count: 1,
        pages: [{ page: 1, printed_content: 'Box 1 Wages 1,000.00 Box 2 Federal tax withheld 100.00 Hired 2025-02-15 Retirement plan [ ]' }],
        extraction: { status: 'extracted', values: 2, reason: null } },
      { id: 'D02', title: '1099-INT Bank', document_type: '1099-INT', issuer: 'Bank', belongs_to: 'joint', tax_year: 2025,
        received_at: '2026-03-10T10:00:00Z', uploaded_by: 'client', file_name: 'int.pdf', page_count: 2,
        marked_corrected: true,
        pages: [{ page: 1, printed_content: 'Cover page' },
                { page: 2, printed_content: 'Interest 50.00 and again 50.00' }],
        extraction: { status: 'partial', values: 2, reason: 'page 1 skipped' } },
      { id: 'D03', title: 'Brokerage 1099-B', document_type: '1099-B', issuer: 'Broker', belongs_to: 'joint', tax_year: 2025,
        received_at: '2026-02-20T10:00:00Z', uploaded_by: 'client', file_name: 'b.pdf', page_count: 1,
        pages: [{ page: 1, printed_content: 'Lot A basis 19,100.00 Lot B basis 19,100.00 Total 38,200.00 Box 12 code W 2,500.00 Prior AGI 228,409.0; CA share 22%' }],
        extraction: { status: 'extracted', values: 5, reason: null } },
    ],
    extracted_values: [
      { id: 'ev-0001', document_id: 'D01', page: 1, field: 'box1', label: 'Wages', value: 1000, value_type: 'money', text_as_read: '1,000.00', position: pos(0.1), confidence: 0.99 },
      { id: 'ev-0002', document_id: 'D01', page: 1, field: 'box2', label: 'Federal withholding', value: 100, value_type: 'money', text_as_read: '100.00', position: pos(0.2), confidence: 0.99 },
      { id: 'ev-0005', document_id: 'D01', page: 1, field: 'hired', label: 'Hire date', value: '2025-02-15', value_type: 'date', text_as_read: '02/15/2025', position: pos(0.6), confidence: 0.99 },
      { id: 'ev-0006', document_id: 'D01', page: 1, field: 'box13_retirement', label: 'Retirement plan', value: true, value_type: 'boolean', text_as_read: 'X', position: pos(0.8), confidence: 0.99 },
      { id: 'ev-0003', document_id: 'D02', page: 2, field: 'box1', label: 'Interest', value: 50, value_type: 'money', text_as_read: '50.00', position: pos(0.9), confidence: 0.98 },
      { id: 'ev-0004', document_id: 'D02', page: 2, field: 'basis', label: 'Basis', value: 0, value_type: 'money', text_as_read: '', position: pos(0.5), confidence: 0.98 },
      { id: 'ev-0010', document_id: 'D03', page: 1, field: 'A_basis', label: 'Lot A basis', value: 19100, value_type: 'money', text_as_read: '19100.00', position: pos(0.70), confidence: 0.99 },
      { id: 'ev-0011', document_id: 'D03', page: 1, field: 'B_basis', label: 'Lot B basis', value: 19100, value_type: 'money', text_as_read: '19100.00', position: pos(0.75), confidence: 0.99 },
      { id: 'ev-0012', document_id: 'D03', page: 1, field: 'box10', label: 'Dependent care benefits', value: 0, value_type: 'money', text_as_read: '0.00', position: pos(0.9), confidence: 0.99 },
      { id: 'ev-0013', document_id: 'D03', page: 1, field: 'total', label: 'Total basis', value: 38200, value_type: 'money', text_as_read: '38,200.00', position: pos(0.5), confidence: 0.99 },
      { id: 'ev-0015', document_id: 'D03', page: 1, field: 'prior_agi', label: 'Prior AGI', value: 228409, value_type: 'money', text_as_read: '228,409.00', position: pos(0.95), confidence: 0.99 },
      { id: 'ev-0016', document_id: 'D03', page: 1, field: 'ca_share', label: 'CA share', value: 0.22, value_type: 'percent', text_as_read: '0.22', position: pos(0.97), confidence: 0.99 },
      { id: 'ev-0014', document_id: 'D03', page: 1, field: 'total_summary', label: 'Summary total', value: 38200, value_type: 'money', text_as_read: '38,200.00', position: pos(0.6), confidence: 0.99 },
    ],
    return_versions: [{
      version: 'v1', computed_at: '2026-03-04T09:00:00Z', trigger: 'first run',
      documents_used: ['D01', 'D02'], documents_superseded: [],
      summary: { federal: { agi: 1050 }, california: { total_agi: 1050 } },
      tax_effect_rates: { wages: { federal_per_dollar: 0.22, california_per_dollar: 0.09 } },
      carryovers_out: {}, assets: [], diagnostics: [], changes_from_previous: [],
      lines: [
        { key: 'F1040.1a', jurisdiction: 'federal', form: 'F1040', line: '1a', label: 'Wages', value: 1000, rule: 'R-W2-BOX1-SUM', inputs: [], sources: ['ev-0001'] },
        { key: 'SchB.1.1', jurisdiction: 'federal', form: 'SchB', line: '1.1', label: 'Interest - Bank', value: 50, rule: 'R-INTEREST-PAYER', inputs: [], sources: ['ev-0003'] },
        { key: 'F1040.11', jurisdiction: 'federal', form: 'F1040', line: '11', label: 'Adjusted gross income', value: 1050, rule: 'R-SUM', inputs: ['F1040.1a', 'SchB.1.1', 'F1040.1a'], sources: [] },
      ],
    }],
    timeline: [{ id: 'tl-01', at: '2026-03-02T22:15:00Z', event: 'client_marked_upload_complete', actor: null, detail: null, refs: [] }],
  };
}
