# Plan 1 — Foundation and Trace (spec build steps 1–2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running app that loads the packet (bundled or uploaded), validates it, indexes it into a graph, shows every document as a simulated page with highlighted extracted values, and opens a trace drawer from any return line or value down to the exact highlighted field on its source page.

**Architecture:** Pure TypeScript core (`src/core`: packet, refs, graph, views) with no React or browser imports; ports (`src/ports`) define PacketSource and DocumentSource; adapters (`src/adapters`) implement them for the PoC (fetch/File, simulated pages); React UI (`src/ui`) reads a single zustand store. Hash routing makes every Ref a URL.

**Tech Stack:** Vite 8, React 19, TypeScript ~5.9, zustand 5, zod 4, Tailwind 4 (`@tailwindcss/vite`), Vitest 5 + Testing Library + jsdom.

**Spec:** `docs/superpowers/specs/2026-10-14-tax-workpaper-design.md`

## Global Constraints

- The packet is never mutated; validation must not strip fields (validate, then keep the original object).
- `src/core/**` must not import `react`, `react-dom`, `zustand`, `idb`, or anything from `src/ui`, `src/adapters` (enforced by a test).
- Packet file lives at `public/packet.json` and is **gitignored**; it is included only at deploy time.
- Tests that need the real packet use `describe.skipIf(!hasRealPacket)`; every behavior is also covered by the mini fixture so a fresh clone passes.
- Refs: `D28`, `D28#page3`, `ev-0498`, `line:v3/F1040.1a`, plus packet formats (`qa-NN`, `msg-NN`, `call-NN`, `asset:`, `household:`, `py:/`, `agency:/`, `timeline:`, `ref:`), and `group:`, `ext:`, `finding:`, `area:`.
- Highlights are located by `text_as_read` in `printed_content` (printed form, e.g. `02/15/2025`, `19,240.00`), not by `value`. Empty `text_as_read` = "not printed on page" and must be shown as such.
- No git commits by the agent. Each task ends with a **checkpoint** where the user reviews and commits.
- No LLM at runtime. No grid/table library.

## Review Focus

1. **Uploading a non-packet JSON or malformed file** → a readable error naming the failing path; the app must not white-screen. (Test in Task 2 and Task 6.)
2. **A value whose printed text appears several times on a page** (e.g. "400" or "50.00") → highlight the occurrence nearest the value's `position.y0`, not always the first. (Test in Task 5.)
3. **A value with empty `text_as_read`** (e.g. RSU basis ev-0498) → rendered as "not printed on this page", never silently highlighted somewhere. (Test in Task 5.)
4. **Trace of a line whose inputs form a deep tree** (e.g. `F1040.11`) → upstream walk terminates and does not loop on repeated refs. (Test in Task 4.)
5. **Deep link to an unknown ref** (`#/?trace=ev-9999`) → drawer shows "Unknown reference", not a crash. (Test in Task 8.)

---

## File Structure

```
package.json, tsconfig.json, vite.config.ts, vitest.config.ts, index.html, .gitignore
public/packet.json                         (gitignored; copied from ~/Downloads)
src/main.tsx                               React entry
src/index.css                              Tailwind import
src/core/packet/types.ts                   Packet TypeScript types
src/core/packet/schema.ts                  zod schema (validation only)
src/core/packet/load.ts                    loadPacket(json) → result; fingerprint
src/core/refs/refs.ts                      parseRef / lineRef / pageRef
src/core/graph/index.ts                    buildIndex, upstream, consumersOf, landingsOfDocument
src/core/views/documents.ts                documentSummaries
src/core/format.ts                         formatValue
src/ports/PacketSource.ts                  interface
src/ports/DocumentSource.ts                interface + Highlight types
src/adapters/packetSources.ts              BundledPacketSource, FilePacketSource
src/adapters/SimulatedDocumentSource.ts    page text + highlight spans
src/ui/store.ts                            zustand store
src/ui/router.ts                           parseHash / buildHash / useRoute
src/ui/App.tsx                             frame: top bar, nav, screen, drawer
src/ui/components/PageText.tsx             renders page text with highlights
src/ui/screens/ReturnScreen.tsx            v3 lines grouped by form (temporary; replaced by area pages in Plan 3)
src/ui/screens/DocumentsScreen.tsx         index + viewer
src/ui/trace/TraceDrawer.tsx               trace for line / ev / doc refs
tests/fixtures/miniPacket.ts               small valid packet
tests/fixtures/realPacket.ts               hasRealPacket + loader
tests/core/*.test.ts, tests/ui/*.test.tsx
```

---

### Task 1: Scaffold the project

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `.gitignore`, `src/main.tsx`, `src/index.css`, `src/ui/App.tsx` (placeholder), `tests/core/boundaries.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run dev`, `npm test`, `npm run build`, `npm run typecheck` scripts.

- [ ] **Step 1: Write config files**

`package.json`:
```json
{
  "name": "taxworkpaper-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "types": ["vite/client", "node"]
  },
  "include": ["src", "tests", "vite.config.ts", "vitest.config.ts"]
}
```

`vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({ plugins: [react(), tailwindcss()] });
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: { environment: 'node', include: ['tests/**/*.test.{ts,tsx}'] },
});
```

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Tax Workpaper</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`.gitignore`:
```
node_modules
dist
public/packet.json
*.local
.DS_Store
```

`src/index.css`:
```css
@import "tailwindcss";
```

