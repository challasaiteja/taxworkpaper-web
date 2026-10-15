import { useEffect, useRef } from 'react';
import { BundledPacketSource, FilePacketSource } from '../adapters/packetSources';
import type { PacketSource } from '../ports/PacketSource';
import { navigate, useRoute } from './router';
import { DocumentsScreen } from './screens/DocumentsScreen';
import { InboxScreen } from './screens/InboxScreen';
import { ReturnScreen } from './screens/ReturnScreen';
import { useWorkpaper } from './store';
import { TraceDrawer } from './trace/TraceDrawer';

const NAV = [
  { path: 'inbox', label: 'Inbox' },
  { path: 'return', label: 'Return' },
  { path: 'documents', label: 'Documents' },
];

export function App({ source }: { source?: PacketSource }) {
  const { status, error, index, fingerprint, sourceLabel, findings, load } = useWorkpaper();
  const route = useRoute();
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void load(source ?? new BundledPacketSource());
  }, [load, source]);

  const screen = route.path[0] ?? 'inbox';

  return (
    <div className="flex h-screen flex-col bg-white text-slate-900">
      <header className="flex items-center gap-4 border-b border-slate-200 px-4 py-2">
        <span className="font-semibold">Tax Workpaper</span>
        {index && <span className="text-sm text-slate-600">{index.packet.packet.name} · {index.packet.packet.client_id}</span>}
        <span className="ml-auto text-xs text-slate-400">{sourceLabel} {fingerprint && `· ${fingerprint}`}</span>
        <button className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50" onClick={() => fileInput.current?.click()}>
          Load packet…
        </button>
        <input
          ref={fileInput} type="file" accept="application/json,.json" className="hidden" aria-label="Packet file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void load(new FilePacketSource(file));
            e.target.value = '';
          }}
        />
      </header>
      {status === 'loading' && <p className="p-6 text-slate-500">Loading packet…</p>}
      {status === 'error' && (
        <div role="alert" className="m-6 rounded border border-red-300 bg-red-50 p-4 text-red-800">
          <p className="font-medium">The packet could not be loaded.</p>
          <p className="mt-1 text-sm">{error}</p>
        </div>
      )}
      {status === 'ready' && index && (
        <div className="flex min-h-0 flex-1">
          <nav className="w-48 shrink-0 border-r border-slate-200 p-2">
            {NAV.map((n) => (
              <button
                key={n.path}
                className={`block w-full rounded px-3 py-1.5 text-left text-sm ${screen === n.path ? 'bg-slate-100 font-medium' : 'hover:bg-slate-50'}`}
                onClick={() => navigate({ path: [n.path] })}
              >
                {n.label}
                {n.path === 'inbox' && (
                  <span className="ml-1 rounded bg-rose-100 px-1.5 text-xs text-rose-700">
                    {findings.filter((f) => f.severity !== 'info').length}
                  </span>
                )}
              </button>
            ))}
          </nav>
          <main className="min-w-0 flex-1 overflow-auto">
            {screen === 'documents' ? <DocumentsScreen /> : screen === 'return' ? <ReturnScreen /> : <InboxScreen />}
          </main>
          {route.trace && <TraceDrawer refId={route.trace} />}
        </div>
      )}
    </div>
  );
}
