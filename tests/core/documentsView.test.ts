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
