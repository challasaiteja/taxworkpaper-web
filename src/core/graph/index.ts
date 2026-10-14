import type { Document, ExtractedValue, Line, Packet, ReturnVersion } from '../packet/types';
import { lineRef, pageRef, parseRef, type Ref } from '../refs/refs';

export interface PacketIndex {
  packet: Packet;
  docs: Map<string, Document>;
  evs: Map<string, ExtractedValue>;
  evsByPage: Map<Ref, ExtractedValue[]>;
  versions: Map<string, ReturnVersion>;
  lines: Map<Ref, Line & { version: string }>;
  consumers: Map<Ref, Ref[]>;
  latest: string;
}

function push(map: Map<Ref, Ref[]>, key: Ref, value: Ref) {
  const list = map.get(key);
  if (!list) map.set(key, [value]);
  else if (!list.includes(value)) list.push(value);
}

export function buildIndex(packet: Packet): PacketIndex {
  const docs = new Map(packet.documents.map((d) => [d.id, d]));
  const evs = new Map(packet.extracted_values.map((e) => [e.id, e]));
  const evsByPage = new Map<Ref, ExtractedValue[]>();
  for (const e of packet.extracted_values) {
    const key = pageRef(e.document_id, e.page);
    const list = evsByPage.get(key);
    if (list) list.push(e);
    else evsByPage.set(key, [e]);
  }
  const versions = new Map(packet.return_versions.map((v) => [v.version, v]));
  const lines = new Map<Ref, Line & { version: string }>();
  const consumers = new Map<Ref, Ref[]>();
  for (const v of packet.return_versions) {
    for (const l of v.lines) {
      const ref = lineRef(v.version, l.key);
      lines.set(ref, { ...l, version: v.version });
      for (const input of l.inputs) push(consumers, lineRef(v.version, input), ref);
      for (const source of l.sources) push(consumers, source, ref);
    }
  }
  const latest = packet.return_versions[packet.return_versions.length - 1]!.version;
  return { packet, docs, evs, evsByPage, versions, lines, consumers, latest };
}

export function inputRefs(index: PacketIndex, ref: Ref): Ref[] {
  const line = index.lines.get(ref);
  if (!line) return [];
  return [...new Set(line.inputs.map((k) => lineRef(line.version, k)))];
}

export function sourceRefs(index: PacketIndex, ref: Ref): Ref[] {
  return [...new Set(index.lines.get(ref)?.sources ?? [])];
}

export function consumersOf(index: PacketIndex, ref: Ref): Ref[] {
  return index.consumers.get(ref) ?? [];
}

export function upstream(index: PacketIndex, ref: Ref): Ref[] {
  const seen = new Set<Ref>();
  const stack = [ref];
  while (stack.length) {
    const current = stack.pop()!;
    for (const next of [...inputRefs(index, current), ...sourceRefs(index, current)]) {
      if (next === ref || seen.has(next)) continue;
      seen.add(next);
      if (parseRef(next).kind === 'line') stack.push(next);
    }
  }
  return [...seen];
}

export function landingsOfDocument(index: PacketIndex, docId: string, version = index.latest) {
  return index.packet.extracted_values
    .filter((e) => e.document_id === docId)
    .map((ev) => ({
      ev,
      lines: consumersOf(index, ev.id).filter((r) => r.startsWith(`line:${version}/`)),
    }));
}
