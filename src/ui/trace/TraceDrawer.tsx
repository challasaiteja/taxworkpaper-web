import { useState, type ReactNode } from 'react';
import { formatValue } from '../../core/format';
import { consumersOf, inputRefs, sourceRefs } from '../../core/graph/index';
import { parseRef } from '../../core/refs/refs';
import { PageText } from '../components/PageText';
import { navigate, useRoute, withTrace } from '../router';
import { useWorkpaper } from '../store';

function RefLink({ refId }: { refId: string }) {
  const route = useRoute();
  return (
    <button className="font-mono text-xs text-sky-700 hover:underline" onClick={() => navigate(withTrace(route, refId))}>
      {refId}
    </button>
  );
}

function SourceRow({ refId }: { refId: string }) {
  const { index } = useWorkpaper();
  const ev = index!.evs.get(refId);
  if (!ev) return <li className="text-sm"><RefLink refId={refId} /></li>;
  const doc = index!.docs.get(ev.document_id);
  return (
    <li className="text-sm">
      <RefLink refId={refId} /> {ev.label} = <strong>{formatValue(ev.value)}</strong>
      <span className="block text-xs text-slate-500">{doc?.id} · {doc?.title} · page {ev.page}</span>
    </li>
  );
}

function LineTree({ refId, depth }: { refId: string; depth: number }) {
  const { index } = useWorkpaper();
  const [open, setOpen] = useState(depth < 2);
  const line = index!.lines.get(refId);
  if (!line) return <RefLink refId={refId} />;
  const inputs = inputRefs(index!, refId);
  const sources = sourceRefs(index!, refId);
  return (
    <div className="border-l border-slate-200 pl-3">
      <button className="flex w-full items-baseline gap-2 text-left text-sm" onClick={() => setOpen(!open)}>
        <span className="text-slate-400">{inputs.length + sources.length ? (open ? '▾' : '▸') : '·'}</span>
        <span className="flex-1">{line.label}</span>
        <span className="font-mono">{formatValue(line.value)}</span>
      </button>
      {open && (
        <div className="mb-1 ml-4 space-y-1">
          <p className="text-xs text-slate-500">{line.form} {line.line} · {line.rule}</p>
          {inputs.map((r) => <LineTree key={r} refId={r} depth={depth + 1} />)}
          {sources.length > 0 && <ul className="space-y-1">{sources.map((r) => <SourceRow key={r} refId={r} />)}</ul>}
        </div>
      )}
    </div>
  );
}

function UsedBy({ refId }: { refId: string }) {
  const { index } = useWorkpaper();
  const users = consumersOf(index!, refId).filter((r) => r.startsWith(`line:${index!.latest}/`));
  return (
    <section className="mt-4">
      <h3 className="text-xs font-semibold uppercase text-slate-500">Used by ({index!.latest})</h3>
      {users.length ? (
        <ul className="mt-1 space-y-0.5">{users.map((r) => <li key={r}><RefLink refId={r} /> {index!.lines.get(r)?.label}</li>)}</ul>
      ) : (
        <p className="mt-1 text-sm text-amber-700">Not used by any line in {index!.latest}.</p>
      )}
    </section>
  );
}

