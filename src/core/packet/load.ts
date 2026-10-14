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
    const issues = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    const more = parsed.error.issues.length > 3 ? ` (+${parsed.error.issues.length - 3} more)` : '';
    return { ok: false, error: `Not a valid packet — ${issues.join('; ')}${more}` };
  }
  return { ok: true, packet: json as Packet, fingerprint: fingerprintOf(JSON.stringify(json)) };
}
