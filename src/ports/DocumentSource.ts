import type { ExtractedValue } from '../core/packet/types';

export interface Highlight {
  ev: ExtractedValue;
  span: { start: number; end: number } | null;
  missing?: 'not_printed' | 'not_found';
}

export interface PageView {
  docId: string;
  page: number;
  text: string;
  highlights: Highlight[];
}

export interface DocumentSource {
  getPage(docId: string, page: number): PageView | null;
}