export function TraceDrawer({ refId }: { refId: string }) {
  const { index, docs } = useWorkpaper();
  const route = useRoute();
  if (!index || !docs) return null;
  const parsed = parseRef(refId);

  let body: ReactNode;
  if (parsed.kind === 'line' && index.lines.has(refId)) {
    const line = index.lines.get(refId)!;
    body = (
      <>
        <p className="text-xs text-slate-500">{line.jurisdiction} · {line.form} line {line.line} · {line.version}</p>
        <h2 className="text-lg font-semibold">{line.label}</h2>
        <p className="font-mono text-2xl">{formatValue(line.value)}</p>
        <p className="mt-1 text-xs text-slate-500">Rule {line.rule}</p>
        {line.note && <p className="mt-2 rounded bg-slate-50 p-2 text-sm">{line.note}</p>}
        <h3 className="mt-4 text-xs font-semibold uppercase text-slate-500">How it was built</h3>
        <div className="mt-1"><LineTree refId={refId} depth={0} /></div>
        <UsedBy refId={refId} />
      </>
    );
  } else if (parsed.kind === 'ev' && index.evs.has(refId)) {
    const ev = index.evs.get(refId)!;
    const doc = index.docs.get(ev.document_id);
    const view = docs.getPage(ev.document_id, ev.page);
    body = !doc ? (
      <p className="text-sm text-red-700">{ev.id} cites document {ev.document_id} is not in this packet.</p>
    ) : (
      <>
        <p className="text-xs text-slate-500">{ev.id} · {ev.field} · confidence {ev.confidence}</p>
        <h2 className="text-lg font-semibold">{ev.label}</h2>
        <p className="font-mono text-2xl">{formatValue(ev.value)}</p>
        <p className="text-xs text-slate-500">As read: “{ev.text_as_read || '(nothing printed)'}”</p>
        <button
          className="mt-3 text-sm text-sky-700 hover:underline"
          onClick={() => navigate({ path: ['documents', doc.id], page: ev.page, trace: ev.id })}
        >
          {doc.id} · {doc.title} · page {ev.page} →
        </button>
        {view && <div className="mt-2 text-sm"><PageText view={view} selectedEvId={ev.id} onSelect={(id) => navigate(withTrace(route, id))} /></div>}
        <UsedBy refId={refId} />
      </>
    );
  } else if ((parsed.kind === 'doc' || parsed.kind === 'page') && index.docs.has(parsed.docId)) {
    const doc = index.docs.get(parsed.docId)!;
    body = (
      <>
        <h2 className="text-lg font-semibold">{doc.id} · {doc.title}</h2>
        <button className="mt-2 text-sm text-sky-700 hover:underline" onClick={() => navigate({ path: ['documents', doc.id], page: parsed.kind === 'page' ? parsed.page : 1 })}>
          Open document →
        </button>
      </>
    );
  } else if (parsed.kind === 'client') {
    const client = index.packet.client as {
      questionnaire?: { id: string; question: string; answer: string; answered_by?: string }[];
      messages?: { id: string; from: string; sent_at: string; text: string }[];
      call_notes?: { id: string; date: string; notes: string[] }[];
    };
    const qa = client.questionnaire?.find((q) => q.id === refId);
    const msg = client.messages?.find((m) => m.id === refId);
    const call = client.call_notes?.find((c) => c.id === refId);
    body = qa ? (
      <><p className="text-xs text-slate-500">Questionnaire · {qa.answered_by}</p><h2 className="text-lg font-semibold">{qa.question}</h2><p className="mt-2 rounded bg-slate-50 p-2">{qa.answer}</p><UsedBy refId={refId} /></>
    ) : msg ? (
      <><p className="text-xs text-slate-500">Message from {msg.from} · {msg.sent_at.slice(0, 10)}</p><p className="mt-2 rounded bg-slate-50 p-2">{msg.text}</p></>
    ) : call ? (
      <><p className="text-xs text-slate-500">Call notes · {call.date.slice(0, 10)}</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{call.notes.map((n) => <li key={n}>{n}</li>)}</ul></>
    ) : (
      <p className="text-sm text-slate-600">Unknown reference <span className="font-mono">{refId}</span>.</p>
    );
  } else if (parsed.kind === 'prefixed') {
    const label = { agency: 'Tax agency record', py: 'Prior-year record', ref: 'Engine parameter', household: 'Household member', asset: 'Asset', timeline: 'Timeline event', group: 'Group', ext: 'Related return', finding: 'Finding', area: 'Area' }[parsed.prefix];
    body = (
      <><p className="text-xs text-slate-500">{label}</p><p className="font-mono text-sm">{parsed.rest}</p><UsedBy refId={refId} /></>
    );
  } else {
    body = <p className="text-sm text-slate-600">Unknown reference <span className="font-mono">{refId}</span>.</p>;
  }

  return (
    <aside className="w-[30rem] shrink-0 overflow-auto border-l border-slate-200 p-4">
      <div className="mb-2 flex justify-end">
        <button aria-label="Close trace" className="text-slate-400 hover:text-slate-700" onClick={() => navigate(withTrace(route))}>✕</button>
      </div>
      {body}
    </aside>
  );
}
