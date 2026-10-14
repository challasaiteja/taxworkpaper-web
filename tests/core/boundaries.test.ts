import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const FORBIDDEN = [/from ['"]react/, /from ['"]zustand/, /from ['"]idb/, /from ['"].*\/(ui|adapters)\//];

describe('core boundaries', () => {
  it('src/core imports no UI, store, storage or adapter code', () => {
    const offenders = files('src/core').filter((f) =>
      FORBIDDEN.some((re) => re.test(readFileSync(f, 'utf8'))),
    );
    expect(offenders).toEqual([]);
  });
});
