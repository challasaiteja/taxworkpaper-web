# Plan 2 — Checks Engine and Inbox (spec build step 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deterministic checks that don't trust the engine surface every planted error as a finding with evidence refs, expected vs actual, an estimated tax effect, a plain-language explanation and a next action; an Inbox ranks them by tax effect and links each into the trace drawer.

**Architecture:** `src/core/checks/` holds pure check functions over a `CheckContext` (index + chosen return version + helpers). Each check is generic where the data allows (field names, document types, rules) rather than hard-coded value ids. `runChecks` isolates failures (a throwing check becomes a "could not run" finding). Page-location logic moves from the adapter into `src/core/documents/locate.ts` so the value-not-on-page check can use it. The store computes findings on load; `InboxScreen` renders them.

**Tech Stack:** unchanged from Plan 1 (React 19, TS 5.9, zustand, Vitest 4, jsdom 25).

**Spec:** `docs/superpowers/specs/2026-10-14-tax-workpaper-design.md` (§4.6 Findings, §6 Checks, §7 Inbox)

## Global Constraints

- Plan 1 constraints still hold (core purity, packet never mutated, packet gitignored, no agent commits, no LLM).
- Tax effect = Δ(line amount) × `return_versions[v].tax_effect_rates[category]` for the version checked (v3 by default); `+` = client owes more. Payments and excise are `basis: 'direct'` (1:1). Engine what-if results are `basis: 'what_if'`. Every effect is labeled an estimate in the UI.
- Checks never mutate state and never throw out of `runChecks`.
- Planted-error tests run against the real packet (`describe.skipIf(!hasRealPacket)`); generic mechanics (G1, G5, G8, isolation, ranking) are also unit-tested on the mini fixture so a fresh clone still exercises them.
- Rates in v3 (for reading test expectations): stcg .348/.034, ltcg .238/.034, interest .348/.069, schc_profit .355/.031, adjustment −.31/−.042, itemized −.26/−.048, salt 0/−.048, ca_source_income 0/.064.

## Review Focus

1. **A check throws on an unfamiliar packet** (e.g. uploaded packet without `household.people`) → the Inbox still renders, with one "could not run" finding for that check. (Test in Task 2.)
2. **A rule that matches more than the planted case** (false positives drown the reviewer) → each planted test asserts the exact finding count for its check on the real packet. (Tests in Tasks 3–6.)
3. **Version without `tax_effect_rates` category** (e.g. a category missing) → effect is 0 with a note, not NaN. (Test in Task 2.)
4. **Inbox with zero findings** (mini packet with no issues) → "Nothing needs attention" state, not a blank pane. (Test in Task 7.)
5. **Clicking a finding ref that is not a line/ev/doc** (`agency:/…`, `qa-25`, `call-01`) → trace drawer says what it is instead of "Unknown reference". (Test in Task 7.)

---

## File Structure

```
src/core/documents/locate.ts         locateOnPage(text, evs) — moved from adapter
src/adapters/SimulatedDocumentSource.ts   now delegates to locateOnPage
src/core/checks/types.ts             Finding, Effect, Check, Severity, findingRef, effectSize
src/core/checks/context.ts           CheckContext, makeContext, effect helpers
src/core/checks/registry.ts          CHECKS, runChecks (isolation + ranking)
src/core/checks/generic.ts           G1–G8
src/core/checks/income.ts            T1 RSU basis, T2 receipts, T9 FX year, T11 CA wages, T12 transfer-in lot
src/core/checks/business.ts          T3 personal use, T4 SE health insurance, T5 SEP excess
src/core/checks/property.ts          T6 repair vs improvement, T7a seller tax credit, T7b payoff interest, T8 vehicle donation
src/core/checks/payments.ts          T10a federal estimates, T10b California estimates
src/ui/store.ts                      + findings
src/ui/screens/InboxScreen.tsx       ranked findings, totals, engine diagnostics
src/ui/App.tsx                       nav: Inbox (default), Return, Documents
src/ui/trace/TraceDrawer.tsx         + client / agency / prior-year / param refs
tests/core/checks/*.test.ts, tests/ui/inbox.test.tsx
```

---

### Task 1: Move page location into core

**Files:**
- Create: `src/core/documents/locate.ts`
- Modify: `src/adapters/SimulatedDocumentSource.ts`
- Test: existing `tests/core/documentSource.test.ts` (must stay green) + `tests/core/locate.test.ts`

**Interfaces:**
- Produces: `locateOnPage(text: string, evs: ExtractedValue[]): Map<string, { start: number; end: number } | null>` — `null` when `text_as_read` is empty or no token-bounded match exists.

- [ ] **Step 1: Write the failing test**

`tests/core/locate.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { locateOnPage } from '../../src/core/documents/locate';
import { miniPacket } from '../fixtures/miniPacket';

const p = miniPacket();
const d03 = p.documents.find((d) => d.id === 'D03')!.pages[0]!.printed_content;
const evs = p.extracted_values.filter((e) => e.document_id === 'D03');

describe('locateOnPage', () => {
  it('returns spans for located values and null for the rest', () => {
    const m = locateOnPage(d03, evs);
    expect(m.get('ev-0010')).not.toBeNull();
    expect(m.get('ev-0012')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/core/locate.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Move the logic**

Create `src/core/documents/locate.ts` containing, unchanged from `src/adapters/SimulatedDocumentSource.ts`, the `WORD` constant and the functions `isBoundary`, `occurrences`, `candidates`, `assign`, plus:
```ts
export function locateOnPage(text: string, evs: ExtractedValue[]): Map<string, { start: number; end: number } | null> {
  const needleOf = new Map<string, string>();
  const groups = new Map<string, ExtractedValue[]>();
  for (const ev of evs) {
    if (!ev.text_as_read) continue;
    const needle = candidates(ev).find((c) => occurrences(text, c).length > 0);
    if (!needle) continue;
    needleOf.set(ev.id, needle);
    groups.set(needle, [...(groups.get(needle) ?? []), ev]);
  }
  const out = new Map<string, { start: number; end: number } | null>();
  for (const ev of evs) out.set(ev.id, null);
  for (const [needle, group] of groups) {
    for (const [id, start] of assign(group, occurrences(text, needle), text.length)) {
      out.set(id, { start, end: start + needle.length });
    }
  }
  return out;
}
```
(Import `ExtractedValue` from `../packet/types`.)

Replace the body of `src/adapters/SimulatedDocumentSource.ts` with:
```ts
import { locateOnPage } from '../core/documents/locate';
import type { PacketIndex } from '../core/graph/index';
import { pageRef } from '../core/refs/refs';
import type { DocumentSource, Highlight, PageView } from '../ports/DocumentSource';

