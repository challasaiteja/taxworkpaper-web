import { formatValue } from '../../core/format';
import { lineRef } from '../../core/refs/refs';
import { navigate, useRoute, withTrace } from '../router';
import { useWorkpaper } from '../store';

export function ReturnScreen() {
  const { index } = useWorkpaper();
  const route = useRoute();
  if (!index) return null;
  const version = index.versions.get(index.latest)!;
  const byForm = new Map<string, typeof version.lines>();
  for (const l of version.lines) byForm.set(l.form, [...(byForm.get(l.form) ?? []), l]);

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">Return {version.version}</h1>
      <p className="text-sm text-slate-500">Computed {version.computed_at.slice(0, 10)} · {version.trigger}</p>
      {[...byForm].map(([form, lines]) => (
        <section key={form} className="mt-6">
          <h2 className="text-sm font-semibold uppercase text-slate-500">{form}</h2>
          <ul className="mt-1">
            {lines.map((l) => {
              const ref = lineRef(version.version, l.key);
              return (
                <li key={ref}>
                  <button
                    className={`flex w-full gap-3 px-2 py-1 text-left text-sm hover:bg-slate-50 ${route.trace === ref ? 'bg-amber-50' : ''}`}
                    onClick={() => navigate(withTrace(route, ref))}
                  >
                    <span className="w-16 font-mono text-slate-400">{l.line}</span>
                    <span className="flex-1">{l.label}</span>
                    <span className="font-mono">{formatValue(l.value)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