`src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './ui/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`src/ui/App.tsx` (placeholder, replaced in Task 6):
```tsx
export function App() {
  return <div className="p-6 text-lg">Tax Workpaper</div>;
}
```

- [ ] **Step 2: Install dependencies and copy the packet**

```bash
cd /Users/saitejachalla/taxworkpaper-web
npm install react react-dom zustand zod
npm install -D vite @vitejs/plugin-react typescript@~5.9.0 @types/react @types/react-dom @types/node tailwindcss @tailwindcss/vite vitest @testing-library/react @testing-library/dom jsdom
mkdir -p public && cp ~/Downloads/okafor_lindqvist_2025_packet.json public/packet.json
```

- [ ] **Step 3: Write the core-boundary test**

`tests/core/boundaries.test.ts`:
```ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const FORBIDDEN = [/from ['"]react/, /from ['"]zustand/, /from ['"]idb/, /from ['"].*\/(ui|adapters)\//];

describe('core boundaries', () => {
  it('src/core imports no UI, store, storage or adapter code', () => {
    const offenders = files('src/core').filter((f) =>
      FORBIDDEN.some((re) => re.test(readFileSync(f, 'utf8'))),
    );
    expect(offenders).toEqual([]);
  });
});
```

`src/core` must exist for the test: create `src/core/format.ts`:
```ts
export function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}
```

- [ ] **Step 4: Run checks**

Run: `npm test && npm run typecheck && npm run build`
Expected: 1 test passes; typecheck clean; `dist/` built. `npm run dev` shows "Tax Workpaper".

- [ ] **Step 5: Checkpoint** — user reviews and commits (packet must show as ignored in `git status`).

---

### Task 2: Packet types, validation and fingerprint

**Files:**
- Create: `src/core/packet/types.ts`, `src/core/packet/schema.ts`, `src/core/packet/load.ts`, `tests/fixtures/miniPacket.ts`, `tests/fixtures/realPacket.ts`
- Test: `tests/core/packet.test.ts`

**Interfaces:**
- Produces:
  - Types `Packet, Document, Page, ExtractedValue, Position, Line, ReturnVersion, Diagnostic, TimelineEvent`.
  - `loadPacket(json: unknown): LoadResult` where `type LoadResult = { ok: true; packet: Packet; fingerprint: string } | { ok: false; error: string }`.
  - `fingerprintOf(text: string): string` (16 hex chars).
  - `miniPacket(): Packet` fixture; `hasRealPacket: boolean`, `readRealPacket(): unknown`.

- [ ] **Step 1: Write types**

`src/core/packet/types.ts`:
```ts
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
```

- [ ] **Step 2: Write fixtures**

`tests/fixtures/miniPacket.ts`:
```ts
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
        pages: [{ page: 1, printed_content: 'Box 1 Wages 1,000.00 Box 2 Federal tax withheld 100.00' }],
        extraction: { status: 'extracted', values: 2, reason: null } },
      { id: 'D02', title: '1099-INT Bank', document_type: '1099-INT', issuer: 'Bank', belongs_to: 'joint', tax_year: 2025,
        received_at: '2026-03-10T10:00:00Z', uploaded_by: 'client', file_name: 'int.pdf', page_count: 2,
        marked_corrected: true,
        pages: [{ page: 1, printed_content: 'Cover page' },
                { page: 2, printed_content: 'Interest 50.00 and again 50.00' }],
        extraction: { status: 'partial', values: 2, reason: 'page 1 skipped' } },
    ],
    extracted_values: [
      { id: 'ev-0001', document_id: 'D01', page: 1, field: 'box1', label: 'Wages', value: 1000, value_type: 'money', text_as_read: '1,000.00', position: pos(0.1), confidence: 0.99 },
      { id: 'ev-0002', document_id: 'D01', page: 1, field: 'box2', label: 'Federal withholding', value: 100, value_type: 'money', text_as_read: '100.00', position: pos(0.2), confidence: 0.99 },
      { id: 'ev-0003', document_id: 'D02', page: 2, field: 'box1', label: 'Interest', value: 50, value_type: 'money', text_as_read: '50.00', position: pos(0.9), confidence: 0.98 },
      { id: 'ev-0004', document_id: 'D02', page: 2, field: 'basis', label: 'Basis', value: 0, value_type: 'money', text_as_read: '', position: pos(0.5), confidence: 0.98 },
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
```
(`F1040.11` lists `F1040.1a` twice on purpose — Review Focus 4.)

`tests/fixtures/realPacket.ts`:
```ts
import { existsSync, readFileSync } from 'node:fs';

export const REAL_PACKET_PATH = 'public/packet.json';
export const hasRealPacket = existsSync(REAL_PACKET_PATH);
export function readRealPacket(): unknown {
  return JSON.parse(readFileSync(REAL_PACKET_PATH, 'utf8'));
}
```

- [ ] **Step 3: Write the failing tests**

`tests/core/packet.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { fingerprintOf, loadPacket } from '../../src/core/packet/load';
import { miniPacket } from '../fixtures/miniPacket';
import { hasRealPacket, readRealPacket } from '../fixtures/realPacket';

describe('loadPacket', () => {
  it('accepts a valid packet and keeps the original object (no stripping)', () => {
    const raw = { ...miniPacket(), extra_section: { keep: true } };
    const r = loadPacket(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.packet).toBe(raw);
      expect(r.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it('rejects non-packet JSON with a readable path', () => {
    const r = loadPacket({ hello: 'world' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/documents/);
  });

  it('rejects a packet with a malformed extracted value', () => {
    const p = miniPacket() as unknown as { extracted_values: Record<string, unknown>[] };
    p.extracted_values[0]!.confidence = 'high';
    const r = loadPacket(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/extracted_values\.0\.confidence/);
  });

  it('fingerprint is stable and content-sensitive', () => {
    expect(fingerprintOf('abc')).toBe(fingerprintOf('abc'));
    expect(fingerprintOf('abc')).not.toBe(fingerprintOf('abd'));
  });
});

describe.skipIf(!hasRealPacket)('real packet', () => {
  it('loads with expected counts', () => {
    const r = loadPacket(readRealPacket());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.packet.documents).toHaveLength(74);
      expect(r.packet.extracted_values).toHaveLength(3012);
      expect(r.packet.return_versions.map((v) => v.version)).toEqual(['v1', 'v2', 'v3']);
    }
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npx vitest run tests/core/packet.test.ts`
Expected: FAIL — cannot resolve `../../src/core/packet/load`.

- [ ] **Step 5: Implement schema and loader**

`src/core/packet/schema.ts`:
```ts
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
```

`src/core/packet/load.ts`:
```ts
import { packetSchema } from './schema';
import type { Packet } from './types';

export type LoadResult = { ok: true; packet: Packet; fingerprint: string } | { ok: false; error: string };

// cyrb53: fast, well-distributed 53-bit string hash; not cryptographic.
export function fingerprintOf(text: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

export function loadPacket(json: unknown): LoadResult {
  const parsed = packetSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue ? issue.path.join('.') : '(root)';
    return { ok: false, error: `Not a valid packet: ${path || '(root)'} — ${issue?.message ?? 'invalid'}` };
  }
  return { ok: true, packet: json as Packet, fingerprint: fingerprintOf(JSON.stringify(json)) };
}
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/core/packet.test.ts`
Expected: PASS (5 tests; real-packet test runs because `public/packet.json` exists).

- [ ] **Step 7: Checkpoint** — user reviews and commits.

---

### Task 3: Refs

**Files:**
- Create: `src/core/refs/refs.ts`
- Test: `tests/core/refs.test.ts`

**Interfaces:**
- Produces:
  - `type Ref = string`
  - `type ParsedRef = { kind: 'doc'; docId: string } | { kind: 'page'; docId: string; page: number } | { kind: 'ev'; id: string } | { kind: 'line'; version: string; key: string } | { kind: 'client'; id: string } | { kind: 'prefixed'; prefix: 'asset' | 'household' | 'py' | 'agency' | 'timeline' | 'ref' | 'group' | 'ext' | 'finding' | 'area'; rest: string } | { kind: 'unknown'; raw: string }`
  - `parseRef(ref: string): ParsedRef`, `lineRef(version: string, key: string): Ref`, `pageRef(docId: string, page: number): Ref`

- [ ] **Step 1: Write the failing test**

`tests/core/refs.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { lineRef, pageRef, parseRef } from '../../src/core/refs/refs';

describe('parseRef', () => {
  it.each([
    ['D28', { kind: 'doc', docId: 'D28' }],
    ['D28#page3', { kind: 'page', docId: 'D28', page: 3 }],
    ['doc:D30#page32', { kind: 'page', docId: 'D30', page: 32 }],
    ['ev-0498', { kind: 'ev', id: 'ev-0498' }],
    ['line:v3/F1040.1a', { kind: 'line', version: 'v3', key: 'F1040.1a' }],
    ['qa-25', { kind: 'client', id: 'qa-25' }],
    ['msg-07', { kind: 'client', id: 'msg-07' }],
    ['call-01', { kind: 'client', id: 'call-01' }],
    ['py:/return_2024/lines/F8606.14', { kind: 'prefixed', prefix: 'py', rest: '/return_2024/lines/F8606.14' }],
    ['asset:SAC-BLDG', { kind: 'prefixed', prefix: 'asset', rest: 'SAC-BLDG' }],
    ['ref:fx.SEK.2024_average', { kind: 'prefixed', prefix: 'ref', rest: 'fx.SEK.2024_average' }],
    ['timeline:extension-2026-04-14', { kind: 'prefixed', prefix: 'timeline', rest: 'extension-2026-04-14' }],
    ['nonsense', { kind: 'unknown', raw: 'nonsense' }],
  ])('%s', (input, expected) => {
    expect(parseRef(input)).toEqual(expected);
  });

  it('formats line and page refs round-trip', () => {
    expect(parseRef(lineRef('v3', 'SchB.1.1'))).toEqual({ kind: 'line', version: 'v3', key: 'SchB.1.1' });
    expect(pageRef('D23', 3)).toBe('D23#page3');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/core/refs.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`src/core/refs/refs.ts`:
```ts
export type Ref = string;

const PREFIXES = ['asset', 'household', 'py', 'agency', 'timeline', 'ref', 'group', 'ext', 'finding', 'area'] as const;
type Prefix = (typeof PREFIXES)[number];

export type ParsedRef =
  | { kind: 'doc'; docId: string }
  | { kind: 'page'; docId: string; page: number }
  | { kind: 'ev'; id: string }
  | { kind: 'line'; version: string; key: string }
  | { kind: 'client'; id: string }
  | { kind: 'prefixed'; prefix: Prefix; rest: string }
  | { kind: 'unknown'; raw: string };

export function parseRef(ref: string): ParsedRef {
  const page = /^(?:doc:)?(D\d{2})#page(\d+)$/.exec(ref);
  if (page) return { kind: 'page', docId: page[1]!, page: Number(page[2]) };
  if (/^D\d{2}$/.test(ref)) return { kind: 'doc', docId: ref };
  if (/^ev-\d+$/.test(ref)) return { kind: 'ev', id: ref };
  if (/^(qa|msg|call)-\d+$/.test(ref)) return { kind: 'client', id: ref };
  const line = /^line:([^/]+)\/(.+)$/.exec(ref);
  if (line) return { kind: 'line', version: line[1]!, key: line[2]! };
  const colon = ref.indexOf(':');
  if (colon > 0) {
    const prefix = ref.slice(0, colon);
    if ((PREFIXES as readonly string[]).includes(prefix)) {
      return { kind: 'prefixed', prefix: prefix as Prefix, rest: ref.slice(colon + 1) };
    }
  }
  return { kind: 'unknown', raw: ref };
}

export const lineRef = (version: string, key: string): Ref => `line:${version}/${key}`;
export const pageRef = (docId: string, page: number): Ref => `${docId}#page${page}`;
```

- [ ] **Step 4: Run tests** — `npx vitest run tests/core/refs.test.ts` — Expected: PASS.

- [ ] **Step 5: Checkpoint** — user reviews and commits.

---

### Task 4: Graph index

**Files:**
- Create: `src/core/graph/index.ts`
- Test: `tests/core/graph.test.ts`

**Interfaces:**
- Consumes: `Packet`, `Line`, `ExtractedValue`, `Document` (Task 2); `Ref`, `lineRef`, `pageRef` (Task 3).
- Produces:
  - `interface PacketIndex { packet: Packet; docs: Map<string, Document>; evs: Map<string, ExtractedValue>; evsByPage: Map<Ref, ExtractedValue[]>; versions: Map<string, ReturnVersion>; lines: Map<Ref, Line & { version: string }>; consumers: Map<Ref, Ref[]>; latest: string }`
  - `buildIndex(packet: Packet): PacketIndex`
  - `consumersOf(index: PacketIndex, ref: Ref): Ref[]` — line refs citing `ref` as source or input
  - `upstream(index: PacketIndex, ref: Ref): Ref[]` — every line and source reachable from `ref`, excluding `ref`, no duplicates
  - `inputRefs(index: PacketIndex, ref: Ref): Ref[]` and `sourceRefs(index: PacketIndex, ref: Ref): Ref[]` — direct children of a line
  - `landingsOfDocument(index: PacketIndex, docId: string, version?: string): { ev: ExtractedValue; lines: Ref[] }[]`

- [ ] **Step 1: Write the failing test**

`tests/core/graph.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildIndex, consumersOf, inputRefs, landingsOfDocument, sourceRefs, upstream } from '../../src/core/graph/index';
import { loadPacket } from '../../src/core/packet/load';
import { miniPacket } from '../fixtures/miniPacket';
import { hasRealPacket, readRealPacket } from '../fixtures/realPacket';

const idx = buildIndex(miniPacket());

describe('graph index', () => {
  it('indexes lines by versioned ref and knows the latest version', () => {
    expect(idx.latest).toBe('v1');
    expect(idx.lines.get('line:v1/F1040.11')?.value).toBe(1050);
    expect(idx.evsByPage.get('D02#page2')?.map((e) => e.id)).toEqual(['ev-0003', 'ev-0004']);
  });

  it('lists direct inputs (deduplicated) and sources', () => {
    expect(inputRefs(idx, 'line:v1/F1040.11')).toEqual(['line:v1/F1040.1a', 'line:v1/SchB.1.1']);
    expect(sourceRefs(idx, 'line:v1/F1040.1a')).toEqual(['ev-0001']);
  });

  it('walks upstream without duplicates even when an input repeats', () => {
    expect(upstream(idx, 'line:v1/F1040.11').sort()).toEqual(
      ['ev-0001', 'ev-0003', 'line:v1/F1040.1a', 'line:v1/SchB.1.1'].sort(),
    );
  });

  it('finds consumers of a source and of a line', () => {
    expect(consumersOf(idx, 'ev-0001')).toEqual(['line:v1/F1040.1a']);
    expect(consumersOf(idx, 'line:v1/F1040.1a')).toEqual(['line:v1/F1040.11']);
  });

  it('reports where each value of a document landed, including nowhere', () => {
    const l = landingsOfDocument(idx, 'D02');
    expect(l.map((x) => [x.ev.id, x.lines])).toEqual([
      ['ev-0003', ['line:v1/SchB.1.1']],
      ['ev-0004', []],
    ]);
  });
});

describe.skipIf(!hasRealPacket)('graph on real packet', () => {
  it('traces AGI to wage sources and terminates', () => {
    const r = loadPacket(readRealPacket());
    if (!r.ok) throw new Error(r.error);
    const real = buildIndex(r.packet);
    expect(real.latest).toBe('v3');
    const up = upstream(real, 'line:v3/F1040.11');
    expect(up).toContain('line:v3/F1040.1a');
    expect(up).toContain('ev-0016');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/core/graph.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`src/core/graph/index.ts`:
```ts
import type { Document, ExtractedValue, Line, Packet, ReturnVersion } from '../packet/types';
import { lineRef, pageRef, parseRef, type Ref } from '../refs/refs';

export interface PacketIndex {
  packet: Packet;
  docs: Map<string, Document>;
  evs: Map<string, ExtractedValue>;
  evsByPage: Map<Ref, ExtractedValue[]>;
  versions: Map<string, ReturnVersion>;
  lines: Map<Ref, Line & { version: string }>;
  consumers: Map<Ref, Ref[]>;
  latest: string;
}

function push(map: Map<Ref, Ref[]>, key: Ref, value: Ref) {
  const list = map.get(key);
  if (!list) map.set(key, [value]);
  else if (!list.includes(value)) list.push(value);
}

export function buildIndex(packet: Packet): PacketIndex {
  const docs = new Map(packet.documents.map((d) => [d.id, d]));
  const evs = new Map(packet.extracted_values.map((e) => [e.id, e]));
  const evsByPage = new Map<Ref, ExtractedValue[]>();
  for (const e of packet.extracted_values) {
    const key = pageRef(e.document_id, e.page);
    const list = evsByPage.get(key);
    if (list) list.push(e);
    else evsByPage.set(key, [e]);
  }
  const versions = new Map(packet.return_versions.map((v) => [v.version, v]));
  const lines = new Map<Ref, Line & { version: string }>();
  const consumers = new Map<Ref, Ref[]>();
  for (const v of packet.return_versions) {
    for (const l of v.lines) {
      const ref = lineRef(v.version, l.key);
      lines.set(ref, { ...l, version: v.version });
      for (const input of l.inputs) push(consumers, lineRef(v.version, input), ref);
      for (const source of l.sources) push(consumers, source, ref);
    }
  }
  const latest = packet.return_versions[packet.return_versions.length - 1]!.version;
  return { packet, docs, evs, evsByPage, versions, lines, consumers, latest };
}

export function inputRefs(index: PacketIndex, ref: Ref): Ref[] {
  const line = index.lines.get(ref);
  if (!line) return [];
  return [...new Set(line.inputs.map((k) => lineRef(line.version, k)))];
}

export function sourceRefs(index: PacketIndex, ref: Ref): Ref[] {
  return [...new Set(index.lines.get(ref)?.sources ?? [])];
}

export function consumersOf(index: PacketIndex, ref: Ref): Ref[] {
  return index.consumers.get(ref) ?? [];
}

export function upstream(index: PacketIndex, ref: Ref): Ref[] {
  const seen = new Set<Ref>();
  const stack = [ref];
  while (stack.length) {
    const current = stack.pop()!;
    for (const next of [...inputRefs(index, current), ...sourceRefs(index, current)]) {
      if (next === ref || seen.has(next)) continue;
      seen.add(next);
      if (parseRef(next).kind === 'line') stack.push(next);
    }
  }
  return [...seen];
}

export function landingsOfDocument(index: PacketIndex, docId: string, version = index.latest) {
  return index.packet.extracted_values
    .filter((e) => e.document_id === docId)
    .map((ev) => ({
      ev,
      lines: consumersOf(index, ev.id).filter((r) => r.startsWith(`line:${version}/`)),
    }));
}
```

- [ ] **Step 4: Run tests** — `npx vitest run tests/core/graph.test.ts` — Expected: PASS.

- [ ] **Step 5: Checkpoint** — user reviews and commits.

---

### Task 5: Ports and adapters (packet sources, simulated documents)

**Files:**
- Create: `src/ports/PacketSource.ts`, `src/ports/DocumentSource.ts`, `src/adapters/packetSources.ts`, `src/adapters/SimulatedDocumentSource.ts`
- Test: `tests/core/documentSource.test.ts`

**Interfaces:**
- Consumes: `PacketIndex` (Task 4), `ExtractedValue` (Task 2), `pageRef` (Task 3).
- Produces:
  - `interface PacketSource { label: string; load(): Promise<unknown> }`
  - `class BundledPacketSource implements PacketSource` (ctor `url = '/packet.json'`), `class FilePacketSource implements PacketSource` (ctor `file: File`)
  - `interface Highlight { ev: ExtractedValue; span: { start: number; end: number } | null }` (`null` = not found on page / not printed)
  - `interface PageView { docId: string; page: number; text: string; highlights: Highlight[] }`
  - `interface DocumentSource { getPage(docId: string, page: number): PageView | null }`
  - `class SimulatedDocumentSource implements DocumentSource` (ctor `index: PacketIndex`)

- [ ] **Step 1: Write the failing test**

`tests/core/documentSource.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { SimulatedDocumentSource } from '../../src/adapters/SimulatedDocumentSource';
import { buildIndex } from '../../src/core/graph/index';
import { miniPacket } from '../fixtures/miniPacket';

const src = new SimulatedDocumentSource(buildIndex(miniPacket()));

describe('SimulatedDocumentSource', () => {
  it('locates printed text of each value on the page', () => {
    const view = src.getPage('D01', 1)!;
    const h = view.highlights.find((x) => x.ev.id === 'ev-0001')!;
    expect(view.text.slice(h.span!.start, h.span!.end)).toBe('1,000.00');
  });

  it('picks the occurrence nearest the value position when text repeats', () => {
    const view = src.getPage('D02', 2)!;
    const h = view.highlights.find((x) => x.ev.id === 'ev-0003')!;
    expect(h.span!.start).toBe(view.text.lastIndexOf('50.00'));
  });

  it('marks values with empty text_as_read as not printed (span null)', () => {
    const view = src.getPage('D02', 2)!;
    expect(view.highlights.find((x) => x.ev.id === 'ev-0004')!.span).toBeNull();
  });

  it('returns null for an unknown page', () => {
    expect(src.getPage('D99', 1)).toBeNull();
    expect(src.getPage('D01', 5)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/core/documentSource.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement ports**

`src/ports/PacketSource.ts`:
```ts
export interface PacketSource {
  label: string;
  load(): Promise<unknown>;
}
```

`src/ports/DocumentSource.ts`:
```ts
import type { ExtractedValue } from '../core/packet/types';

export interface Highlight {
  ev: ExtractedValue;
  span: { start: number; end: number } | null;
}

export interface PageView {
  docId: string;
  page: number;
  text: string;
  highlights: Highlight[];
}

export interface DocumentSource {
  getPage(docId: string, page: number): PageView | null;
}
```

- [ ] **Step 4: Implement adapters**

`src/adapters/packetSources.ts`:
```ts
import type { PacketSource } from '../ports/PacketSource';

export class BundledPacketSource implements PacketSource {
  label = 'Bundled packet';
  constructor(private url = '/packet.json') {}
  async load(): Promise<unknown> {
    const res = await fetch(this.url);
    if (!res.ok) throw new Error(`Could not fetch ${this.url} (HTTP ${res.status})`);
    return res.json();
  }
}

export class FilePacketSource implements PacketSource {
  label: string;
  constructor(private file: File) {
    this.label = file.name;
  }
  async load(): Promise<unknown> {
    try {
      return JSON.parse(await this.file.text());
    } catch {
      throw new Error(`${this.file.name} is not valid JSON`);
    }
  }
}
```

`src/adapters/SimulatedDocumentSource.ts`:
```ts
import type { PacketIndex } from '../core/graph/index';
import { pageRef } from '../core/refs/refs';
import type { DocumentSource, Highlight, PageView } from '../ports/DocumentSource';

function occurrences(text: string, needle: string): number[] {
  const out: number[] = [];
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) out.push(i);
  return out;
}

// Pages are rendered from printed_content; positions are synthetic, so the vertical
// position only breaks ties between repeated occurrences of the same printed text.
export class SimulatedDocumentSource implements DocumentSource {
  constructor(private index: PacketIndex) {}

  getPage(docId: string, page: number): PageView | null {
    const text = this.index.docs.get(docId)?.pages.find((p) => p.page === page)?.printed_content;
    if (text === undefined) return null;
    const highlights: Highlight[] = (this.index.evsByPage.get(pageRef(docId, page)) ?? []).map((ev) => {
      if (!ev.text_as_read) return { ev, span: null };
      const hits = occurrences(text, ev.text_as_read);
      if (!hits.length) return { ev, span: null };
      const target = ev.position.y0 * text.length;
      const start = hits.reduce((best, i) => (Math.abs(i - target) < Math.abs(best - target) ? i : best));
      return { ev, span: { start, end: start + ev.text_as_read.length } };
    });
    return { docId, page, text, highlights };
  }
}
```

- [ ] **Step 5: Run tests** — `npx vitest run tests/core/documentSource.test.ts` — Expected: PASS. Then `npm test` — all pass (boundary test still passes: adapters live outside `src/core`).

- [ ] **Step 6: Checkpoint** — user reviews and commits.

---

### Task 6: Store, router and app frame (bundled + upload)

**Files:**
- Create: `src/ui/store.ts`, `src/ui/router.ts`
- Modify: `src/ui/App.tsx` (replace placeholder)
- Test: `tests/ui/router.test.ts`, `tests/ui/app.test.tsx`

**Interfaces:**
- Consumes: `loadPacket` (Task 2), `buildIndex`/`PacketIndex` (Task 4), `PacketSource`, `BundledPacketSource`, `FilePacketSource`, `SimulatedDocumentSource` (Task 5).
- Produces:
  - `useWorkpaper` zustand hook with state `{ status: 'idle' | 'loading' | 'ready' | 'error'; error?: string; index?: PacketIndex; docs?: DocumentSource; fingerprint?: string; sourceLabel?: string; load(source: PacketSource): Promise<void> }`
  - `interface Route { path: string[]; trace?: string; page?: number }`, `parseHash(hash: string): Route`, `buildHash(route: Route): string`, `useRoute(): Route`, `navigate(route: Route): void`, `withTrace(route: Route, trace?: string): Route`
  - `App({ source }: { source?: PacketSource })`

- [ ] **Step 1: Write the failing router test**

`tests/ui/router.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildHash, parseHash } from '../../src/ui/router';

describe('router', () => {
  it('parses path, page and trace', () => {
    expect(parseHash('#/documents/D28?page=3&trace=ev-0498')).toEqual({
      path: ['documents', 'D28'], page: 3, trace: 'ev-0498',
    });
  });
  it('defaults to empty path', () => {
    expect(parseHash('')).toEqual({ path: [] });
  });
  it('round-trips refs containing slashes and colons', () => {
    const route = { path: ['return'], trace: 'line:v3/F1040.1a' };
    expect(parseHash(buildHash(route))).toEqual(route);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/ui/router.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement router**

`src/ui/router.ts`:
```ts
import { useSyncExternalStore } from 'react';

export interface Route { path: string[]; trace?: string; page?: number }

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [pathPart = '', query = ''] = raw.split('?');
  const route: Route = { path: pathPart.split('/').filter(Boolean).map(decodeURIComponent) };
  const params = new URLSearchParams(query);
  const trace = params.get('trace');
  const page = params.get('page');
  if (page) route.page = Number(page);
  if (trace) route.trace = trace;
  return route;
}

export function buildHash(route: Route): string {
  const params = new URLSearchParams();
  if (route.page) params.set('page', String(route.page));
  if (route.trace) params.set('trace', route.trace);
  const q = params.toString();
  return `#/${route.path.map(encodeURIComponent).join('/')}${q ? `?${q}` : ''}`;
}

export function navigate(route: Route): void {
  window.location.hash = buildHash(route);
}

export function withTrace(route: Route, trace?: string): Route {
  const next = { ...route };
  if (trace) next.trace = trace;
  else delete next.trace;
  return next;
}

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return parseHash(hash);
}
```

- [ ] **Step 4: Implement store**

`src/ui/store.ts`:
```ts
import { create } from 'zustand';
import { SimulatedDocumentSource } from '../adapters/SimulatedDocumentSource';
import { buildIndex, type PacketIndex } from '../core/graph/index';
import { loadPacket } from '../core/packet/load';
import type { DocumentSource } from '../ports/DocumentSource';
import type { PacketSource } from '../ports/PacketSource';

interface WorkpaperState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error?: string;
  index?: PacketIndex;
  docs?: DocumentSource;
  fingerprint?: string;
  sourceLabel?: string;
  load(source: PacketSource): Promise<void>;
}

export const useWorkpaper = create<WorkpaperState>((set) => ({
  status: 'idle',
  async load(source) {
    set({ status: 'loading', error: undefined });
    try {
      const result = loadPacket(await source.load());
      if (!result.ok) {
        set({ status: 'error', error: result.error });
        return;
      }
      const index = buildIndex(result.packet);
      set({
        status: 'ready', index, docs: new SimulatedDocumentSource(index),
        fingerprint: result.fingerprint, sourceLabel: source.label,
      });
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  },
}));
```

- [ ] **Step 5: Implement the app frame**

`src/ui/App.tsx`:
```tsx
import { useEffect, useRef } from 'react';
import { BundledPacketSource, FilePacketSource } from '../adapters/packetSources';
import type { PacketSource } from '../ports/PacketSource';
import { navigate, useRoute } from './router';
import { DocumentsScreen } from './screens/DocumentsScreen';
import { ReturnScreen } from './screens/ReturnScreen';
import { useWorkpaper } from './store';
import { TraceDrawer } from './trace/TraceDrawer';

const NAV = [
  { path: 'return', label: 'Return' },
  { path: 'documents', label: 'Documents' },
];

export function App({ source }: { source?: PacketSource }) {
  const { status, error, index, fingerprint, sourceLabel, load } = useWorkpaper();
  const route = useRoute();
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void load(source ?? new BundledPacketSource());
  }, [load, source]);

  const screen = route.path[0] ?? 'return';

  return (
    <div className="flex h-screen flex-col bg-white text-slate-900">
      <header className="flex items-center gap-4 border-b border-slate-200 px-4 py-2">
        <span className="font-semibold">Tax Workpaper</span>
        {index && <span className="text-sm text-slate-600">{index.packet.packet.name} · {index.packet.packet.client_id}</span>}
        <span className="ml-auto text-xs text-slate-400">{sourceLabel} {fingerprint && `· ${fingerprint}`}</span>
        <button className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50" onClick={() => fileInput.current?.click()}>
          Load packet…
        </button>
        <input
          ref={fileInput} type="file" accept="application/json,.json" className="hidden" aria-label="Packet file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void load(new FilePacketSource(file));
            e.target.value = '';
          }}
        />
      </header>
      {status === 'loading' && <p className="p-6 text-slate-500">Loading packet…</p>}
      {status === 'error' && (
        <div role="alert" className="m-6 rounded border border-red-300 bg-red-50 p-4 text-red-800">
          <p className="font-medium">The packet could not be loaded.</p>
          <p className="mt-1 text-sm">{error}</p>
        </div>
      )}
      {status === 'ready' && index && (
        <div className="flex min-h-0 flex-1">
          <nav className="w-48 shrink-0 border-r border-slate-200 p-2">
            {NAV.map((n) => (
              <button
                key={n.path}
                className={`block w-full rounded px-3 py-1.5 text-left text-sm ${screen === n.path ? 'bg-slate-100 font-medium' : 'hover:bg-slate-50'}`}
                onClick={() => navigate({ path: [n.path] })}
              >
                {n.label}
              </button>
            ))}
          </nav>
          <main className="min-w-0 flex-1 overflow-auto">
            {screen === 'documents' ? <DocumentsScreen /> : <ReturnScreen />}
          </main>
          {route.trace && <TraceDrawer refId={route.trace} />}
        </div>
      )}
    </div>
  );
}
```

Create temporary stubs so the frame compiles (replaced in Tasks 7–8):

`src/ui/screens/ReturnScreen.tsx`:
```tsx
export function ReturnScreen() {
  return <p className="p-6">Return</p>;
}
```
`src/ui/screens/DocumentsScreen.tsx`:
```tsx
export function DocumentsScreen() {
  return <p className="p-6">Documents</p>;
}
```
`src/ui/trace/TraceDrawer.tsx`:
```tsx
export function TraceDrawer({ refId }: { refId: string }) {
  return <aside className="w-[28rem] border-l p-4">{refId}</aside>;
}
```

- [ ] **Step 6: Write the app smoke test (bundled-equivalent and bad upload)**

`tests/ui/app.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PacketSource } from '../../src/ports/PacketSource';
import { App } from '../../src/ui/App';
import { miniPacket } from '../fixtures/miniPacket';

const sourceOf = (data: unknown): PacketSource => ({ label: 'test', load: async () => data });

describe('App', () => {
  it('loads a packet and shows the frame', async () => {
    render(<App source={sourceOf(miniPacket())} />);
    expect(await screen.findByText(/Mini · C-MINI/)).toBeTruthy();
  });

  it('shows a readable error for a non-packet file', async () => {
    render(<App source={sourceOf({ hello: 'world' })} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/could not be loaded/);
    expect(alert.textContent).toMatch(/documents/);
  });
});
```

- [ ] **Step 7: Run tests and the app**

Run: `npm test && npm run typecheck`
Expected: all pass. Run `npm run dev`, open the URL: header shows "Okafor-Lindqvist…" packet name and client id; "Load packet…" with a random JSON file shows the red error panel.

- [ ] **Step 8: Checkpoint** — user reviews and commits.

---

### Task 7: Documents screen (index + viewer with highlights)

**Files:**
- Create: `src/core/views/documents.ts`, `src/ui/components/PageText.tsx`
- Modify: `src/ui/screens/DocumentsScreen.tsx` (replace stub)
- Test: `tests/core/documentsView.test.ts`, `tests/ui/pageText.test.tsx`

**Interfaces:**
- Consumes: `PacketIndex`, `landingsOfDocument` (Task 4); `DocumentSource`, `PageView` (Task 5); `useWorkpaper` (Task 6); `useRoute`, `navigate`, `withTrace` (Task 6); `formatValue` (Task 1).
- Produces:
  - `interface DocumentSummary { doc: Document; late: boolean; corrected: boolean; superseded: boolean; used: boolean; valueCount: number; landedCount: number }`
  - `documentSummaries(index: PacketIndex, version?: string): DocumentSummary[]`
  - `PageText({ view, selectedEvId, onSelect }: { view: PageView; selectedEvId?: string; onSelect(evId: string): void })`

- [ ] **Step 1: Write the failing view test**

`tests/core/documentsView.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildIndex } from '../../src/core/graph/index';
import { documentSummaries } from '../../src/core/views/documents';
import { miniPacket } from '../fixtures/miniPacket';

describe('documentSummaries', () => {
  const [d1, d2] = documentSummaries(buildIndex(miniPacket()));
  it('flags documents received after the client marked upload complete', () => {
    expect(d1!.late).toBe(false);
    expect(d2!.late).toBe(true);
  });
  it('flags corrected documents and counts values and landings', () => {
    expect(d2!.corrected).toBe(true);
    expect(d2!.valueCount).toBe(2);
    expect(d2!.landedCount).toBe(1);
    expect(d1!.used).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/core/documentsView.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement the view**

`src/core/views/documents.ts`:
```ts
import { landingsOfDocument, type PacketIndex } from '../graph/index';
import type { Document } from '../packet/types';

export interface DocumentSummary {
  doc: Document; late: boolean; corrected: boolean; superseded: boolean; used: boolean;
  valueCount: number; landedCount: number;
}

export function documentSummaries(index: PacketIndex, version = index.latest): DocumentSummary[] {
  const v = index.versions.get(version)!;
  const uploadComplete = index.packet.timeline.find((t) => t.event === 'client_marked_upload_complete')?.at;
  return index.packet.documents.map((doc) => {
    const landings = landingsOfDocument(index, doc.id, version);
    return {
      doc,
      late: uploadComplete !== undefined && doc.received_at > uploadComplete,
      corrected: doc.marked_corrected === true,
      superseded: v.documents_superseded.includes(doc.id),
      used: v.documents_used.includes(doc.id),
      valueCount: landings.length,
      landedCount: landings.filter((l) => l.lines.length > 0).length,
    };
  });
}
```

- [ ] **Step 4: Write the failing PageText test**

`tests/ui/pageText.test.tsx`:
```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SimulatedDocumentSource } from '../../src/adapters/SimulatedDocumentSource';
import { buildIndex } from '../../src/core/graph/index';
import { PageText } from '../../src/ui/components/PageText';
import { miniPacket } from '../fixtures/miniPacket';

describe('PageText', () => {
  it('renders highlights as clickable marks and lists unprinted values', () => {
    const view = new SimulatedDocumentSource(buildIndex(miniPacket())).getPage('D02', 2)!;
    const onSelect = vi.fn();
    render(<PageText view={view} onSelect={onSelect} />);
    fireEvent.click(screen.getByTitle('ev-0003 · Interest'));
    expect(onSelect).toHaveBeenCalledWith('ev-0003');
    expect(screen.getByText(/Not printed on this page/)).toBeTruthy();
    expect(screen.getByText(/Basis/)).toBeTruthy();
  });
});
```

- [ ] **Step 5: Implement PageText**

`src/ui/components/PageText.tsx`:
```tsx
import type { ReactNode } from 'react';
import { formatValue } from '../../core/format';
import type { PageView } from '../../ports/DocumentSource';

export function PageText({ view, selectedEvId, onSelect }: {
  view: PageView; selectedEvId?: string; onSelect(evId: string): void;
}) {
  const placed = view.highlights
    .filter((h) => h.span)
    .sort((a, b) => a.span!.start - b.span!.start);
  const missing = view.highlights.filter((h) => !h.span);

  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const h of placed) {
    const { start, end } = h.span!;
    if (start < cursor) continue;
    parts.push(view.text.slice(cursor, start));
    const selected = h.ev.id === selectedEvId;
    parts.push(
      <mark
        key={h.ev.id}
        title={`${h.ev.id} · ${h.ev.label}`}
        onClick={() => onSelect(h.ev.id)}
        className={`cursor-pointer rounded px-0.5 ${selected ? 'bg-amber-300 ring-2 ring-amber-500' : 'bg-sky-100 hover:bg-sky-200'}`}
      >
        {view.text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  parts.push(view.text.slice(cursor));

  return (
    <div>
      <div className="rounded border border-slate-200 bg-slate-50 p-6 font-serif leading-7 shadow-sm">{parts}</div>
      {missing.length > 0 && (
        <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-medium text-amber-900">Not printed on this page — extracted anyway:</p>
          <ul className="mt-1 space-y-1">
            {missing.map((h) => (
              <li key={h.ev.id}>
                <button className="underline" onClick={() => onSelect(h.ev.id)}>
                  {h.ev.label} = {formatValue(h.ev.value)}
                </button>{' '}
                <span className="text-amber-800">({h.ev.id}, confidence {h.ev.confidence})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Implement DocumentsScreen**

`src/ui/screens/DocumentsScreen.tsx`:
```tsx
import { useMemo, type ReactNode } from 'react';
import { parseRef } from '../../core/refs/refs';
import { documentSummaries } from '../../core/views/documents';
import { PageText } from '../components/PageText';
import { navigate, useRoute, withTrace } from '../router';
import { useWorkpaper } from '../store';

function Badge({ children, tone }: { children: ReactNode; tone: string }) {
  return <span className={`rounded px-1.5 py-0.5 text-xs ${tone}`}>{children}</span>;
}

export function DocumentsScreen() {
  const { index, docs } = useWorkpaper();
  const route = useRoute();
  const summaries = useMemo(() => (index ? documentSummaries(index) : []), [index]);
  if (!index || !docs) return null;

  const docId = route.path[1];
  const doc = docId ? index.docs.get(docId) : undefined;

  if (doc) {
    const page = route.page ?? 1;
    const view = docs.getPage(doc.id, page);
    const traced = route.trace ? parseRef(route.trace) : undefined;
    return (
      <div className="p-6">
        <button className="text-sm text-sky-700" onClick={() => navigate({ path: ['documents'] })}>← All documents</button>
        <h1 className="mt-2 text-xl font-semibold">{doc.id} · {doc.title}</h1>
        <p className="text-sm text-slate-500">{doc.issuer} · {doc.file_name} · received {doc.received_at.slice(0, 10)}</p>
        <div className="my-3 flex flex-wrap gap-1">
          {doc.pages.map((p) => (
            <button
              key={p.page}
              className={`rounded px-2 py-0.5 text-sm ${p.page === page ? 'bg-slate-800 text-white' : 'bg-slate-100'}`}
              onClick={() => navigate({ ...route, page: p.page })}
            >
              p{p.page}
            </button>
          ))}
        </div>
        {view ? (
          <PageText
            view={view}
            selectedEvId={traced?.kind === 'ev' ? traced.id : undefined}
            onSelect={(evId) => navigate(withTrace(route, evId))}
          />
        ) : (
          <p className="text-slate-500">Page not found.</p>
        )}
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">Documents ({summaries.length})</h1>
      <ul className="mt-4 divide-y divide-slate-100">
        {summaries.map((s) => (
          <li key={s.doc.id}>
            <button
              className="flex w-full items-center gap-3 px-2 py-2 text-left hover:bg-slate-50"
              onClick={() => navigate({ path: ['documents', s.doc.id], page: 1 })}
            >
              <span className="w-10 font-mono text-sm text-slate-500">{s.doc.id}</span>
              <span className="flex-1">{s.doc.title}</span>
              {s.late && <Badge tone="bg-orange-100 text-orange-800">late</Badge>}
              {s.corrected && <Badge tone="bg-violet-100 text-violet-800">corrected</Badge>}
              {s.superseded && <Badge tone="bg-slate-200 text-slate-700">superseded</Badge>}
              {s.doc.extraction.status !== 'extracted' && (
                <Badge tone="bg-amber-100 text-amber-800">{s.doc.extraction.status.replace('_', ' ')}</Badge>
              )}
              <span className="w-28 text-right text-xs text-slate-500">{s.landedCount}/{s.valueCount} values landed</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 7: Run tests and the app**

Run: `npm test && npm run typecheck` — Expected: all pass.
Manual: `npm run dev` → Documents: 74 rows; D31 shows "corrected" and "late"; D30 "superseded"; open D28 page 3: values highlighted; RSU basis values appear in the amber "Not printed on this page" box.

- [ ] **Step 8: Checkpoint** — user reviews and commits.

---

### Task 8: Return screen and trace drawer

**Files:**
- Modify: `src/ui/screens/ReturnScreen.tsx`, `src/ui/trace/TraceDrawer.tsx` (replace stubs)
- Test: `tests/ui/trace.test.tsx`

**Interfaces:**
- Consumes: `PacketIndex`, `inputRefs`, `sourceRefs`, `consumersOf` (Task 4); `parseRef`, `lineRef` (Task 3); `DocumentSource` (Task 5); `PageText` (Task 7); `useWorkpaper`, `useRoute`, `navigate`, `withTrace` (Task 6); `formatValue` (Task 1).
- Produces: `ReturnScreen()`, `TraceDrawer({ refId }: { refId: string })`, `LineTree({ refId, depth })` (internal).

- [ ] **Step 1: Write the failing test**

`tests/ui/trace.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { SimulatedDocumentSource } from '../../src/adapters/SimulatedDocumentSource';
import { buildIndex } from '../../src/core/graph/index';
import { useWorkpaper } from '../../src/ui/store';
import { TraceDrawer } from '../../src/ui/trace/TraceDrawer';
import { miniPacket } from '../fixtures/miniPacket';

beforeEach(() => {
  const index = buildIndex(miniPacket());
  useWorkpaper.setState({ status: 'ready', index, docs: new SimulatedDocumentSource(index) });
});

describe('TraceDrawer', () => {
  it('shows how a line was built down to its source documents', () => {
    render(<TraceDrawer refId="line:v1/F1040.11" />);
    expect(screen.getAllByText('Adjusted gross income').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/R-SUM/).length).toBeGreaterThan(0);
    expect(screen.getByText('Wages')).toBeTruthy();
    expect(screen.getByText(/D01 · W-2 Acme/)).toBeTruthy();
  });

  it('shows an extracted value with its highlighted page and where it landed', () => {
    render(<TraceDrawer refId="ev-0003" />);
    expect(screen.getByTitle('ev-0003 · Interest')).toBeTruthy();
    expect(screen.getByText(/line:v1\/SchB\.1\.1/)).toBeTruthy();
  });

  it('says where a value did not land', () => {
    render(<TraceDrawer refId="ev-0004" />);
    expect(screen.getByText(/Not used by any line/)).toBeTruthy();
  });

  it('handles an unknown ref', () => {
    render(<TraceDrawer refId="ev-9999" />);
    expect(screen.getByText(/Unknown reference/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/ui/trace.test.tsx` — Expected: FAIL (stub renders only the ref id).

- [ ] **Step 3: Implement TraceDrawer**

`src/ui/trace/TraceDrawer.tsx`:
```tsx
import { useState, type ReactNode } from 'react';
import { formatValue } from '../../core/format';
import { consumersOf, inputRefs, sourceRefs } from '../../core/graph/index';
import { parseRef } from '../../core/refs/refs';
import { PageText } from '../components/PageText';
import { navigate, useRoute, withTrace } from '../router';
import { useWorkpaper } from '../store';

function RefLink({ refId }: { refId: string }) {
  const route = useRoute();
  return (
    <button className="font-mono text-xs text-sky-700 hover:underline" onClick={() => navigate(withTrace(route, refId))}>
      {refId}
    </button>
  );
}

function SourceRow({ refId }: { refId: string }) {
  const { index } = useWorkpaper();
  const ev = index!.evs.get(refId);
  if (!ev) return <li className="text-sm"><RefLink refId={refId} /></li>;
  const doc = index!.docs.get(ev.document_id);
  return (
    <li className="text-sm">
      <RefLink refId={refId} /> {ev.label} = <strong>{formatValue(ev.value)}</strong>
      <span className="block text-xs text-slate-500">{doc?.id} · {doc?.title} · page {ev.page}</span>
    </li>
  );
}

function LineTree({ refId, depth }: { refId: string; depth: number }) {
  const { index } = useWorkpaper();
  const [open, setOpen] = useState(depth < 2);
  const line = index!.lines.get(refId);
  if (!line) return <RefLink refId={refId} />;
  const inputs = inputRefs(index!, refId);
  const sources = sourceRefs(index!, refId);
  return (
    <div className="border-l border-slate-200 pl-3">
      <button className="flex w-full items-baseline gap-2 text-left text-sm" onClick={() => setOpen(!open)}>
        <span className="text-slate-400">{inputs.length + sources.length ? (open ? '▾' : '▸') : '·'}</span>
        <span className="flex-1">{line.label}</span>
        <span className="font-mono">{formatValue(line.value)}</span>
      </button>
      {open && (
        <div className="mb-1 ml-4 space-y-1">
          <p className="text-xs text-slate-500">{line.form} {line.line} · {line.rule}</p>
          {inputs.map((r) => <LineTree key={r} refId={r} depth={depth + 1} />)}
          {sources.length > 0 && <ul className="space-y-1">{sources.map((r) => <SourceRow key={r} refId={r} />)}</ul>}
        </div>
      )}
    </div>
  );
}

function UsedBy({ refId }: { refId: string }) {
  const { index } = useWorkpaper();
  const users = consumersOf(index!, refId).filter((r) => r.startsWith(`line:${index!.latest}/`));
  return (
    <section className="mt-4">
      <h3 className="text-xs font-semibold uppercase text-slate-500">Used by ({index!.latest})</h3>
      {users.length ? (
        <ul className="mt-1 space-y-0.5">{users.map((r) => <li key={r}><RefLink refId={r} /> {index!.lines.get(r)?.label}</li>)}</ul>
      ) : (
        <p className="mt-1 text-sm text-amber-700">Not used by any line in {index!.latest}.</p>
      )}
    </section>
  );
}

export function TraceDrawer({ refId }: { refId: string }) {
  const { index, docs } = useWorkpaper();
  const route = useRoute();
  if (!index || !docs) return null;
  const parsed = parseRef(refId);

  let body: ReactNode;
  if (parsed.kind === 'line' && index.lines.has(refId)) {
    const line = index.lines.get(refId)!;
    body = (
      <>
        <p className="text-xs text-slate-500">{line.jurisdiction} · {line.form} line {line.line} · {line.version}</p>
        <h2 className="text-lg font-semibold">{line.label}</h2>
        <p className="font-mono text-2xl">{formatValue(line.value)}</p>
        <p className="mt-1 text-xs text-slate-500">Rule {line.rule}</p>
        {line.note && <p className="mt-2 rounded bg-slate-50 p-2 text-sm">{line.note}</p>}
        <h3 className="mt-4 text-xs font-semibold uppercase text-slate-500">How it was built</h3>
        <div className="mt-1"><LineTree refId={refId} depth={0} /></div>
        <UsedBy refId={refId} />
      </>
    );
  } else if (parsed.kind === 'ev' && index.evs.has(refId)) {
    const ev = index.evs.get(refId)!;
    const doc = index.docs.get(ev.document_id)!;
    const view = docs.getPage(ev.document_id, ev.page);
    body = (
      <>
        <p className="text-xs text-slate-500">{ev.id} · {ev.field} · confidence {ev.confidence}</p>
        <h2 className="text-lg font-semibold">{ev.label}</h2>
        <p className="font-mono text-2xl">{formatValue(ev.value)}</p>
        <p className="text-xs text-slate-500">As read: “{ev.text_as_read || '(nothing printed)'}”</p>
        <button
          className="mt-3 text-sm text-sky-700 hover:underline"
          onClick={() => navigate({ path: ['documents', doc.id], page: ev.page, trace: ev.id })}
        >
          {doc.id} · {doc.title} · page {ev.page} →
        </button>
        {view && <div className="mt-2 text-sm"><PageText view={view} selectedEvId={ev.id} onSelect={(id) => navigate(withTrace(route, id))} /></div>}
        <UsedBy refId={refId} />
      </>
    );
  } else if ((parsed.kind === 'doc' || parsed.kind === 'page') && index.docs.has(parsed.docId)) {
    const doc = index.docs.get(parsed.docId)!;
    body = (
      <>
        <h2 className="text-lg font-semibold">{doc.id} · {doc.title}</h2>
        <button className="mt-2 text-sm text-sky-700 hover:underline" onClick={() => navigate({ path: ['documents', doc.id], page: parsed.kind === 'page' ? parsed.page : 1 })}>
          Open document →
        </button>
      </>
    );
  } else {
    body = <p className="text-sm text-slate-600">Unknown reference <span className="font-mono">{refId}</span>.</p>;
  }

  return (
    <aside className="w-[30rem] shrink-0 overflow-auto border-l border-slate-200 p-4">
      <div className="mb-2 flex justify-end">
        <button aria-label="Close trace" className="text-slate-400 hover:text-slate-700" onClick={() => navigate(withTrace(route))}>✕</button>
      </div>
      {body}
    </aside>
  );
}
```

- [ ] **Step 4: Implement ReturnScreen**

`src/ui/screens/ReturnScreen.tsx`:
```tsx
import { formatValue } from '../../core/format';
import { lineRef } from '../../core/refs/refs';
import { navigate, useRoute, withTrace } from '../router';
import { useWorkpaper } from '../store';

export function ReturnScreen() {
  const { index } = useWorkpaper();
  const route = useRoute();
  if (!index) return null;
  const version = index.versions.get(index.latest)!;
  const byForm = new Map<string, typeof version.lines>();
  for (const l of version.lines) byForm.set(l.form, [...(byForm.get(l.form) ?? []), l]);

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">Return {version.version}</h1>
      <p className="text-sm text-slate-500">Computed {version.computed_at.slice(0, 10)} · {version.trigger}</p>
      {[...byForm].map(([form, lines]) => (
        <section key={form} className="mt-6">
          <h2 className="text-sm font-semibold uppercase text-slate-500">{form}</h2>
          <ul className="mt-1">
            {lines.map((l) => {
              const ref = lineRef(version.version, l.key);
              return (
                <li key={ref}>
                  <button
                    className={`flex w-full gap-3 px-2 py-1 text-left text-sm hover:bg-slate-50 ${route.trace === ref ? 'bg-amber-50' : ''}`}
                    onClick={() => navigate(withTrace(route, ref))}
                  >
                    <span className="w-16 font-mono text-slate-400">{l.line}</span>
                    <span className="flex-1">{l.label}</span>
                    <span className="font-mono">{formatValue(l.value)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Run all tests and verify end to end**

Run: `npm test && npm run typecheck && npm run build` — Expected: all pass, build succeeds.
Manual (`npm run dev`):
1. Return → `F1040 · 11 Adjusted gross income 445,590` → drawer shows the tree; expand to Wages 212,400 → sources ev-0016 / ev-0035 with W-2 documents.
2. Click `ev-0016` → highlighted on the W-2 page; "Used by" lists `line:v3/F1040.1a`.
3. Open `#/?trace=line:v3/F8949.A.N1` style deep link from the address bar for any line → drawer opens; `#/?trace=ev-9999` → "Unknown reference".
4. Documents → D28 page 3 → RSU basis listed as "Not printed on this page" (the first planted error is already visible).

- [ ] **Step 6: Checkpoint** — user reviews and commits. Plan 1 complete: spec build steps 1–2 delivered.

---

## Next plans (written after Plan 1 ships, one per spec build step)

- Plan 2 — step 3: checks engine (G1–G8, T1–T12) with one test per planted error; Inbox.
- Plan 3 — step 4: event log + replay, adjust/verify/notes/undo, tax effect, area pages (replaces ReturnScreen as the main view).
- Plan 4 — step 5: roles + policy, masking, view log, stale sign-offs, cross-tab sync.
- Plans 5–7 — steps 6–9 per the spec.
