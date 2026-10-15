import type { ExtractedValue } from '../packet/types';

const WORD = /[A-Za-z0-9]/;

// A hit must be a whole token: "0.00" must not match inside "2,500.00".
function isBoundary(text: string, start: number, end: number): boolean {
  const before = text[start - 1] ?? ' ';
  const after = text[end] ?? ' ';
  const beforeJoin = /[.,]/.test(before) && /\d/.test(text[start - 2] ?? '');
  const afterJoin = /[.,]/.test(after) && /\d/.test(text[end + 1] ?? '');
  return !WORD.test(before) && !WORD.test(after) && !beforeJoin && !afterJoin;
}

function occurrences(text: string, needle: string): number[] {
  const out: number[] = [];
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) {
    if (isBoundary(text, i, i + needle.length)) out.push(i);
  }
  return out;
}

// text_as_read is normalized by the pipeline (dates as MM/DD/YYYY, amounts without
// separators), so it does not always match the page; fall back to printed forms of value.
function candidates(ev: ExtractedValue): string[] {
  const out = [ev.text_as_read];
  const v = ev.value;
  if (typeof v === 'number' && ev.value_type === 'percent') {
    out.push(`${Math.round(v * 10000) / 100}%`);
  } else if (typeof v === 'number') {
    out.push(
      v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
      v.toLocaleString('en-US', { maximumFractionDigits: 4 }),
    );
  } else if (typeof v === 'string') {
    out.push(v);
  }
  return [...new Set(out.filter((c, i) => c && (i === 0 || c.length >= 2)))];
}

// Values sharing a needle are matched to its occurrences in page order (by y0).
// More values than occurrences means the page prints the figure once for several values.
function assign(group: ExtractedValue[], hits: number[], textLength: number): Map<string, number> {
  const sorted = [...group].sort((a, b) => a.position.y0 - b.position.y0);
  const out = new Map<string, number>();
  if (sorted.length === 1) {
    const target = sorted[0]!.position.y0 * textLength;
    out.set(sorted[0]!.id, hits.reduce((best, h) => (Math.abs(h - target) < Math.abs(best - target) ? h : best)));
    return out;
  }
  sorted.forEach((ev, k) => {
    const i = sorted.length <= hits.length
      ? Math.round((k * (hits.length - 1)) / (sorted.length - 1))
      : Math.floor((k * hits.length) / sorted.length);
    out.set(ev.id, hits[i]!);
  });
  return out;
}

export function locateOnPage(text: string, evs: ExtractedValue[]): Map<string, { start: number; end: number } | null> {
  const needleOf = new Map<string, string>();
  const groups = new Map<string, ExtractedValue[]>();
  for (const ev of evs) {
    if (!ev.text_as_read) continue;
    const needle = candidates(ev).find((c) => occurrences(text, c).length > 0);
    if (!needle) continue;
    needleOf.set(ev.id, needle);
    groups.set(needle, [...(groups.get(needle) ?? []), ev]);
  }
  const out = new Map<string, { start: number; end: number } | null>();
  for (const ev of evs) out.set(ev.id, null);
  for (const [needle, group] of groups) {
    for (const [id, start] of assign(group, occurrences(text, needle), text.length)) {
      out.set(id, { start, end: start + needle.length });
    }
  }
  return out;
}
