import { landingsOfDocument, type PacketIndex } from '../graph/index';
import type { Document } from '../packet/types';

export interface DocumentSummary {
  doc: Document; late: boolean; corrected: boolean; superseded: boolean; used: boolean;
  valueCount: number; landedCount: number;
}

export function documentSummaries(index: PacketIndex, version = index.latest): DocumentSummary[] {
  const v = index.versions.get(version)!;
  const uploadComplete = index.packet.timeline.find((t) => t.event === 'client_marked_upload_complete')?.at;
  return index.packet.documents.map((doc) => {
    const landings = landingsOfDocument(index, doc.id, version);
    return {
      doc,
      late: uploadComplete !== undefined && doc.received_at > uploadComplete,
      corrected: doc.marked_corrected === true,
      superseded: v.documents_superseded.includes(doc.id),
      used: v.documents_used.includes(doc.id),
      valueCount: landings.length,
      landedCount: landings.filter((l) => l.lines.length > 0).length,
    };
  });
}
