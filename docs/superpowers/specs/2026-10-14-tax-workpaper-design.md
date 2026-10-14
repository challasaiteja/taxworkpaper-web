# Tax Workpaper PoC — Design Spec

Date: 2026-10-14 · Status: approved in design discussion, pending spec review
Brief: MiraFlores case study "Redesign the Tax Workpaper" · Data: `okafor_lindqvist_2025_packet.json` (packet v1)

## 1. Goal

A demo-grade, link-runnable web app that proves the Okafor-Lindqvist 2025 return is right: where every number came from,
what was done to it, who checked it, and what is still open. Not a spreadsheet and not a recreated binder.

Success: a reviewer opens the link, the packet loads with zero clicks, the planted errors surface ranked by tax effect,
any number traces to a highlighted field on its source page, and the review → sign-off → filing → notice story can be
walked end to end with a role switcher. The code is a PoC but structured so each infrastructure piece is swappable.

Out of scope: document extraction, tax computation (the engine is given and cannot be rerun), real auth, real
multi-machine collaboration, real e-file transmission, LLM features at runtime.

## 2. Decisions

| Decision | Choice | Why |
|---|---|---|
| Architecture | Browser-only SPA with a pure core behind ports (option A) | Fastest to a link; scale by swapping adapters |
| Packet loading | Bundled default **and** drag-drop/file upload | Zero-click demo + proves "as delivered" |
| Intelligence | Deterministic checks only; no LLM at runtime | Auditable, reproducible, "doesn't trust the engine". AI used at build time to discover errors |
| Persistence | Append-only event log in IndexedDB | Freeze/amend/replay/undo fall out of it |
| Multi-user | Simulated: role switcher + cross-tab live sync | Option A trade-off, stated openly |
| Hosting | Vercel, static build (the full interactive app; no server code) | Free, never sleeps |
| Git | Branch `workpaper-poc`, commit locally; user pushes | User preference |

## 3. Input and output

**Input 1 — packet (read-only):** 74 documents with printed page text (truth), 3,012 extracted values (can be wrong at
high confidence), return versions v1/v2/v3 (lines with rule/inputs/sources, diagnostics, assets, tax_effect_rates),
client questionnaire/messages/call notes, prior years, IRS/FTB records, firm (staff, standards, budgets, deadlines),
timeline (scripted through the 2028 notice), what-ifs.

**Input 2 — user actions:** verifications, adjustments, notes, questions, judgments, sign-offs, approvals, filings.

**Output:** (1) the interactive workpaper; (2) the event log (the workpaper record); (3) the final position:
v3 + accepted adjustments, proof status per line, carryovers to 2026. Derived on demand: client copy, frozen filed
snapshot, notice package.

## 4. Data model

### 4.1 Packet
Validated with zod on load; fingerprinted (stable hash). Never mutated.

