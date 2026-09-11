/** The corpus is shared by the Vite context and the extraction session, so it
 *  is driven here at its own interface rather than through either driver. */
import { readdirSync, readFileSync } from 'fs';
import { join, relative, resolve } from 'path';
import { describe, expect, test } from 'vitest';

import { createSourceCorpus } from '../pipeline/source-corpus';
import {
  FATAL_DIAGNOSTIC,
  makeHost,
  scriptedSourceIngestor,
} from './source-ingestion-fixtures';

const entry = (path: string) => ({
  path,
  source: `// ${path}\n`,
  hash: `h:${path}`,
});

function makeCorpus(
  options: Parameters<typeof scriptedSourceIngestor>[1] & {
    strict?: boolean;
  } = {}
) {
  const host = makeHost({ strict: options.strict });
  const ingestor = scriptedSourceIngestor(host, options);
  return { corpus: createSourceCorpus(host, ingestor), ingestor };
}

describe('createSourceCorpus', () => {
  test('assembles the corpus from the cache in discovery order, externals after', async () => {
    const { corpus, ingestor } = makeCorpus();
    // Insertion order is the watch history, not the walk: an external entry
    // first, a nested file, then a file created mid-watch that sorts first.
    const fileCache = new Map([
      ['../kit/src/Button.tsx', entry('../kit/src/Button.tsx')],
      ['src/b.tsx', entry('src/b.tsx')],
      ['src/b/c.tsx', entry('src/b/c.tsx')],
      ['../kit/src/Alpha.tsx', entry('../kit/src/Alpha.tsx')],
      ['src/Alpha.tsx', entry('src/Alpha.tsx')],
    ]);

    await corpus.prepare({
      fileCache,
      externalFileOwners: {
        '../kit/src/Button.tsx': '@acme/kit',
        '../kit/src/Alpha.tsx': '@acme/kit',
      },
    });

    expect(ingestor.ingested).toHaveLength(1);
    expect(ingestor.ingested[0].map((e) => e.path)).toEqual([
      'src/Alpha.tsx',
      'src/b/c.tsx',
      'src/b.tsx',
      '../kit/src/Button.tsx',
      '../kit/src/Alpha.tsx',
    ]);
  });

  test('publish rebinds the projection; nothing is published before it', async () => {
    const { corpus } = makeCorpus({
      children: { 'src/Usage.svelte': [entry('src/Usage.svelte.tsx')] },
    });
    expect(corpus.published.analysisEntries.size).toBe(0);
    expect(corpus.published.ownership).toEqual({});

    const accepted = await corpus.prepare([entry('src/Usage.svelte')]);
    const before = corpus.published;

    corpus.publish(accepted);

    expect(corpus.published).not.toBe(before);
    expect([...corpus.published.analysisEntries.keys()]).toEqual([
      'src/Usage.svelte.tsx',
    ]);
    expect(
      corpus.published.analysisEntries.get('src/Usage.svelte.tsx')
    ).toEqual({
      hash: 'h:src/Usage.svelte.tsx',
      source: '// src/Usage.svelte.tsx\n',
    });
    expect(
      corpus.published.ownership['src/Usage.svelte']?.analysisPaths
    ).toEqual(['src/Usage.svelte.tsx']);
  });

  const usage = entry(FATAL_DIAGNOSTIC.originalPath);
  const ok = entry('src/ok.tsx');
  const diagnosed = {
    children: { [usage.path]: [entry(`${usage.path}.tsx`)] },
    diagnostics: [FATAL_DIAGNOSTIC],
  };

  test('a diagnosed original and its children drop from the accepted corpus', async () => {
    const { corpus } = makeCorpus(diagnosed);

    const accepted = await corpus.prepare([usage, ok]);

    expect(accepted.originalEntries.map((e) => e.path)).toEqual([ok.path]);
    expect(accepted.analysisEntries.map((e) => e.path)).toEqual([ok.path]);
    expect(Object.keys(accepted.ownership)).toEqual([ok.path]);
  });

  test('strict mode throws out of prepare and publishes nothing', async () => {
    const { corpus } = makeCorpus({ ...diagnosed, strict: true });

    await expect(corpus.prepare([usage, ok])).rejects.toThrow(
      /SOURCE_SVELTE_DEPENDENCY_MISSING src\/Usage\.svelte/
    );
    expect(corpus.published.analysisEntries.size).toBe(0);
  });

  test('a published original re-arms its quarantine warning', async () => {
    const warnings: string[] = [];
    const host = makeHost({ warnings });
    const ingestor = scriptedSourceIngestor(host, diagnosed);
    const corpus = createSourceCorpus(host, ingestor);

    await corpus.prepare([usage, ok]);
    await corpus.prepare([usage, ok]);
    expect(warnings).toHaveLength(1);

    corpus.publish(await scriptedSourceIngestor(host).ingest([usage]));
    await corpus.prepare([usage, ok]);
    expect(warnings).toHaveLength(2);
  });
});

/** Catches a second production owner of the ingestion policy point inside
 *  this package; other packages and the test-seam parameter are uncovered. */
describe('ingestion policy has one owner', () => {
  const EXTRACT = resolve(__dirname, '..');
  const SKIP = new Set(['node_modules', 'dist', 'crates', 'tests']);

  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const dirent of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(dirent.name)) continue;
      const full = join(dir, dirent.name);
      if (dirent.isDirectory()) sourceFiles(full, out);
      else if (/\.tsx?$/.test(dirent.name)) out.push(full);
    }
    return out;
  }

  test('createSourceIngestor is called only inside the source corpus', () => {
    const files = sourceFiles(EXTRACT);
    // Vacuity guard: the walk must actually cover the session driver.
    expect(files.some((f) => f.endsWith('extraction-session.ts'))).toBe(true);

    const callers = files
      .filter((file) => !file.endsWith(join('pipeline', 'source-ingestion.ts')))
      .filter((file) =>
        readFileSync(file, 'utf-8').includes('createSourceIngestor(')
      )
      .map((file) => relative(EXTRACT, file).replaceAll('\\', '/'));

    expect(callers).toEqual(['pipeline/source-corpus.ts']);
  });
});
