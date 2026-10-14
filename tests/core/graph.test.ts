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