### 4.2 Ref — universal address
Reuses packet reference formats: `D28`, `D28#page3`, `ev-0498`, `qa-25`, `msg-07`, `call-01`, `asset:<id>`,
`agency:/<pointer>`, `py:/<pointer>`, `timeline:<id>`, `household:<id>`, `ref:param.<name>`. Additions:
`line:<version>/<key>` (e.g. `line:v3/F1040.1a`), `group:<scope>` (e.g. `group:D74/lots`), `ext:<id>` (related returns
not in the packet, e.g. Ada's return, the 1120S), `finding:<checkId>/<key>`, `area:<id>`. Every link, note, sign-off,
search hit and URL is a Ref. Real PDFs later change the renderer, not the Refs.

### 4.3 Graph (derived on load)
- line → line (`inputs`), line → source (`sources`), extracted value → page (+ `position` highlight box).
- Reverse index of each: document → everywhere it landed.
- `upstream(ref)`: transitive closure used for fingerprints.
- Prior-year mapping table `line:v3/X ↔ py:/lines/Y` (hand-curated where keys are positional, e.g. Schedule B).

### 4.4 Event log (the only persisted state)
Envelope: `{id, clientId, packetFingerprint, at, actor, role, type, refs[], payload, batchId, scenario}`.
`scenario` = `"live"` or a named what-if. `batchId` groups bulk actions; undo appends a reversing event per batch.

Types:
- Evidence: `verified{method (firm verification_types), note}`, `attached{file|message|note}`,
  `linked{from, to, relation}`, `document.disposition{used|duplicate_of|superseded_by|reference_only|not_relevant, target?, reason}`.
- Change: `adjusted{ref, old, new, reason, taxEffect}`, `adjustment.reverted{eventId}`.
- Review: `note.opened{blocking, text}`, `note.resolved`, `question.asked{to: client|staff, text}`,
  `question.answered{text}` (answer becomes evidence), `judgment.recorded{kind: election|due_diligence|penalty|position|other, text}`,
  `area.concluded{area}`, `outside_filing.recorded{form, status, reason}`, `signed_off{level, scope: Ref[], fingerprint}`,
  `assigned{ref|area, to, due}`.
- Filing: `approved_8879` (a sign-off whose scope is the return totals), `filed`, `efile.rejected`, `efile.accepted`,
  `frozen{snapshotAt}`, `amendment.opened`.
- Firm: `standards.changed`, `time.logged{area, hours}`, `viewed_sensitive{ref}`, `seen{at}` (per user).

Packet timeline events are read-only "system events" merged with user events on one time axis.

### 4.5 State = replay(packet, events, atTime?)
- Current value of a ref = packet value with live accepted adjustments applied; original always retained.
- Sign-off stale ⇔ fingerprint(current upstream values of scope) ≠ stored fingerprint. Same rule reopens the 8879.
- Proof status per line, precedence: `blocked` (open blocking note or failing check) > `stale` > `adjusted` >
  `verified` > `unverified`.
- Any past moment = replay to `atTime` → season replay, "since I last looked", filed copy, notice record.
- Frozen: after `frozen`, writes to the filed scenario are refused except inside an amendment.

### 4.6 Findings (computed, never stored)
`{checkId, key, severity, refs[], expected, actual, delta, taxEffect{federal, california, estimate: true}, explain, nextAction}`.
Status (open / explained / fixed) derived from events referencing `finding:<checkId>/<key>`.

### 4.7 Policy (enforced before append)
`policy(state, actor, event) → ok | {denied, reason}`. Rules (from firm standards, editable by admin):
- Roles: preparer (st-01, st-04), reviewer (st-02), partner (st-03, sole signer/ERO), admin (st-05), quality reviewer (st-06), client, examiner (read-only frozen).
- No sign-off on your own work; reviewer cannot review an item they performed (e.g. Daniel filed the extension).
- Adjustments with |tax effect| > $1,000 require partner sign-off.
- Staff without `sensitive_data_clearance` see SSN/bank/IP PIN/8879 PINs masked; every unmasked view logs `viewed_sensitive`.
- Staff cannot act before `active_from`.
- Filing gate: no open blocking notes, no stale sign-offs, all documents dispositioned, all areas concluded, outside filings recorded, current 8879.

### 4.8 Tax effect
Adjustments propagate deterministically through pure-sum lines (rule R-SUM); tax effect = Δ × v3
`tax_effect_rates[category]` (federal and California; `ca_source_income` for fully CA-source items); credits/payments 1:1.
Always labeled **estimate**; warn when the change may cross a threshold (e.g. AGI around $400k CTC phase-out, AMT).

## 5. Architecture

```
src/
  core/        pure TS — no React, no browser APIs (lint-enforced)
    packet/    zod schema, load, fingerprint, types
    refs/      parse/format
    graph/     indexes, reverse index, upstream, prior-year map
    events/    event types, policy
    state/     replay(), staleness, proof status, dispositions, gate
    checks/    registry: generic rules + tax-rule library
    effects/   sum propagation, rate-based tax effect
    views/     CPA records data (books-to-tax, state split, depreciation, YoY, prior vs us, notice package)
  ports/       EventStore, PacketSource, DocumentSource, TaxEffectEngine, Sync
  adapters/    IndexedDbEventStore, BroadcastChannelSync, BundledPacket, UploadedPacket,
               SimulatedDocumentSource, RateTaxEffectEngine
  ui/          React screens/components
```

Stack: Vite, React 18, TypeScript, zustand (single store; derived state via memoized selectors calling core), zod, idb,
@tanstack/react-virtual, hash routing (every Ref is a URL, e.g. `#/trace/ev-0498`), Tailwind, Vitest. No grid library.

Production swaps (one adapter each): IndexedDB → Postgres/event-store API; BroadcastChannel → WebSocket;
simulated pages → PDF.js with the same highlight coordinates; rate engine → real recompute service.

## 6. Checks

Generic (work on any packet):
- G1 value-not-on-page: extracted value absent from the page's printed text, or `text_as_read` empty while a value exists.
- G2 duplicate page/document: near-identical page content.
- G3 duplicate amount across documents: same payer + amount on two documents both feeding the return.
- G4 detail ≠ printed total: sum of lots/items vs the form's printed total; unread pages.
- G5 superseded/corrected document still used; document never cited by any line.
- G6 identity mismatch: household SSN/EIN vs prior-year return and documents.
- G7 year-over-year variance: firm thresholds (percent and amount).
- G8 low confidence: shown but de-emphasized (confidence is not correctness).

Tax rules (library), each mapped to a planted error:

| Check | Error caught | Est. effect (v3 rates) |
|---|---|---|
| T1 RSU/noncovered lot basis missing while W-2 includes RSU income | RSU basis 0 (D28 N1/N3/N4) | Fed −15,536 · CA −2,445 |
| T2 Schedule C receipts vs books; 1099-K inside 1099-NEC | 1099-K double count | Fed −4,402 · CA −384 |
| G3 | Northlake interest 1,840 twice (D28/D29) | Fed −640 · CA −127 |
| G2 | Mileage page 3 duplicate scan (11,800 → 8,100 mi) | Fed +919 · CA +80 |
| T3 personal-use share of business expenses | Phone/internet/Spotify | Fed +541 · CA +47 |
| T4 SE health insurance vs spouse-plan eligibility (qa-25) | SEHI 14,400 | Fed +4,464 · CA +605 |
| T5 SEP contribution limit | Excess ~2,786–4,326; withdraw by 10-15-2026 | Fed +477 · CA +65 |
| T6 repair vs improvement heuristic (judgment flag) | HVAC 11,000 | Fed +3,633 · CA +896 |
| T7 closing statement: seller's property tax share; payoff interest | 6,912 tax; 2,150 interest twice | CA +332; Fed +559 · CA +103 |
| T8 noncash gift vs 1098-C gross proceeds | Car 6,000 vs 2,900 | Fed +806 · CA +149 |
| T9 FX rate year vs tax year | SEK at 2024 average | Fed +43 · CA +9 |
| T10 estimated payments vs IRS transcript / FTB account incl. year designation | Q4 4,000 vs 3,000; CA 3,500 designated to 2024 | Fed balance +1,000; CA refund −3,500 |
| T11 W-2 state wages > box 1; residency split vs paystub | CA wages 111,300 / 218,400 | CA −5,685 |
| T12 transfer-in lot without basis/date | Crypto C6 | Fed −1,312 · CA −195 |
| G1 | Daycare provider EIN transposed (ev-1045) | Form 2441 at risk |
| G6 | Theo SSN …3309 vs …3390 (causes 07-13 e-file reject) | Child tax credit at risk |
| G4 | Meridian page 32 lot M18 unread | Fed −21 |
| G1 | Invented "0.00" values (D08 box 10, D28 wash sales) | 0 |

Each check returns plain-language `explain` and `nextAction`. Engine diagnostics (13 in v3) are shown alongside, with
links to evidence that already answers them (msg-07, msg-08, D31 page 32).

## 7. User interface

Frame: top bar (client · role switcher · season clock · ⌘K search · filing-readiness pill), left nav by **area**
(Overview, Wages & stock, Investments & crypto, Business, Rentals & sale, Pass-throughs & basis, Deductions & credits,
Foreign, States, Payments, Filing), right **trace drawer** on any number (derivation tree, source page with highlighted
field, original vs current, history, verification, notes, links, thread).

Screens: Overview · Inbox (ranked by tax effect, quick actions, bulk with undo) · Area pages (story, reconciliations,
exceptions-first detail, area sign-off) · Documents (disposition, landed-in, badges, viewer with highlights, unread
pages) · Changes (v1/v2/v3, any two moments, prior preparer vs us, what-ifs) · Filing room (gate, 8879, e-file,
freeze, amend, client copy, extension) · Notice room (Letter 566 package from frozen state, export) · Firm (staff,
standards, time vs budget, view log) · Records (CPA schedules as printable views).

Role views: client = plain-language summary + questions + approve/sign; examiner = frozen copy read-only + notice
package; Marcus = masked sensitive fields. Day-one hire: every finding explains why and what next. Veteran: keyboard
(j/k, v verify, a adjust, n note), dense layout.

## 8. Build steps (each ends runnable, committed locally)

1. Scaffold; packet load (bundled + upload) and validation; refs; graph.
2. Documents screen, simulated pages with highlights, trace drawer.
3. Checks engine (generic + tax rules, one test per planted error); Inbox.
4. Event log + replay; adjust/verify/notes/undo; tax effect; area pages.
5. Roles + policy, masking, view log, stale sign-offs, cross-tab sync.
6. Season clock, Changes screen, what-ifs.
7. Filing room (gate, 8879, e-file reject/accept, freeze, amend); client view.
8. Notice room, carryforward, Firm screen, Records.
9. Deploy to Vercel; one-pager, errors write-up, AI-usage note.

Steps 1–5 alone are a credible demo.

## 9. Testing

Vitest on core: one test per planted error asserting its check fires (doubles as the errors write-up evidence);
replay determinism; staleness on upstream change; policy denials (self-review, uncleared access, frozen writes,
>$1,000 without partner). UI: render smoke test + manual walkthrough per step.

## 10. Open decisions

- Packet in a **public** repo: keep `packet.json` gitignored and include it at deploy, or make the repo private.
  Decide before the first commit that would include it. (Verify Vercel CLI handling of gitignored files at step 9.)
