import { useSyncExternalStore } from 'react';

export interface Route { path: string[]; trace?: string; page?: number }

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [pathPart = '', query = ''] = raw.split('?');
  const route: Route = { path: pathPart.split('/').filter(Boolean).map(safeDecode) };
  const params = new URLSearchParams(query);
  const trace = params.get('trace');
  const page = params.get('page');
  if (page) route.page = Number(page);
  if (trace) route.trace = trace;
  return route;
}

export function buildHash(route: Route): string {
  const params = new URLSearchParams();
  if (route.page) params.set('page', String(route.page));
  if (route.trace) params.set('trace', route.trace);
  const q = params.toString();
  return `#/${route.path.map(encodeURIComponent).join('/')}${q ? `?${q}` : ''}`;
}

export function navigate(route: Route): void {
  window.location.hash = buildHash(route);
}

export function withTrace(route: Route, trace?: string): Route {
  const next = { ...route };
  if (trace) next.trace = trace;
  else delete next.trace;
  return next;
}

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return parseHash(hash);
}
