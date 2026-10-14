import { existsSync, readFileSync } from 'node:fs';

export const REAL_PACKET_PATH = 'public/packet.json';
export const hasRealPacket = existsSync(REAL_PACKET_PATH);
export function readRealPacket(): unknown {
  return JSON.parse(readFileSync(REAL_PACKET_PATH, 'utf8'));
}
