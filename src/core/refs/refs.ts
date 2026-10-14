export type Ref = string;

const PREFIXES = ['asset', 'household', 'py', 'agency', 'timeline', 'ref', 'group', 'ext', 'finding', 'area'] as const;
type Prefix = (typeof PREFIXES)[number];

export type ParsedRef =
  | { kind: 'doc'; docId: string }
  | { kind: 'page'; docId: string; page: number }
  | { kind: 'ev'; id: string }
  | { kind: 'line'; version: string; key: string }
  | { kind: 'client'; id: string }
  | { kind: 'prefixed'; prefix: Prefix; rest: string }
  | { kind: 'unknown'; raw: string };

export function parseRef(ref: string): ParsedRef {
  const page = /^(?:doc:)?(D\d{2})#page(\d+)$/.exec(ref);
  if (page) return { kind: 'page', docId: page[1]!, page: Number(page[2]) };
  if (/^D\d{2}$/.test(ref)) return { kind: 'doc', docId: ref };
  if (/^ev-\d+$/.test(ref)) return { kind: 'ev', id: ref };
  if (/^(qa|msg|call)-\d+$/.test(ref)) return { kind: 'client', id: ref };
  const line = /^line:([^/]+)\/(.+)$/.exec(ref);
  if (line) return { kind: 'line', version: line[1]!, key: line[2]! };
  const colon = ref.indexOf(':');
  if (colon > 0) {
    const prefix = ref.slice(0, colon);
    if ((PREFIXES as readonly string[]).includes(prefix)) {
      return { kind: 'prefixed', prefix: prefix as Prefix, rest: ref.slice(colon + 1) };
    }
  }
  return { kind: 'unknown', raw: ref };
}

export const lineRef = (version: string, key: string): Ref => `line:${version}/${key}`;
export const pageRef = (docId: string, page: number): Ref => `${docId}#page${page}`;
