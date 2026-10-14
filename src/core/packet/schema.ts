import { z } from 'zod';

const position = z.object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() });

const document = z.object({
  id: z.string(), title: z.string(), document_type: z.string(), issuer: z.string(),
  belongs_to: z.string(), tax_year: z.number(), received_at: z.string(), uploaded_by: z.string(),
  file_name: z.string(), page_count: z.number().int(),
  pages: z.array(z.object({ page: z.number().int(), printed_content: z.string() })),
  marked_corrected: z.boolean().optional(),
  extraction: z.object({
    status: z.enum(['extracted', 'partial', 'not_extracted']),
    values: z.number().int(), reason: z.string().nullable(),
  }),
});

const extractedValue = z.object({
  id: z.string(), document_id: z.string(), page: z.number().int(), field: z.string(),
  label: z.string(), value: z.unknown(), value_type: z.string(), text_as_read: z.string(),
  position, confidence: z.number(),
});

const line = z.object({
  key: z.string(), jurisdiction: z.enum(['federal', 'california']), form: z.string(),
  line: z.string(), label: z.string(), value: z.union([z.number(), z.string(), z.null()]),
  rule: z.string(), inputs: z.array(z.string()), sources: z.array(z.string()),
  note: z.string().nullish(),
});

const returnVersion = z.object({
  version: z.string(), computed_at: z.string(), trigger: z.string(),
  documents_used: z.array(z.string()), documents_superseded: z.array(z.string()),
  summary: z.object({ federal: z.record(z.string(), z.number()), california: z.record(z.string(), z.number()) }),
  tax_effect_rates: z.record(z.string(), z.object({ federal_per_dollar: z.number(), california_per_dollar: z.number() })),
  diagnostics: z.array(z.object({
    code: z.string(), severity: z.enum(['info', 'warning']), message: z.string(), refs: z.array(z.string()),
  })),
  lines: z.array(line),
});

export const packetSchema = z.object({
  packet: z.object({ name: z.string(), version: z.string(), generated: z.string(), client_id: z.string() }),
  documents: z.array(document).min(1),
  extracted_values: z.array(extractedValue),
  return_versions: z.array(returnVersion).min(1),
  timeline: z.array(z.object({
    id: z.string(), at: z.string(), event: z.string(), actor: z.string().nullable(), refs: z.array(z.string()),
  })),
});
