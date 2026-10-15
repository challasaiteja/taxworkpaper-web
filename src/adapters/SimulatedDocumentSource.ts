import { locateOnPage } from '../core/documents/locate';
import type { PacketIndex } from '../core/graph/index';
import { pageRef } from '../core/refs/refs';
import type { DocumentSource, Highlight, PageView } from '../ports/DocumentSource';

// Pages are rendered from printed_content; positions are synthetic, so y0 is used only
// to order values against repeated occurrences of the same printed text.
export class SimulatedDocumentSource implements DocumentSource {
  constructor(private index: PacketIndex) {}

  getPage(docId: string, page: number): PageView | null {
    const text = this.index.docs.get(docId)?.pages.find((p) => p.page === page)?.printed_content;
    if (text === undefined) return null;
    const evs = this.index.evsByPage.get(pageRef(docId, page)) ?? [];
    const spans = locateOnPage(text, evs);
    const highlights: Highlight[] = evs.map((ev) => {
      const span = spans.get(ev.id) ?? null;
      if (span) return { ev, span };
      return { ev, span: null, missing: ev.text_as_read ? 'not_found' : 'not_printed' };
    });
    return { docId, page, text, highlights };
  }
}
