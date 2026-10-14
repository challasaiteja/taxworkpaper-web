import type { ReactNode } from 'react';
import { formatValue } from '../../core/format';
import type { Highlight, PageView } from '../../ports/DocumentSource';

export function PageText({ view, selectedEvId, onSelect }: {
  view: PageView; selectedEvId?: string; onSelect(evId: string): void;
}) {
  const bySpan = new Map<number, Highlight[]>();
  for (const h of view.highlights) {
    if (h.span) bySpan.set(h.span.start, [...(bySpan.get(h.span.start) ?? []), h]);
  }
  const notPrinted = view.highlights.filter((h) => h.missing === 'not_printed');
  const notFound = view.highlights.filter((h) => h.missing === 'not_found');
  const overlapping: Highlight[] = [];

  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const [start, group] of [...bySpan].sort((a, b) => a[0] - b[0])) {
    const end = Math.max(...group.map((h) => h.span!.end));
    if (start < cursor) {
      overlapping.push(...group);
      continue;
    }
    parts.push(view.text.slice(cursor, start));
    const selected = group.find((h) => h.ev.id === selectedEvId);
    parts.push(
      <mark
        key={start}
        title={group.map((h) => `${h.ev.id} · ${h.ev.label}`).join('\n')}
        onClick={() => onSelect((selected ?? group[0]!).ev.id)}
        className={`cursor-pointer rounded px-0.5 ${selected ? 'bg-amber-300 ring-2 ring-amber-500' : 'bg-sky-100 hover:bg-sky-200'}`}
      >
        {view.text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  parts.push(view.text.slice(cursor));

  return (
    <div>
      <div className="rounded border border-slate-200 bg-slate-50 p-6 font-serif leading-7 shadow-sm">{parts}</div>
      <MissingList
        items={notPrinted} onSelect={onSelect} tone="border-amber-300 bg-amber-50 text-amber-900"
        title="Not printed on this page — extracted anyway:"
      />
      <MissingList
        items={notFound} onSelect={onSelect} tone="border-slate-300 bg-slate-50 text-slate-700"
        title="Could not locate on this page (checkbox, reformatted, or misread):"
      />
      <MissingList
        items={overlapping} onSelect={onSelect} tone="border-slate-300 bg-slate-50 text-slate-700"
        title="Located inside another highlighted value:"
      />
    </div>
  );
}

function MissingList({ items, title, tone, onSelect }: {
  items: Highlight[]; title: string; tone: string; onSelect(evId: string): void;
}) {
  if (!items.length) return null;
  return (
    <div className={`mt-3 rounded border p-3 text-sm ${tone}`}>
      <p className="font-medium">{title}</p>
      <ul className="mt-1 space-y-1">
        {items.map((h) => (
          <li key={h.ev.id}>
            <button className="underline" onClick={() => onSelect(h.ev.id)}>
              {h.ev.label} = {formatValue(h.ev.value)}
            </button>{' '}
            <span className="opacity-80">({h.ev.id}, read as “{h.ev.text_as_read}”, confidence {h.ev.confidence})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
