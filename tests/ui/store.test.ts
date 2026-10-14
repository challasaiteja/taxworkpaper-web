import { describe, expect, it } from 'vitest';
import type { PacketSource } from '../../src/ports/PacketSource';
import { useWorkpaper } from '../../src/ui/store';
import { miniPacket } from '../fixtures/miniPacket';

const delayed = (label: string, ms: number): PacketSource => ({
  label,
  load: () => new Promise((resolve) => setTimeout(() => resolve(miniPacket()), ms)),
});

describe('store', () => {
  it('keeps the most recently requested packet when an older load finishes last', async () => {
    const slow = useWorkpaper.getState().load(delayed('bundled', 40));
    const fast = useWorkpaper.getState().load(delayed('upload.json', 5));
    await Promise.all([slow, fast]);
    expect(useWorkpaper.getState().sourceLabel).toBe('upload.json');
  });
});
