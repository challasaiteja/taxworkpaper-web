import { useState } from 'react';
import { effectSize, type Effect, type Finding } from '../../core/checks/types';
import { navigate, useRoute, withTrace } from '../router';
import { useWorkpaper } from '../store';

const money = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('en-US')}`;

export function EffectChips({ effect }: { effect: Effect }) {
  if (effect.basis === 'none') return <span className="text-xs text-slate-400">{effect.note ? 'see note' : 'no tax effect'}</span>;
  const tone = (n: number) => (n > 0 ? 'bg-rose-50 text-rose-700' : n < 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-500');
  return (
    <span className="flex gap-1 font-mono text-xs" title={`${effect.basis === 'what_if' ? 'Engine what-if' : effect.basis === 'direct' ? 'Direct (1:1)' : 'Estimate from tax-effect rates'}${effect.note ? ` · ${effect.note}` : ''}`}>
      <span className={`rounded px-1.5 py-0.5 ${tone(effect.federal)}`}>Fed {money(effect.federal)}</span>
      <span className={`rounded px-1.5 py-0.5 ${tone(effect.california)}`}>CA {money(effect.california)}</span>
    </span>
  );
}

const DOT = { error: 'bg-rose-500', warning: 'bg-amber-400', info: 'bg-slate-300' } as const;

function Row({ f }: { f: Finding }) {
  const [open, setOpen] = useState(false);
  const route = useRoute();
  return (
    <li className="border-b border-slate-100">
      <button className="flex w-full items-center gap-3 px-2 py-2 text-left hover:bg-slate-50" onClick={() => setOpen(!open)}>
        <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[f.severity]}`} />
        <span className="flex-1 text-sm">{f.title}</span>
        <span className="font-mono text-xs text-slate-400">{f.checkId}</span>
        <EffectChips effect={f.effect} />
      </button>
      {open && (
        <div className="mb-3 ml-7 space-y-2 text-sm">
          <p>{f.explain}</p>
          {(f.expected !== undefined || f.actual !== undefined) && (
            <p className="font-mono text-xs">
              {f.actual !== undefined && <>return has {String(f.actual)}</>}
              {f.expected !== undefined && <> · evidence supports {String(f.expected)}</>}
            </p>
          )}
          <p className="text-slate-600"><strong>Next:</strong> {f.nextAction}</p>
          {f.effect.note && <p className="text-xs text-slate-500">{f.effect.note}</p>}
          <div className="flex flex-wrap gap-2">
            {f.refs.map((r) => (
              <button key={r} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-sky-700 hover:underline" onClick={() => navigate(withTrace(route, r))}>
                {r}
              </button>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}

export function InboxScreen() {
  const { findings, index } = useWorkpaper();
  if (!index) return null;
  const main = findings.filter((f) => f.severity !== 'info');
  const info = findings.filter((f) => f.severity === 'info');
  const total = main.reduce((s, f) => ({ federal: s.federal + f.effect.federal, california: s.california + f.effect.california }), { federal: 0, california: 0 });
  const diagnostics = index.versions.get(index.latest)!.diagnostics;

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">Inbox</h1>
      {main.length === 0 && info.length === 0 ? (
        <p className="mt-4 text-slate-500">Nothing needs attention.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-slate-500">
            {main.length} findings need a decision, ranked by estimated tax effect. If all were accepted:{' '}
            <EffectChips effect={{ ...total, basis: 'rate', note: 'Sum of linear estimates; large changes can cross thresholds' }} />
          </p>
          <ul className="mt-4">{[...main].sort((a, b) => effectSize(b.effect) - effectSize(a.effect)).map((f) => <Row key={`${f.checkId}/${f.key}`} f={f} />)}</ul>
          {info.length > 0 && (
            <details className="mt-6">
              <summary className="cursor-pointer text-sm text-slate-600">Also noted ({info.length})</summary>
              <ul className="mt-2">{info.map((f) => <Row key={`${f.checkId}/${f.key}`} f={f} />)}</ul>
            </details>
          )}
        </>
      )}
      <details className="mt-6">
        <summary className="cursor-pointer text-sm text-slate-600">Engine diagnostics ({diagnostics.length})</summary>
        <ul className="mt-2 space-y-1 text-sm">
          {diagnostics.map((d) => <li key={d.code}><span className="font-mono text-xs">{d.code}</span> {d.message}</li>)}
        </ul>
      </details>
    </div>
  );
}
