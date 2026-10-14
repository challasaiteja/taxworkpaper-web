import { useMemo, type ReactNode } from 'react';
import { parseRef } from '../../core/refs/refs';
import { documentSummaries } from '../../core/views/documents';
import { PageText } from '../components/PageText';
import { navigate, useRoute, withTrace } from '../router';
import { useWorkpaper } from '../store';

function Badge({ children, tone }: { children: ReactNode; tone: string }) {
  return <span className={`rounded px-1.5 py-0.5 text-xs ${tone}`}>{children}</span>;
}

export function DocumentsScreen() {
  const { index, docs } = useWorkpaper();
  const route = useRoute();
  const summaries = useMemo(() => (index ? documentSummaries(index) : []), [index]);
  if (!index || !docs) return null;

  const docId = route.path[1];
  const doc = docId ? index.docs.get(docId) : undefined;

  if (doc) {
    const page = route.page ?? 1;
    const view = docs.getPage(doc.id, page);
    const traced = route.trace ? parseRef(route.trace) : undefined;
    return (
      <div className="p-6">
        <button className="text-sm text-sky-700" onClick={() => navigate({ path: ['documents'] })}>← All documents</button>
        <h1 className="mt-2 text-xl font-semibold">{doc.id} · {doc.title}</h1>
        <p className="text-sm text-slate-500">{doc.issuer} · {doc.file_name} · received {doc.received_at.slice(0, 10)}</p>
        <div className="my-3 flex flex-wrap gap-1">
          {doc.pages.map((p) => (
            <button
              key={p.page}
              className={`rounded px-2 py-0.5 text-sm ${p.page === page ? 'bg-slate-800 text-white' : 'bg-slate-100'}`}
              onClick={() => navigate({ ...route, page: p.page })}
            >
              p{p.page}
            </button>
          ))}
        </div>
        {view ? (
          <PageText
            view={view}
            selectedEvId={traced?.kind === 'ev' ? traced.id : undefined}
            onSelect={(evId) => navigate(withTrace(route, evId))}
          />
        ) : (
          <p className="text-slate-500">Page not found.</p>
        )}
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">Documents ({summaries.length})</h1>
      <ul className="mt-4 divide-y divide-slate-100">
        {summaries.map((s) => (
          <li key={s.doc.id}>
            <button
              className="flex w-full items-center gap-3 px-2 py-2 text-left hover:bg-slate-50"
              onClick={() => navigate({ path: ['documents', s.doc.id], page: 1 })}
            >
              <span className="w-10 font-mono text-sm text-slate-500">{s.doc.id}</span>
              <span className="flex-1">{s.doc.title}</span>
              {s.late && <Badge tone="bg-orange-100 text-orange-800">late</Badge>}
              {s.corrected && <Badge tone="bg-violet-100 text-violet-800">corrected</Badge>}
              {s.superseded && <Badge tone="bg-slate-200 text-slate-700">superseded</Badge>}
              {s.doc.extraction.status !== 'extracted' && (
                <Badge tone="bg-amber-100 text-amber-800">{s.doc.extraction.status.replace('_', ' ')}</Badge>
              )}
              <span className="w-28 text-right text-xs text-slate-500">{s.landedCount}/{s.valueCount} values landed</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
