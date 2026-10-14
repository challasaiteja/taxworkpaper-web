import { create } from 'zustand';
import { SimulatedDocumentSource } from '../adapters/SimulatedDocumentSource';
import { buildIndex, type PacketIndex } from '../core/graph/index';
import { loadPacket } from '../core/packet/load';
import type { DocumentSource } from '../ports/DocumentSource';
import type { PacketSource } from '../ports/PacketSource';

interface WorkpaperState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error?: string;
  index?: PacketIndex;
  docs?: DocumentSource;
  fingerprint?: string;
  sourceLabel?: string;
  load(source: PacketSource): Promise<void>;
}

let latestLoad = 0;

export const useWorkpaper = create<WorkpaperState>((set) => ({
  status: 'idle',
  async load(source) {
    const loadId = ++latestLoad;
    set({ status: 'loading', error: undefined });
    try {
      const raw = await source.load();
      if (loadId !== latestLoad) return;
      const result = loadPacket(raw);
      if (!result.ok) {
        set({ status: 'error', error: result.error });
        return;
      }
      const index = buildIndex(result.packet);
      set({
        status: 'ready', index, docs: new SimulatedDocumentSource(index),
        fingerprint: result.fingerprint, sourceLabel: source.label,
      });
    } catch (e) {
      if (loadId !== latestLoad) return;
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  },
}));
