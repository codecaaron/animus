import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { summarize } from './residue-histogram';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true }))
  );
});

const site = (
  file: string,
  start: number,
  prop: string,
  kind: string
) => ({
  binding: 'Box',
  prop,
  file,
  span: { start, end: start + 3 },
  kind,
});

describe('residue histogram', () => {
  test('deduplicates repeated build records and groups manifest-only facts', () => {
    const first = {
      usageResidue: [
        site('a.tsx', 10, 'p', 'identifier'),
        site('a.tsx', 20, 'm', 'conditional'),
      ],
    };
    const second = {
      usageResidue: [
        site('a.tsx', 10, 'p', 'identifier'),
        site('b.tsx', 30, 'p', 'identifier'),
      ],
    };

    expect(summarize([first, second])).toEqual({
      totalSites: 3,
      byKind: { conditional: 1, identifier: 2 },
      byProp: { m: 1, p: 2 },
      byBinding: { Box: 3 },
    });
  });

  test('CLI writes the canonical summary to --out', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'animus-residue-histogram-'));
    temporaryDirectories.push(directory);
    const firstPath = join(directory, 'first.json');
    const secondPath = join(directory, 'second.json');
    const outputPath = join(directory, 'summary.json');
    await writeFile(
      firstPath,
      JSON.stringify({ usageResidue: [site('a.tsx', 10, 'p', 'identifier')] })
    );
    await writeFile(
      secondPath,
      JSON.stringify({ usageResidue: [site('a.tsx', 20, 'm', 'conditional')] })
    );

    const process = Bun.spawn(
      [
        Bun.which('bun')!,
        join(import.meta.dir, 'residue-histogram.ts'),
        '--out',
        outputPath,
        firstPath,
        secondPath,
      ],
      { stderr: 'pipe' }
    );
    expect(await process.exited).toBe(0);
    expect(JSON.parse(await readFile(outputPath, 'utf8'))).toEqual({
      totalSites: 2,
      byKind: { conditional: 1, identifier: 1 },
      byProp: { m: 1, p: 1 },
      byBinding: { Box: 2 },
    });
  });
});
