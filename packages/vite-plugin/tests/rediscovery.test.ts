import { createExcludeMatcher } from '@animus-ui/extract/pipeline';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { stabilizeSourceUniverse } from '../src/rediscovery';
import { makeContextProbe } from './context-probe';
import { makeComponent, makeManifest } from './manifest-fixture';

import type { ContextProbe } from './context-probe';
import type { ManifestDiagnostic } from '@animus-ui/extract/pipeline';

/**
 * Source-universe reconciliation before unresolved-parent fallbacks
 * (openspec: dev-transform-coherence): when an analysis reports `chain
 * dropped: could not resolve parent component`, the discoverable on-disk
 * universe is re-walked and re-analyzed before that result is acted on — a
 * parent that exists on disk is folded in instead of publishing the runtime
 * fallback.
 */

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

describe('stabilizeSourceUniverse', () => {
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
      // The fold made the parent visible: the re-analysis resolves the graph.
      ctx.storedManifest = makeManifest({
        components: {
          'Consumer.tsx::Fancy': makeComponent('Consumer.tsx', 'r'),
        },
        files: { 'Consumer.tsx': ['Consumer.tsx::Fancy'] },
      });
      return true;
    };

    const reanalyzed = await stabilizeSourceUniverse(probe.ctx);

    expect(reanalyzed).toBe(true);
    expect(probe.analyses).toBe(1);
    expect(probe.ctx.fileCache.has('Parent.tsx')).toBe(true);
    // Diagnostics resolved — no residual warn.
    expect(probe.warns).toEqual([]);
  });

  it('does nothing when no unresolved-parent drops are present', async () => {
    writeFileSync(join(root, 'New.tsx'), 'export const x = 1;\n');
    const probe = makeProbe(root);
    probe.ctx.storedManifest = makeManifest();

    expect(await stabilizeSourceUniverse(probe.ctx)).toBe(false);
    expect(probe.analyses).toBe(0);
    // The un-dropped New.tsx is NOT folded — rediscovery is drop-triggered.
    expect(probe.ctx.fileCache.has('New.tsx')).toBe(false);
  });

  it('returns without re-analyzing when the walk finds nothing new', async () => {
    const probe = makeProbe(root);
    probe.ctx.storedManifest = makeManifest({
      diagnostics: [dropDiagnostic('Consumer.tsx', 'Fancy', 'Ghost')],
    });

    expect(await stabilizeSourceUniverse(probe.ctx)).toBe(false);
    expect(probe.analyses).toBe(0);
  });

  /**
   * `runAnalysis` requires callers that advanced the file cache to roll it
   * back when the analysis does not publish. Keeping the folded entries
   * stranded the retry: the next call folds 0, reads that as a barren walk,
   * memoizes it, and short-circuits every later call — so stabilize could
   * never run again for the lifetime of the context.
   */
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

      const first = stabilizeSourceUniverse(probe.ctx);
      if (label === 'throws') await expect(first).rejects.toThrow();
      else await first;

      // The failed attempt published nothing, so the cache must be back to
      // its pre-fold state.
      expect(ctx.fileCache.has('Parent.tsx')).toBe(false);

      // And the next call must genuinely retry rather than short-circuit on
      // a barren-walk memo.
      let retried = false;
      ctx.runAnalysis = () => {
        retried = true;
        ctx.storedManifest = makeManifest();
        return true;
      };
      await stabilizeSourceUniverse(probe.ctx);
      expect(retried, 'stabilize must remain retryable').toBe(true);
      expect(ctx.fileCache.has('Parent.tsx')).toBe(true);
    });
  }

  /**
   * The barren-walk memo exists to skip a walk that provably cannot fold
   * anything new. "The cache has not moved" is the load-bearing half of that
   * claim, and a size comparison does not carry it: a delete and an unrelated
   * create return the cache to the same size holding different files. If the
   * skip fires there, the on-disk parent whose watcher event was lost is never
   * folded, and the consumer keeps being served as an unresolved-parent raw
   * fallback for the rest of the session.
   */
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

    // The parent is genuinely absent: the walk folds nothing and memoizes
    // that verdict.
    await stabilizeSourceUniverse(probe.ctx);
    expect(probe.analyses).toBe(0);

    // An unrelated file is deleted (the delete path prunes without walking),
    // the missing parent lands on disk with its watcher event lost, and an
    // ordinary create restores the cache to its previous SIZE with different
    // content.
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

    await stabilizeSourceUniverse(probe.ctx);

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
    // Mirror buildStart's refresh: the context's matcher is memoized, so a
    // post-construction options mutation must rebuild it (production does
    // this at every buildStart).
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

    await stabilizeSourceUniverse(probe.ctx);

    expect(probe.analyses).toBe(0);
    const joined = probe.warns.join('\n');
    expect(joined).toContain("'Fancy'");
    expect(joined).toContain("'Parent'");
    expect(joined).toContain("excluded by pattern 'generated'");
  });
});
