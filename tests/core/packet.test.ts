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
