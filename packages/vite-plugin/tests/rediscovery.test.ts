import { createExcludeMatcher } from '@animus-ui/extract/pipeline';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { reconcileSourceCorpus } from '../src/rediscovery';
import { makeContextProbe } from './context-probe';
import { makeComponent, makeManifest } from './manifest-fixture';

import type { ContextProbe } from './context-probe';
import type { ManifestDiagnostic } from '@animus-ui/extract/pipeline';

interface RediscoveryProbe extends ContextProbe {
  warns: string[];
}

function makeProbe(rootDir: string): RediscoveryProbe {
  const warns: string[] = [];
  const base = makeContextProbe(rootDir, {
    extensionsSet: new Set(['.ts', '.tsx']),
    warn(msg: string) {
      warns.push(msg);
    },
  });
  return Object.assign(base, { warns });
}

function dropDiagnostic(
  file: string,
  component: string,
  parent: string
): ManifestDiagnostic {
  return {
    file,
    component,
    kind: 'bail',
    message: `chain dropped: could not resolve parent component '${parent}'`,
  };
}

describe('reconcileSourceCorpus', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'animus-rediscovery-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('folds an on-disk parent and re-analyzes before publishing', async () => {
    writeFileSync(
      join(root, 'Parent.tsx'),
      "export const Parent = ds.styles({}).asElement('div');\n"
    );
    const probe = makeProbe(root);
    const ctx = probe.ctx;
    ctx.mutateFileCache((cache) =>
      cache.set('Consumer.tsx', { hash: 'h', source: 'src' })
    );
    ctx.storedManifest = makeManifest({
      diagnostics: [dropDiagnostic('Consumer.tsx', 'Fancy', 'Parent')],
    });
    ctx.runAnalysis = () => {
      probe.analyses++;
      ctx.storedManifest = makeManifest({
        components: {
          'Consumer.tsx::Fancy': makeComponent('Consumer.tsx', 'r'),
        },
        files: { 'Consumer.tsx': ['Consumer.tsx::Fancy'] },
      });
      return true;
    };

    const reanalyzed = await reconcileSourceCorpus(probe.ctx);

    expect(reanalyzed).toBe(true);
    expect(probe.analyses).toBe(1);
    expect(probe.ctx.fileCache.has('Parent.tsx')).toBe(true);
    expect(probe.warns).toEqual([]);
  });

  it('does nothing when no unresolved-parent drops are present', async () => {
    writeFileSync(join(root, 'New.tsx'), 'export const x = 1;\n');
    const probe = makeProbe(root);
    probe.ctx.storedManifest = makeManifest();

    expect(await reconcileSourceCorpus(probe.ctx)).toBe(false);
    expect(probe.analyses).toBe(0);
    expect(probe.ctx.fileCache.has('New.tsx')).toBe(false);
  });

  it('returns without re-analyzing when the walk finds nothing new', async () => {
    const probe = makeProbe(root);
    probe.ctx.storedManifest = makeManifest({
      diagnostics: [dropDiagnostic('Consumer.tsx', 'Fancy', 'Ghost')],
    });

    expect(await reconcileSourceCorpus(probe.ctx)).toBe(false);
    expect(probe.analyses).toBe(0);
  });

  /** A caller that advanced the file cache rolls it back when the analysis
   *  does not publish; stranded entries memoize the next walk as barren. */
  for (const [label, fail] of [
    [
      'returns false',
      (ctx: { runAnalysis: unknown }) => {
        ctx.runAnalysis = () => false;
      },
    ],
    [
      'throws',
      (ctx: { runAnalysis: unknown }) => {
        ctx.runAnalysis = () => {
          throw new Error('error diagnostics fail the build');
        };
      },
    ],
  ] as const) {
    it(`rolls the fold back and stays retryable when analysis ${label}`, async () => {
      writeFileSync(
        join(root, 'Parent.tsx'),
        "export const Parent = ds.styles({}).asElement('div');\n"
      );
      const probe = makeProbe(root);
      const ctx = probe.ctx;
      ctx.mutateFileCache((cache) =>
        cache.set('Consumer.tsx', { hash: 'h', source: 'src' })
      );
      ctx.storedManifest = makeManifest({
        diagnostics: [dropDiagnostic('Consumer.tsx', 'Fancy', 'Parent')],
      });
      fail(ctx);

      const first = reconcileSourceCorpus(probe.ctx);
      if (label === 'throws') await expect(first).rejects.toThrow();
      else await first;

      expect(ctx.fileCache.has('Parent.tsx')).toBe(false);

      let retried = false;
      ctx.runAnalysis = () => {
        retried = true;
        ctx.storedManifest = makeManifest();
        return true;
      };
      await reconcileSourceCorpus(probe.ctx);
      expect(retried, 'stabilize must remain retryable').toBe(true);
      expect(ctx.fileCache.has('Parent.tsx')).toBe(true);
    });
  }

  /** A size comparison cannot stand in for "the cache has not moved": a
   *  delete plus an unrelated create strands the parent for the session. */
  it('walks again after a delete and a create that restore the cache size', async () => {
    const probe = makeProbe(root);
    const ctx = probe.ctx;
    const consumerSource =
      "export const Fancy = Parent.extend().styles({}).asElement('div');\n";
    writeFileSync(join(root, 'Consumer.tsx'), consumerSource);
    writeFileSync(join(root, 'Note.tsx'), 'export const note = 1;\n');
    ctx.mutateFileCache((cache) =>
      cache.set('Consumer.tsx', { hash: 'h', source: consumerSource })
    );
    ctx.mutateFileCache((cache) =>
      cache.set('Note.tsx', { hash: 'h', source: 'note' })
    );
    ctx.storedManifest = makeManifest({
      diagnostics: [dropDiagnostic('Consumer.tsx', 'Fancy', 'Parent')],
    });

    await reconcileSourceCorpus(probe.ctx);
    expect(probe.analyses).toBe(0);

    rmSync(join(root, 'Note.tsx'));
    ctx.mutateFileCache((cache) => cache.delete('Note.tsx'));
    writeFileSync(
      join(root, 'Parent.tsx'),
      "export const Parent = ds.styles({}).asElement('div');\n"
    );
    writeFileSync(join(root, 'Other.tsx'), 'export const other = 1;\n');
    ctx.mutateFileCache((cache) =>
      cache.set('Other.tsx', { hash: 'h', source: 'other' })
    );
    ctx.runAnalysis = () => {
      probe.analyses++;
      ctx.storedManifest = makeManifest();
      return true;
    };

    await reconcileSourceCorpus(probe.ctx);

    expect(ctx.fileCache.has('Parent.tsx')).toBe(true);
    expect(probe.analyses).toBe(1);
  });

  it('names the exclusion rule for a resolvable but excluded parent', async () => {
    mkdirSync(join(root, 'generated'));
    writeFileSync(
      join(root, 'generated', 'Parent.tsx'),
      "export const Parent = ds.styles({}).asElement('div');\n"
    );
    const probe = makeProbe(root);
    const ctx = probe.ctx;
    ctx.options.system = './ds.ts';
    ctx.options.exclude = ['generated'];
    // The matcher is memoized, so mutating `options.exclude` after
    // construction only takes effect once it is rebuilt.
    ctx.excludeMatcher = createExcludeMatcher(ctx.options.exclude);
    ctx.mutateFileCache((cache) =>
      cache.set('Consumer.tsx', {
        hash: 'h',
        source:
          "import { Parent } from './generated/Parent';\n" +
          "export const Fancy = Parent.extend().styles({}).asElement('div');\n",
      })
    );
    ctx.storedManifest = makeManifest({
      diagnostics: [dropDiagnostic('Consumer.tsx', 'Fancy', 'Parent')],
    });

    await reconcileSourceCorpus(probe.ctx);

    expect(probe.analyses).toBe(0);
    const joined = probe.warns.join('\n');
    expect(joined).toContain("'Fancy'");
    expect(joined).toContain("'Parent'");
    expect(joined).toContain("excluded by pattern 'generated'");
  });
});
