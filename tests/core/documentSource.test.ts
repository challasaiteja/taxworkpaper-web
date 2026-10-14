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
    const h = view.highlights.find((x) => x.ev.id === 'ev-0004')!;
    expect(h.span).toBeNull();
    expect(h.missing).toBe('not_printed');
  });

  it('falls back to the value in printed formats when text_as_read differs from the page', () => {
    const view = src.getPage('D01', 1)!;
    const h = view.highlights.find((x) => x.ev.id === 'ev-0005')!;
    expect(view.text.slice(h.span!.start, h.span!.end)).toBe('2025-02-15');
  });

  it('distinguishes printed-but-not-located from not printed', () => {
    const view = src.getPage('D01', 1)!;
    const h = view.highlights.find((x) => x.ev.id === 'ev-0006')!;
    expect(h.span).toBeNull();
    expect(h.missing).toBe('not_found');
  });

  it('returns null for an unknown page', () => {
    expect(src.getPage('D99', 1)).toBeNull();
    expect(src.getPage('D01', 5)).toBeNull();
  });

  it('gives values sharing printed text distinct occurrences, in page order', () => {
    const view = src.getPage('D03', 1)!;
    const a = view.highlights.find((x) => x.ev.id === 'ev-0010')!.span!;
    const b = view.highlights.find((x) => x.ev.id === 'ev-0011')!.span!;
    expect(a.start).toBe(view.text.indexOf('19,100.00'));
    expect(b.start).toBe(view.text.lastIndexOf('19,100.00'));
  });

  it('does not match inside a larger number', () => {
    const h = src.getPage('D03', 1)!.highlights.find((x) => x.ev.id === 'ev-0012')!;
    expect(h.span).toBeNull();
    expect(h.missing).toBe('not_found');
  });

  it('lets two values share one occurrence when the page prints it once', () => {
    const view = src.getPage('D03', 1)!;
    const s1 = view.highlights.find((x) => x.ev.id === 'ev-0013')!.span;
    const s2 = view.highlights.find((x) => x.ev.id === 'ev-0014')!.span;
    expect(s1).toEqual(s2);
    expect(s1).not.toBeNull();
  });

  it('locates one-decimal amounts and percentages printed as whole percents', () => {
    const view = src.getPage('D03', 1)!;
    const text = (id: string) => {
      const h = view.highlights.find((x) => x.ev.id === id)!;
      return view.text.slice(h.span!.start, h.span!.end);
    };
    expect(text('ev-0015')).toBe('228,409.0');
    expect(text('ev-0016')).toBe('22%');
  });
});