// Pages are rendered from printed_content; positions are synthetic, so y0 is used only
// to order values against repeated occurrences of the same printed text.
export class SimulatedDocumentSource implements DocumentSource {
  constructor(private index: PacketIndex) {}

  getPage(docId: string, page: number): PageView | null {
    const text = this.index.docs.get(docId)?.pages.find((p) => p.page === page)?.printed_content;
    if (text === undefined) return null;
    const evs = this.index.evsByPage.get(pageRef(docId, page)) ?? [];
    const spans = locateOnPage(text, evs);
    const highlights: Highlight[] = evs.map((ev) => {
      const span = spans.get(ev.id) ?? null;
      if (span) return { ev, span };
      return { ev, span: null, missing: ev.text_as_read ? 'not_found' : 'not_printed' };
    });
    return { docId, page, text, highlights };
  }
}
```

- [ ] **Step 4: Run** — `npm test` — Expected: all previous tests + the new one pass.

- [ ] **Step 5: Checkpoint** — user reviews and commits.

---

### Task 2: Check types, context, registry

**Files:**
- Create: `src/core/checks/types.ts`, `src/core/checks/context.ts`, `src/core/checks/registry.ts`
- Test: `tests/core/checks/registry.test.ts`

**Interfaces:**
- Produces:
  - `type Severity = 'error' | 'warning' | 'info'`
  - `interface Effect { federal: number; california: number; basis: 'rate' | 'direct' | 'what_if' | 'none'; note?: string }`
  - `interface Finding { checkId: string; key: string; title: string; severity: Severity; refs: Ref[]; expected?: number | string; actual?: number | string; effect: Effect; explain: string; nextAction: string }`
  - `interface Check { id: string; title: string; kind: 'generic' | 'tax'; run(ctx: CheckContext): Finding[] }`
  - `findingRef(f: Pick<Finding, 'checkId' | 'key'>): Ref`, `effectSize(e: Effect): number`, `NO_EFFECT: Effect`
  - `interface CheckContext { index; version; taxYear: number; line(key): Line | undefined; num(key): number; ev(id): ExtractedValue | undefined; doc(id): Document | undefined; evsOf(docId): ExtractedValue[]; sourceEvs(key): ExtractedValue[]; linesCiting(ref): Ref[]; rateEffect(category, delta, note?): Effect; whatIfEffect(id): Effect | null }`
  - `makeContext(index: PacketIndex, versionId?: string): CheckContext`
  - `CHECKS: Check[]` (filled by Tasks 3–6), `runChecks(index: PacketIndex, versionId?: string, checks?: Check[]): Finding[]`

- [ ] **Step 1: Write the failing test**

`tests/core/checks/registry.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { makeContext } from '../../../src/core/checks/context';
import { runChecks } from '../../../src/core/checks/registry';
import type { Check } from '../../../src/core/checks/types';
import { buildIndex } from '../../../src/core/graph/index';
import { miniPacket } from '../../fixtures/miniPacket';

const index = buildIndex(miniPacket());
const finding = (id: string, federal: number, severity: 'error' | 'warning' | 'info' = 'warning') => ({
  checkId: id, key: 'k', title: id, severity, refs: [], explain: '', nextAction: '',
  effect: { federal, california: 0, basis: 'rate' as const },
});

describe('runChecks', () => {
  it('turns a throwing check into a "could not run" finding', () => {
    const boom: Check = { id: 'X1', title: 'Boom', kind: 'generic', run: () => { throw new Error('no household'); } };
    const out = runChecks(index, undefined, [boom]);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toMatch(/could not run/);
    expect(out[0]!.explain).toMatch(/no household/);
  });

  it('ranks by tax effect, with info findings last', () => {
    const checks: Check[] = [
      { id: 'A', title: 'A', kind: 'tax', run: () => [finding('small', 10)] },
      { id: 'B', title: 'B', kind: 'tax', run: () => [finding('info-big', 9999, 'info')] },
      { id: 'C', title: 'C', kind: 'tax', run: () => [finding('big', -500)] },
    ];
    expect(runChecks(index, undefined, checks).map((f) => f.checkId)).toEqual(['big', 'small', 'info-big']);
  });
});

