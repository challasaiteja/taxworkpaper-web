export interface Position { x0: number; y0: number; x1: number; y1: number }
export interface Page { page: number; printed_content: string }
export interface Document {
  id: string; title: string; document_type: string; issuer: string; belongs_to: string;
  tax_year: number; received_at: string; uploaded_by: string; file_name: string;
  page_count: number; pages: Page[]; marked_corrected?: boolean;
  extraction: { status: 'extracted' | 'partial' | 'not_extracted'; values: number; reason: string | null };
}
export interface ExtractedValue {
  id: string; document_id: string; page: number; field: string; label: string;
  value: unknown; value_type: string; text_as_read: string; position: Position; confidence: number;
}
export interface Line {
  key: string; jurisdiction: 'federal' | 'california'; form: string; line: string; label: string;
  value: number | string | null; rule: string; inputs: string[]; sources: string[]; note?: string | null;
}
export interface Diagnostic { code: string; severity: 'info' | 'warning'; message: string; refs: string[] }
export interface TaxEffectRate { federal_per_dollar: number; california_per_dollar: number }
export interface ReturnVersion {
  version: string; computed_at: string; trigger: string;
  documents_used: string[]; documents_superseded: string[];
  summary: { federal: Record<string, number>; california: Record<string, number> };
  tax_effect_rates: Record<string, TaxEffectRate>;
  carryovers_out: unknown; assets: unknown[]; diagnostics: Diagnostic[];
  changes_from_previous: unknown[]; lines: Line[];
}
export interface TimelineEvent { id: string; at: string; event: string; actor: string | null; detail: unknown; refs: string[] }
export interface Packet {
  packet: { name: string; version: string; generated: string; client_id: string };
  readme: unknown; household: unknown; documents: Document[]; extracted_values: ExtractedValue[];
  client: unknown; firm: unknown; prior_years: unknown; tax_agency_records: unknown;
  timeline: TimelineEvent[]; engine_reference: unknown; return_versions: ReturnVersion[];
  what_if: unknown; planning_reference_2026: unknown; post_filing_rates: unknown; fx_rates: unknown;
}
