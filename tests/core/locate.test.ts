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