describe('context', () => {
  it('computes rate effects and tolerates unknown categories', () => {
    const ctx = makeContext(index);
    expect(ctx.rateEffect('wages', 100)).toEqual({ federal: 22, california: 9, basis: 'rate' });
    const missing = ctx.rateEffect('nope', 100);
    expect(missing.federal).toBe(0);
    expect(missing.note).toMatch(/No tax-effect rate/);
  });

  it('reads lines and their source values', () => {
    const ctx = makeContext(index);
    expect(ctx.num('F1040.11')).toBe(1050);
    expect(ctx.sourceEvs('F1040.1a').map((e) => e.id)).toEqual(['ev-0001']);
    expect(ctx.linesCiting('ev-0003')).toEqual(['line:v1/SchB.1.1']);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/core/checks/registry.test.ts` — Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`src/core/checks/types.ts`:
```ts
import type { Ref } from '../refs/refs';
import type { CheckContext } from './context';

export type Severity = 'error' | 'warning' | 'info';

export interface Effect {
  federal: number;
  california: number;
  basis: 'rate' | 'direct' | 'what_if' | 'none';
  note?: string;
}

export interface Finding {
  checkId: string;
  key: string;
  title: string;
  severity: Severity;
  refs: Ref[];
  expected?: number | string;
  actual?: number | string;
  effect: Effect;
  explain: string;
  nextAction: string;
}

export interface Check {
  id: string;
  title: string;
  kind: 'generic' | 'tax';
  run(ctx: CheckContext): Finding[];
}

export const NO_EFFECT: Effect = { federal: 0, california: 0, basis: 'none' };
export const findingRef = (f: Pick<Finding, 'checkId' | 'key'>): Ref => `finding:${f.checkId}/${f.key}`;
export const effectSize = (e: Effect): number => Math.abs(e.federal) + Math.abs(e.california);
```

`src/core/checks/context.ts`:
```ts
import { consumersOf, type PacketIndex } from '../graph/index';
import type { Document, ExtractedValue, Line, ReturnVersion } from '../packet/types';
import type { Ref } from '../refs/refs';
import type { Effect } from './types';

export interface CheckContext {
  index: PacketIndex;
  version: ReturnVersion;
  taxYear: number;
  line(key: string): Line | undefined;
  num(key: string): number;
  ev(id: string): ExtractedValue | undefined;
  doc(id: string): Document | undefined;
  evsOf(docId: string): ExtractedValue[];
  sourceEvs(key: string): ExtractedValue[];
  linesCiting(ref: Ref): Ref[];
  rateEffect(category: string, delta: number, note?: string): Effect;
  whatIfEffect(id: string): Effect | null;
}

interface WhatIf { id: string; federal?: { total_tax_change?: number }; california?: { total_tax_change?: number } }

export function makeContext(index: PacketIndex, versionId = index.latest): CheckContext {
  const version = index.versions.get(versionId)!;
  const lines = new Map(version.lines.map((l) => [l.key, l]));
  const byDoc = new Map<string, ExtractedValue[]>();
  for (const e of index.packet.extracted_values) byDoc.set(e.document_id, [...(byDoc.get(e.document_id) ?? []), e]);
  const household = index.packet.household as { tax_year?: number } | undefined;

  return {
    index,
    version,
    taxYear: household?.tax_year ?? new Date(version.computed_at).getFullYear() - 1,
    line: (key) => lines.get(key),
    num: (key) => {
      const v = lines.get(key)?.value;
      return typeof v === 'number' ? v : 0;
    },
    ev: (id) => index.evs.get(id),
    doc: (id) => index.docs.get(id),
    evsOf: (docId) => byDoc.get(docId) ?? [],
    sourceEvs: (key) => (lines.get(key)?.sources ?? []).flatMap((s) => index.evs.get(s) ?? []),
    linesCiting: (ref) => consumersOf(index, ref).filter((r) => r.startsWith(`line:${version.version}/`)),
    rateEffect: (category, delta, note) => {
      const rate = version.tax_effect_rates[category];
      if (!rate) return { federal: 0, california: 0, basis: 'none', note: `No tax-effect rate for "${category}" in ${version.version}` };
      const effect: Effect = {
        federal: Math.round(delta * rate.federal_per_dollar),
        california: Math.round(delta * rate.california_per_dollar),
        basis: 'rate',
      };
      if (note) effect.note = note;
      return effect;
    },
    whatIfEffect: (id) => {
      const alts = (index.packet.what_if as { alternatives?: WhatIf[] } | undefined)?.alternatives ?? [];
      const alt = alts.find((a) => a.id === id);
      if (!alt) return null;
      return {
        federal: alt.federal?.total_tax_change ?? 0,
        california: alt.california?.total_tax_change ?? 0,
        basis: 'what_if',
        note: `Engine what-if "${id}"`,
      };
    },
  };
}
```

`src/core/checks/registry.ts`:
```ts
import type { PacketIndex } from '../graph/index';
import { makeContext } from './context';
import { effectSize, NO_EFFECT, type Check, type Finding } from './types';

export const CHECKS: Check[] = [];

const SEVERITY = { error: 0, warning: 1, info: 2 } as const;

export function runChecks(index: PacketIndex, versionId = index.latest, checks: Check[] = CHECKS): Finding[] {
  const ctx = makeContext(index, versionId);
  const findings = checks.flatMap((check): Finding[] => {
    try {
      return check.run(ctx);
    } catch (e) {
      return [{
        checkId: check.id, key: 'could-not-run', title: `${check.title}: check could not run`,
        severity: 'warning', refs: [], effect: NO_EFFECT,
        explain: e instanceof Error ? e.message : String(e),
        nextAction: 'Review this area manually; the packet is missing data this check expects.',
      }];
    }
  });
  return findings.sort(
    (a, b) =>
      Number(a.severity === 'info') - Number(b.severity === 'info') ||
      effectSize(b.effect) - effectSize(a.effect) ||
      SEVERITY[a.severity] - SEVERITY[b.severity],
  );
}
```

- [ ] **Step 4: Run** — `npx vitest run tests/core/checks/registry.test.ts` — Expected: PASS (4 tests). `npm test` all green.

- [ ] **Step 5: Checkpoint** — user reviews and commits.

---

### Task 3: Generic checks G1–G8

**Files:**
- Create: `src/core/checks/generic.ts`
- Modify: `src/core/checks/registry.ts` (`CHECKS` = `[...GENERIC_CHECKS]`)
- Test: `tests/core/checks/generic.test.ts`

**Interfaces:**
- Consumes: Task 2 types/context; `locateOnPage` (Task 1); `pageRef`, `lineRef` (Plan 1); `formatValue`.
- Produces: `GENERIC_CHECKS: Check[]` with ids `G1`…`G8`.

- [ ] **Step 1: Write the failing tests**

`tests/core/checks/generic.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { makeContext } from '../../../src/core/checks/context';
import { GENERIC_CHECKS } from '../../../src/core/checks/generic';
import type { Finding } from '../../../src/core/checks/types';
import { buildIndex } from '../../../src/core/graph/index';
import { loadPacket } from '../../../src/core/packet/load';
import { miniPacket } from '../../fixtures/miniPacket';
import { hasRealPacket, readRealPacket } from '../../fixtures/realPacket';

const run = (id: string, index = buildIndex(miniPacket()), version?: string): Finding[] =>
  GENERIC_CHECKS.find((c) => c.id === id)!.run(makeContext(index, version));

describe('generic checks on the mini packet', () => {
  it('G1 flags a money value whose printed text is not on its page', () => {
    const out = run('G1');
    expect(out.map((f) => f.key)).toEqual(['ev-0012']);
    expect(out[0]!.severity).toBe('info');
  });

  it('G5 flags a superseded document that a line still cites', () => {
    const p = miniPacket();
    p.return_versions[0]!.documents_superseded = ['D02'];
    const out = run('G5', buildIndex(p));
    expect(out.find((f) => f.key === 'superseded-D02')?.severity).toBe('error');
  });

  it('G8 lists low-confidence reads only', () => {
    const p = miniPacket();
    p.extracted_values[0]!.confidence = 0.41;
    expect(run('G8', buildIndex(p)).map((f) => f.key)).toEqual(['ev-0001']);
  });
});

describe.skipIf(!hasRealPacket)('generic checks on the real packet', () => {
  const r = loadPacket(readRealPacket());
  if (!r.ok) throw new Error(r.error);
  const index = buildIndex(r.packet);

  it('G1 includes the transposed EIN and the invented zeros', () => {
    const keys = run('G1', index).map((f) => f.key);
    for (const id of ['ev-1045', 'ev-0022', 'ev-0501', 'ev-0510', 'ev-0519', 'ev-0528', 'ev-0537', 'ev-1049']) {
      expect(keys).toContain(id);
    }
    const ein = run('G1', index).find((f) => f.key === 'ev-1045')!;
    expect(ein.severity).toBe('warning');
    expect(ein.refs).toContain('line:v3/F2441.1b');
  });

  it('G2 finds exactly the duplicated mileage page and its effect', () => {
    const out = run('G2', index);
    expect(out).toHaveLength(1);
    expect(out[0]!.refs).toEqual(expect.arrayContaining(['D23#page2', 'D23#page3', 'line:v3/SchC.44a']));
    expect(out[0]!.expected).toBe(8100);
    expect(out[0]!.effect).toMatchObject({ federal: 919, california: 80, basis: 'rate' });
  });

  it('G3 finds exactly the double-counted Northlake interest', () => {
    const out = run('G3', index);
    expect(out).toHaveLength(1);
    expect(out[0]!.refs).toEqual(expect.arrayContaining(['line:v3/SchB.1.1', 'line:v3/SchB.1.2']));
    expect(out[0]!.effect).toMatchObject({ federal: -640, california: -127 });
  });

  it('G4 finds the broker summary that does not match its lots', () => {
    const out = run('G4', index);
    expect(out).toHaveLength(1);
    expect(out[0]!.refs).toContain('ev-0703');
    expect(out[0]!.expected).toBe(71965);
    expect(out[0]!.actual).toBe(71715);
  });

  it('G5 lists documents no v3 line cites and no superseded citations', () => {
    const out = run('G5', index);
    expect(out.map((f) => f.key)).toEqual(['uncited']);
    expect(out[0]!.refs).toEqual(expect.arrayContaining(['D10', 'D15', 'D47', 'D54', 'D73']));
  });

  it('G6 catches Theo\'s transposed SSN', () => {
    const out = run('G6', index);
    expect(out).toHaveLength(1);
    expect(out[0]!).toMatchObject({ key: 'theo', severity: 'error', expected: '666-74-3390', actual: '666-74-3309' });
    expect(out[0]!.refs).toEqual(expect.arrayContaining(['household:theo', 'ev-1080', 'ev-0012']));
  });

  it('G7 applies the firm variance rule and skips positional Schedule B keys', () => {
    const out = run('G7', index);
    expect(out.length).toBeGreaterThan(10);
    expect(out.some((f) => f.key.startsWith('SchB.'))).toBe(false);
    expect(out.every((f) => f.severity === 'info')).toBe(true);
    expect(out.map((f) => f.key)).toContain('Sch1.17');
  });

  it('G8 lists exactly the two low-confidence reads', () => {
    expect(run('G8', index).map((f) => f.key).sort()).toEqual(['ev-0919', 'ev-1049']);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/core/checks/generic.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`src/core/checks/generic.ts`:
```ts
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
    const byValue = new Map<number, typeof lines>();
    for (const l of lines) byValue.set(l.value as number, [...(byValue.get(l.value as number) ?? []), l]);
    for (const [value, group] of byValue) {
      if (group.length < 2) continue;
      const docs = new Set(group.flatMap((l) => ctx.sourceEvs(l.key).map((e) => e.document_id)));
      if (docs.size < 2) continue;
      const [first, ...rest] = group;
      for (const dup of rest) {
        const refs: Ref[] = [lineRef(ctx.version.version, first!.key), lineRef(ctx.version.version, dup.key), ...first!.sources, ...dup.sources];
        out.push({
          checkId: 'G3', key: dup.key, severity: 'error',
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
```

`src/core/checks/registry.ts`: replace `export const CHECKS: Check[] = [];` with
```ts
import { GENERIC_CHECKS } from './generic';

export const CHECKS: Check[] = [...GENERIC_CHECKS];
```
(keep the import block at the top of the file).

- [ ] **Step 4: Run** — `npx vitest run tests/core/checks/generic.test.ts` — Expected: PASS. If a real-packet count differs, inspect the extra hits before changing the rule: a rule may only be narrowed by a condition that is true of the planted case and stated in the explanation.

- [ ] **Step 5: Checkpoint** — user reviews and commits.

---

### Task 4: Income checks (T1, T2, T9, T11, T12)

**Files:**
- Create: `src/core/checks/income.ts`
- Modify: `src/core/checks/registry.ts` (`CHECKS` adds `...INCOME_CHECKS`)
- Test: `tests/core/checks/income.test.ts`

**Interfaces:**
- Produces: `INCOME_CHECKS: Check[]` with ids `T1`, `T2`, `T9`, `T11`, `T12`.

- [ ] **Step 1: Write the failing tests**

`tests/core/checks/income.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { makeContext } from '../../../src/core/checks/context';
import { INCOME_CHECKS } from '../../../src/core/checks/income';
import { buildIndex } from '../../../src/core/graph/index';
import { loadPacket } from '../../../src/core/packet/load';
import { hasRealPacket, readRealPacket } from '../../fixtures/realPacket';

describe.skipIf(!hasRealPacket)('income checks on the real packet', () => {
  const r = loadPacket(readRealPacket());
  if (!r.ok) throw new Error(r.error);
  const ctx = makeContext(buildIndex(r.packet));
  const run = (id: string) => INCOME_CHECKS.find((c) => c.id === id)!.run(ctx);

  it('T1 restores RSU basis from the supplemental statement', () => {
    const out = run('T1');
    expect(out.map((f) => f.key).sort()).toEqual(['D28/N1', 'D28/N3', 'D28/N4']);
    const total = out.reduce((s, f) => ({ federal: s.federal + f.effect.federal, california: s.california + f.effect.california }), { federal: 0, california: 0 });
    expect(total.federal).toBeCloseTo(-15536, -1);
    expect(total.california).toBeCloseTo(-1619, -1);
    expect(out.find((f) => f.key === 'D28/N4')!).toMatchObject({ expected: 9420, actual: 0 });
    expect(out[0]!.refs).toEqual(expect.arrayContaining(['ev-0027']));
  });

  it('T2 finds the 1099-K already inside book receipts', () => {
    const out = run('T2');
    expect(out).toHaveLength(1);
    expect(out[0]!).toMatchObject({ expected: 151300, actual: 163700 });
    expect(out[0]!.effect).toMatchObject({ federal: -4402, california: -384 });
    expect(out[0]!.refs).toEqual(expect.arrayContaining(['ev-0127', 'ev-0109', 'line:v3/SchC.1']));
  });

  it('T9 finds the prior-year exchange rate', () => {
    const out = run('T9');
    expect(out).toHaveLength(1);
    expect(out[0]!).toMatchObject({ key: 'SchB.1.6', expected: 1871, actual: 1747 });
    expect(out[0]!.effect).toMatchObject({ federal: 43, california: 9 });
  });

  it('T11 recomputes California wages from the paystub', () => {
    const out = run('T11');
    expect(out).toHaveLength(1);
    expect(out[0]!).toMatchObject({ expected: 129569, actual: 218400 });
    expect(out[0]!.effect).toMatchObject({ federal: 0, california: -5685 });
  });

  it('T12 flags the transfer-in lot without basis or date', () => {
    const out = run('T12');
    expect(out.map((f) => f.key)).toEqual(['D35/C6']);
    expect(out[0]!.refs).toContain('line:v3/F8949.H.C6');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/core/checks/income.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`src/core/checks/income.ts`:
```ts
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
        title: `${issuer} W-2 box 16 California wages ${formatValue(w.value)} exceed box 1 ${formatValue(box1.value)}`,
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
```

`src/core/checks/registry.ts`: add `import { INCOME_CHECKS } from './income';` and set `export const CHECKS: Check[] = [...GENERIC_CHECKS, ...INCOME_CHECKS];`

- [ ] **Step 4: Run** — `npx vitest run tests/core/checks/income.test.ts` — Expected: PASS (5 tests). `npm test` green.

- [ ] **Step 5: Checkpoint** — user reviews and commits.

---

### Task 5: Business and property checks (T3–T8)

**Files:**
- Create: `src/core/checks/business.ts`, `src/core/checks/property.ts`
- Modify: `src/core/checks/registry.ts`
- Test: `tests/core/checks/deductions.test.ts`

**Interfaces:**
- Produces: `BUSINESS_CHECKS` (`T3`, `T4`, `T5`), `PROPERTY_CHECKS` (`T6`, `T7a`, `T7b`, `T8`).

- [ ] **Step 1: Write the failing tests**

`tests/core/checks/deductions.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { BUSINESS_CHECKS } from '../../../src/core/checks/business';
import { makeContext } from '../../../src/core/checks/context';
import { PROPERTY_CHECKS } from '../../../src/core/checks/property';
import { buildIndex } from '../../../src/core/graph/index';
import { loadPacket } from '../../../src/core/packet/load';
import { hasRealPacket, readRealPacket } from '../../fixtures/realPacket';

describe.skipIf(!hasRealPacket)('business and property checks on the real packet', () => {
  const r = loadPacket(readRealPacket());
  if (!r.ok) throw new Error(r.error);
  const ctx = makeContext(buildIndex(r.packet));
  const run = (id: string) => [...BUSINESS_CHECKS, ...PROPERTY_CHECKS].find((c) => c.id === id)!.run(ctx);

  it('T3 applies the business-use percentages from the call notes', () => {
    const out = run('T3');
    expect(out.map((f) => f.key).sort()).toEqual(['ev-0095', 'ev-0101', 'ev-0106']);
    expect(out.reduce((s, f) => s + f.effect.federal, 0)).toBeCloseTo(541, -1);
    expect(out.every((f) => f.refs.includes('call-01'))).toBe(true);
  });

  it('T4 disallows self-employed health insurance when spouse coverage was available', () => {
    const out = run('T4');
    expect(out).toHaveLength(1);
    expect(out[0]!).toMatchObject({ expected: 0, actual: 14400 });
    expect(out[0]!.effect).toMatchObject({ federal: 4464, california: 605 });
    expect(out[0]!.refs).toContain('qa-25');
  });

  it('T5 flags the SEP contribution above the limit', () => {
    const out = run('T5');
    expect(out).toHaveLength(1);
    expect(out[0]!).toMatchObject({ expected: 15214, actual: 18000 });
    expect(out[0]!.effect).toMatchObject({ federal: 279, basis: 'direct' });
  });

  it('T6 flags the HVAC replacement booked as a repair, with the engine what-if', () => {
    const out = run('T6');
    expect(out).toHaveLength(1);
    expect(out[0]!.refs).toEqual(expect.arrayContaining(['D47', 'line:v3/SchE.14A']));
    expect(out[0]!.effect).toMatchObject({ federal: 3633, california: 896, basis: 'what_if' });
  });

  it('T7a removes the seller-paid property tax', () => {
    const out = run('T7a');
    expect(out).toHaveLength(1);
    expect(out[0]!).toMatchObject({ expected: 6508, actual: 13420 });
    expect(out[0]!.effect.california).toBe(332);
  });

  it('T7b catches payoff interest counted twice', () => {
    const out = run('T7b');
    expect(out).toHaveLength(1);
    expect(out[0]!).toMatchObject({ expected: 19697, actual: 21847 });
    expect(out[0]!.effect).toMatchObject({ federal: 559, california: 103 });
  });

  it('T8 caps the vehicle donation at the charity sale price', () => {
    const out = run('T8');
    expect(out).toHaveLength(1);
    expect(out[0]!).toMatchObject({ expected: 2900, actual: 6000 });
    expect(out[0]!.effect).toMatchObject({ federal: 806, california: 149 });
  });
});
```

- [ ] **Step 2: Run to verify failure** — Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`src/core/checks/business.ts`:
```ts
import { formatValue } from '../format';
import { lineRef } from '../refs/refs';
import type { Check, Finding } from './types';

interface CallNote { id: string; notes: string[] }
interface Answer { id: string; question: string; answer: string }

const clientOf = (ctx: Parameters<Check['run']>[0]) =>
  ctx.index.packet.client as { call_notes?: CallNote[]; questionnaire?: Answer[] };

const BUSINESS_USE = [
  { fields: /telephone|phone/i, words: /mobile|phone/i },
  { fields: /internet/i, words: /internet/i },
];

const personalUse: Check = {
  id: 'T3', title: 'Personal share of business expenses', kind: 'tax',
  run(ctx) {
    const notes = (clientOf(ctx).call_notes ?? []).flatMap((c) => c.notes.map((text) => ({ id: c.id, text })));
    const out: Finding[] = [];
    const booksLines = ctx.version.lines.filter((l) => l.form === 'SchC' && l.rule === 'R-BOOKS-LINE');
    for (const line of booksLines) {
      for (const ev of ctx.sourceEvs(line.key)) {
        const rule = BUSINESS_USE.find((r) => r.fields.test(ev.field));
        const note = rule && notes.find((n) => rule.words.test(n.text) && /(\d+)%/.test(n.text));
        if (!note || typeof ev.value !== 'number') continue;
        const pct = Number(/(\d+)%/.exec(note.text)![1]);
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
      if (!ctx.doc(ev.document_id)?.document_type.startsWith('books') || typeof ev.value !== 'number') continue;
      const word = ev.label.split(' ')[0]!;
      const note = notes.find((n) => /personal/i.test(n.text) && word.length > 3 && n.text.includes(word));
      if (!note) continue;
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
```

`src/core/checks/property.ts`:
```ts
import { formatValue } from '../format';
import { lineRef } from '../refs/refs';
import type { Check, Finding } from './types';

const IMPROVEMENT_WORDS = /install|replac|new [\w-]+ (?:system|unit)|permit|warranty/i;

const repairVsImprovement: Check = {
  id: 'T6', title: 'Improvement expensed as a repair', kind: 'tax',
  run(ctx) {
    const repairs = ctx.version.lines.filter((l) => l.form === 'SchE' && /repair/i.test(l.label) && typeof l.value === 'number');
    const out: Finding[] = [];
    for (const doc of ctx.index.packet.documents.filter((d) => d.document_type === 'invoice')) {
      const text = doc.pages.map((p) => p.printed_content).join(' ');
      const total = /Total ([\d,]+\.\d{2})/.exec(text);
      if (!total || !IMPROVEMENT_WORDS.test(text)) continue;
      const amount = Number(total[1]!.replace(/,/g, ''));
      const line = repairs.find((l) => Number(l.value) >= amount);
      if (amount < 2500 || !line) continue;
      out.push({
        checkId: 'T6', key: doc.id, severity: 'warning',
        title: `${doc.issuer} invoice ${formatValue(amount)} looks like an improvement, not a repair`,
        refs: [doc.id, lineRef(ctx.version.version, line.key), ...line.sources],
        actual: Number(line.value), expected: Number(line.value) - amount,
        effect: ctx.whatIfEffect('hvac_improvement') ?? ctx.rateEffect('ordinary_income', amount),
        explain: `The invoice describes new equipment ("${IMPROVEMENT_WORDS.exec(text)![0]}…"). Replacing a whole system is a betterment or restoration: capitalize and depreciate.`,
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
    const expected = ctx.num('SchA.5b') - Number(credit.value);
    return [{
      checkId: 'T7a', key: credit.id, severity: 'error',
      title: `Property tax includes the seller's ${formatValue(credit.value)} share`,
      refs: [lineRef(ctx.version.version, 'SchA.5b'), credit.id, ...line.sources],
      expected, actual: ctx.num('SchA.5b'),
      effect: ctx.rateEffect('salt', -Number(credit.value), 'Federal effect is 0 while AMT applies; may cross the SALT cap'),
      explain: 'The buyer closing statement credits the seller for taxes before the purchase date; the buyer cannot deduct that portion.',
      nextAction: 'Deduct only the buyer-period tax.',
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
```

`src/core/checks/registry.ts`: import both and set `CHECKS = [...GENERIC_CHECKS, ...INCOME_CHECKS, ...BUSINESS_CHECKS, ...PROPERTY_CHECKS]`.

- [ ] **Step 4: Run** — `npx vitest run tests/core/checks/deductions.test.ts` — Expected: PASS (7 tests). `npm test` green.

- [ ] **Step 5: Checkpoint** — user reviews and commits.

---

### Task 6: Payment checks (T10a, T10b)

**Files:**
- Create: `src/core/checks/payments.ts`
- Modify: `src/core/checks/registry.ts`
- Test: `tests/core/checks/payments.test.ts`

**Interfaces:**
- Produces: `PAYMENT_CHECKS` (`T10a`, `T10b`).

- [ ] **Step 1: Write the failing tests**

`tests/core/checks/payments.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { makeContext } from '../../../src/core/checks/context';
import { PAYMENT_CHECKS } from '../../../src/core/checks/payments';
import { runChecks } from '../../../src/core/checks/registry';
import { buildIndex } from '../../../src/core/graph/index';
import { loadPacket } from '../../../src/core/packet/load';
import { hasRealPacket, readRealPacket } from '../../fixtures/realPacket';

describe.skipIf(!hasRealPacket)('payment checks on the real packet', () => {
  const r = loadPacket(readRealPacket());
  if (!r.ok) throw new Error(r.error);
  const index = buildIndex(r.packet);
  const ctx = makeContext(index);
  const run = (id: string) => PAYMENT_CHECKS.find((c) => c.id === id)!.run(ctx);

  it('T10a reconciles federal estimates to the IRS transcript', () => {
    const out = run('T10a');
    expect(out).toHaveLength(1);
    expect(out[0]!).toMatchObject({ expected: 12000, actual: 13000 });
    expect(out[0]!.effect).toMatchObject({ federal: 1000, california: 0, basis: 'direct' });
    expect(out[0]!.refs).toContain('agency:/irs_account_transcript_2025/0');
  });

  it('T10b removes the payment designated to the prior year', () => {
    const out = run('T10b');
    expect(out).toHaveLength(1);
    expect(out[0]!).toMatchObject({ expected: 10500, actual: 14000 });
    expect(out[0]!.effect).toMatchObject({ federal: 0, california: 3500, basis: 'direct' });
  });

  it('the full registry surfaces every planted error and nothing crashes', () => {
    const all = runChecks(index);
    expect(all.filter((f) => f.key === 'could-not-run')).toEqual([]);
    for (const id of ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7a', 'T7b', 'T8', 'T9', 'T10a', 'T10b', 'T11', 'T12']) {
      expect(all.some((f) => f.checkId === id)).toBe(true);
    }
    expect(all[0]!.checkId).toBe('T1');
  });
});
```

- [ ] **Step 2: Run to verify failure** — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`src/core/checks/payments.ts`:
```ts
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
    const onFile = snaps[i]!.transactions
      .filter((t) => t.code === '670' && /estimated tax/i.test(t.description) && typeof t.amount === 'number')
      .reduce((s, t) => s + Number(t.amount), 0);
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
```

`src/core/checks/registry.ts`: final form —
```ts
import type { PacketIndex } from '../graph/index';
import { BUSINESS_CHECKS } from './business';
import { makeContext } from './context';
import { GENERIC_CHECKS } from './generic';
import { INCOME_CHECKS } from './income';
import { PAYMENT_CHECKS } from './payments';
import { PROPERTY_CHECKS } from './property';
import { effectSize, NO_EFFECT, type Check, type Finding } from './types';

export const CHECKS: Check[] = [...GENERIC_CHECKS, ...INCOME_CHECKS, ...BUSINESS_CHECKS, ...PROPERTY_CHECKS, ...PAYMENT_CHECKS];
```
(followed by the unchanged `SEVERITY` and `runChecks`).

- [ ] **Step 4: Run** — `npm test` — Expected: all pass; the registry test confirms every check id fires, none crash, and the RSU finding ranks first.

- [ ] **Step 5: Checkpoint** — user reviews and commits.

---

### Task 7: Store findings, Inbox screen, trace for non-document refs

**Files:**
- Modify: `src/ui/store.ts`, `src/ui/App.tsx`, `src/ui/trace/TraceDrawer.tsx`
- Create: `src/ui/screens/InboxScreen.tsx`
- Test: `tests/ui/inbox.test.tsx`, extend `tests/ui/trace.test.tsx`

**Interfaces:**
- Consumes: `runChecks`, `Finding`, `effectSize`, `findingRef` (Tasks 2–6).
- Produces: store field `findings: Finding[]`; `InboxScreen()`; `EffectChips({ effect })`.

- [ ] **Step 1: Write the failing tests**

`tests/ui/inbox.test.tsx`:
```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { SimulatedDocumentSource } from '../../src/adapters/SimulatedDocumentSource';
import type { Finding } from '../../src/core/checks/types';
import { buildIndex } from '../../src/core/graph/index';
import { InboxScreen } from '../../src/ui/screens/InboxScreen';
import { useWorkpaper } from '../../src/ui/store';
import { miniPacket } from '../fixtures/miniPacket';

const f = (over: Partial<Finding>): Finding => ({
  checkId: 'T1', key: 'k', title: 'Basis missing', severity: 'error', refs: ['ev-0001'],
  effect: { federal: -6647, california: -649, basis: 'rate' }, explain: 'Why it matters', nextAction: 'Do this', ...over,
});

function setFindings(findings: Finding[]) {
  const index = buildIndex(miniPacket());
  useWorkpaper.setState({ status: 'ready', index, docs: new SimulatedDocumentSource(index), findings });
}

describe('InboxScreen', () => {
  beforeEach(() => { window.location.hash = ''; });

  it('shows ranked findings with estimated effects and totals', () => {
    setFindings([f({}), f({ checkId: 'G7', key: 'x', title: 'Swing', severity: 'info', effect: { federal: 0, california: 0, basis: 'none' } })]);
    render(<InboxScreen />);
    expect(screen.getByText('Basis missing')).toBeTruthy();
    expect(screen.getAllByText(/−6,647/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Also noted \(1\)/)).toBeTruthy();
    expect(screen.getAllByText(/estimate/i).length).toBeGreaterThan(0);
  });

  it('expands a finding and links its evidence into the trace', () => {
    setFindings([f({})]);
    render(<InboxScreen />);
    fireEvent.click(screen.getByText('Basis missing'));
    expect(screen.getByText('Why it matters')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'ev-0001' }));
    expect(window.location.hash).toContain('trace=ev-0001');
  });

  it('says so when nothing needs attention', () => {
    setFindings([]);
    render(<InboxScreen />);
    expect(screen.getByText(/Nothing needs attention/)).toBeTruthy();
  });
});
```

Append to `tests/ui/trace.test.tsx` (inside the `describe`):
```tsx
  it('describes client answers and agency records instead of "Unknown reference"', () => {
    const packet = miniPacket();
    packet.client = { questionnaire: [{ id: 'qa-25', question: 'Eligible?', answer: 'Yes', answered_by: 'N', answered_at: '' }] };
    const index = buildIndex(packet);
    useWorkpaper.setState({ status: 'ready', index, docs: new SimulatedDocumentSource(index) });
    render(<TraceDrawer refId="qa-25" />);
    expect(screen.getByText('Eligible?')).toBeTruthy();
    expect(screen.getByText('Yes')).toBeTruthy();
  });

  it('describes a prefixed ref it cannot render in detail', () => {
    render(<TraceDrawer refId="agency:/irs_account_transcript_2025/0" />);
    expect(screen.getByText(/Tax agency record/)).toBeTruthy();
  });
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/ui` — Expected: FAIL (InboxScreen missing; trace shows "Unknown reference").

- [ ] **Step 3: Store computes findings**

In `src/ui/store.ts`: add `findings: Finding[]` to `WorkpaperState` (import `type Finding` from `../core/checks/types` and `runChecks` from `../core/checks/registry`), initial `findings: []`, and in the success branch:
```ts
      const index = buildIndex(result.packet);
      set({
        status: 'ready', index, docs: new SimulatedDocumentSource(index), findings: runChecks(index),
        fingerprint: result.fingerprint, sourceLabel: source.label,
      });
```

- [ ] **Step 4: Inbox screen**

`src/ui/screens/InboxScreen.tsx`:
```tsx
import { useState } from 'react';
import { effectSize, type Effect, type Finding } from '../../core/checks/types';
import { navigate, useRoute, withTrace } from '../router';
import { useWorkpaper } from '../store';

const money = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('en-US')}`;

export function EffectChips({ effect }: { effect: Effect }) {
  if (effect.basis === 'none') return <span className="text-xs text-slate-400">{effect.note ? 'see note' : 'no tax effect'}</span>;
  const tone = (n: number) => (n > 0 ? 'bg-rose-50 text-rose-700' : n < 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-500');
  return (
    <span className="flex gap-1 font-mono text-xs" title={`${effect.basis === 'what_if' ? 'Engine what-if' : effect.basis === 'direct' ? 'Direct (1:1)' : 'Estimate from tax-effect rates'}${effect.note ? ` · ${effect.note}` : ''}`}>
      <span className={`rounded px-1.5 py-0.5 ${tone(effect.federal)}`}>Fed {money(effect.federal)}</span>
      <span className={`rounded px-1.5 py-0.5 ${tone(effect.california)}`}>CA {money(effect.california)}</span>
    </span>
  );
}

const DOT = { error: 'bg-rose-500', warning: 'bg-amber-400', info: 'bg-slate-300' } as const;

function Row({ f }: { f: Finding }) {
  const [open, setOpen] = useState(false);
  const route = useRoute();
  return (
    <li className="border-b border-slate-100">
      <button className="flex w-full items-center gap-3 px-2 py-2 text-left hover:bg-slate-50" onClick={() => setOpen(!open)}>
        <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[f.severity]}`} />
        <span className="flex-1 text-sm">{f.title}</span>
        <span className="font-mono text-xs text-slate-400">{f.checkId}</span>
        <EffectChips effect={f.effect} />
      </button>
      {open && (
        <div className="mb-3 ml-7 space-y-2 text-sm">
          <p>{f.explain}</p>
          {(f.expected !== undefined || f.actual !== undefined) && (
            <p className="font-mono text-xs">
              {f.actual !== undefined && <>return has {String(f.actual)}</>}
              {f.expected !== undefined && <> · evidence supports {String(f.expected)}</>}
            </p>
          )}
          <p className="text-slate-600"><strong>Next:</strong> {f.nextAction}</p>
          {f.effect.note && <p className="text-xs text-slate-500">{f.effect.note}</p>}
          <div className="flex flex-wrap gap-2">
            {f.refs.map((r) => (
              <button key={r} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-sky-700 hover:underline" onClick={() => navigate(withTrace(route, r))}>
                {r}
              </button>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}

export function InboxScreen() {
  const { findings, index } = useWorkpaper();
  if (!index) return null;
  const main = findings.filter((f) => f.severity !== 'info');
  const info = findings.filter((f) => f.severity === 'info');
  const total = main.reduce((s, f) => ({ federal: s.federal + f.effect.federal, california: s.california + f.effect.california }), { federal: 0, california: 0 });
  const diagnostics = index.versions.get(index.latest)!.diagnostics;

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">Inbox</h1>
      {main.length === 0 && info.length === 0 ? (
        <p className="mt-4 text-slate-500">Nothing needs attention.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-slate-500">
            {main.length} findings need a decision, ranked by estimated tax effect. If all were accepted:{' '}
            <EffectChips effect={{ ...total, basis: 'rate', note: 'Sum of linear estimates; large changes can cross thresholds' }} />
          </p>
          <ul className="mt-4">{[...main].sort((a, b) => effectSize(b.effect) - effectSize(a.effect)).map((f) => <Row key={`${f.checkId}/${f.key}`} f={f} />)}</ul>
          {info.length > 0 && (
            <details className="mt-6">
              <summary className="cursor-pointer text-sm text-slate-600">Also noted ({info.length})</summary>
              <ul className="mt-2">{info.map((f) => <Row key={`${f.checkId}/${f.key}`} f={f} />)}</ul>
            </details>
          )}
        </>
      )}
      <details className="mt-6">
        <summary className="cursor-pointer text-sm text-slate-600">Engine diagnostics ({diagnostics.length})</summary>
        <ul className="mt-2 space-y-1 text-sm">
          {diagnostics.map((d) => <li key={d.code}><span className="font-mono text-xs">{d.code}</span> {d.message}</li>)}
        </ul>
      </details>
    </div>
  );
}
```

- [ ] **Step 5: Nav and default screen**

In `src/ui/App.tsx`: set
```tsx
const NAV = [
  { path: 'inbox', label: 'Inbox' },
  { path: 'return', label: 'Return' },
  { path: 'documents', label: 'Documents' },
];
```
`const screen = route.path[0] ?? 'inbox';`, and render
```tsx
{screen === 'documents' ? <DocumentsScreen /> : screen === 'return' ? <ReturnScreen /> : <InboxScreen />}
```
(import `InboxScreen`). In the nav, show the count of non-info findings next to "Inbox": `{n.path === 'inbox' && <span className="ml-1 rounded bg-rose-100 px-1.5 text-xs text-rose-700">{findings.filter((f) => f.severity !== 'info').length}</span>}` (read `findings` from the store).

- [ ] **Step 6: Trace drawer for client, agency, prior-year and param refs**

In `src/ui/trace/TraceDrawer.tsx`, before the final `else`, add:
```tsx
  } else if (parsed.kind === 'client') {
    const client = index.packet.client as {
      questionnaire?: { id: string; question: string; answer: string; answered_by?: string }[];
      messages?: { id: string; from: string; sent_at: string; text: string }[];
      call_notes?: { id: string; date: string; notes: string[] }[];
    };
    const qa = client.questionnaire?.find((q) => q.id === refId);
    const msg = client.messages?.find((m) => m.id === refId);
    const call = client.call_notes?.find((c) => c.id === refId);
    body = qa ? (
      <><p className="text-xs text-slate-500">Questionnaire · {qa.answered_by}</p><h2 className="text-lg font-semibold">{qa.question}</h2><p className="mt-2 rounded bg-slate-50 p-2">{qa.answer}</p><UsedBy refId={refId} /></>
    ) : msg ? (
      <><p className="text-xs text-slate-500">Message from {msg.from} · {msg.sent_at.slice(0, 10)}</p><p className="mt-2 rounded bg-slate-50 p-2">{msg.text}</p></>
    ) : call ? (
      <><p className="text-xs text-slate-500">Call notes · {call.date.slice(0, 10)}</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{call.notes.map((n) => <li key={n}>{n}</li>)}</ul></>
    ) : (
      <p className="text-sm text-slate-600">Unknown reference <span className="font-mono">{refId}</span>.</p>
    );
  } else if (parsed.kind === 'prefixed') {
    const label = { agency: 'Tax agency record', py: 'Prior-year record', ref: 'Engine parameter', household: 'Household member', asset: 'Asset', timeline: 'Timeline event', group: 'Group', ext: 'Related return', finding: 'Finding', area: 'Area' }[parsed.prefix];
    body = (
      <><p className="text-xs text-slate-500">{label}</p><p className="font-mono text-sm">{parsed.rest}</p><UsedBy refId={refId} /></>
    );
```

- [ ] **Step 7: Run everything**

Run: `npm test && npm run typecheck && npm run build` — Expected: all pass.
Manual (`npm run dev`): the app opens on the Inbox; the RSU basis findings lead (Fed −6,647 / −6,647 / −2,242); T4 SE health insurance, T6 HVAC, T2 1099-K follow; expanding a row shows explanation, return-vs-evidence and next step; clicking `ev-0498` opens the trace with the page; clicking `qa-25` shows the client's answer; "Also noted" holds the year-over-year swings, uncited documents and low-confidence reads.

- [ ] **Step 8: Checkpoint** — user reviews and commits. Plan 2 complete: spec build step 3 delivered.
