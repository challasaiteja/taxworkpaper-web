export function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}
