import { createExcludeMatcher } from '@animus-ui/extract/pipeline';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { stabilizeSourceUniverse } from '../src/rediscovery';
import { makeContextProbe } from './context-probe';

import type { ContextProbe } from './context-probe';

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dropDiagnostic(file: string, component: string, parent: string): any {
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

  it('folds an on-disk parent and re-analyzes before publishing', () => {
    writeFileSync(
      join(root, 'Parent.tsx'),
      "export const Parent = ds.styles({}).asElement('div');\n"
    );
    const probe = makeProbe(root);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = probe.ctx as any;
    ctx.fileCache.set('Consumer.tsx', { hash: 'h', source: 'src' });
    ctx.storedManifest = {
      components: {},
      files: {},
      diagnostics: [dropDiagnostic('Consumer.tsx', 'Fancy', 'Parent')],
    };
    ctx.runAnalysis = () => {
      probe.analyses++;
      // The fold made the parent visible: the re-analysis resolves the graph.
      ctx.storedManifest = {
        components: {
          'Consumer.tsx::Fancy': { file: 'Consumer.tsx', replacement: 'r' },
        },
        files: { 'Consumer.tsx': ['Consumer.tsx::Fancy'] },
        diagnostics: [],
      };
    };

    const reanalyzed = stabilizeSourceUniverse(probe.ctx);

    expect(reanalyzed).toBe(true);
    expect(probe.analyses).toBe(1);
    expect(probe.ctx.fileCache.has('Parent.tsx')).toBe(true);
    // Diagnostics resolved — no residual warn.
    expect(probe.warns).toEqual([]);
  });

  it('does nothing when no unresolved-parent drops are present', () => {
    writeFileSync(join(root, 'New.tsx'), 'export const x = 1;\n');
    const probe = makeProbe(root);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (probe.ctx as any).storedManifest = {
      components: {},
      files: {},
      diagnostics: [],
    };

    expect(stabilizeSourceUniverse(probe.ctx)).toBe(false);
    expect(probe.analyses).toBe(0);
    // The un-dropped New.tsx is NOT folded — rediscovery is drop-triggered.
    expect(probe.ctx.fileCache.has('New.tsx')).toBe(false);
  });

  it('returns without re-analyzing when the walk finds nothing new', () => {
    const probe = makeProbe(root);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (probe.ctx as any).storedManifest = {
      components: {},
      files: {},
      diagnostics: [dropDiagnostic('Consumer.tsx', 'Fancy', 'Ghost')],
    };

    expect(stabilizeSourceUniverse(probe.ctx)).toBe(false);
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
    it(`rolls the fold back and stays retryable when analysis ${label}`, () => {
      writeFileSync(
        join(root, 'Parent.tsx'),
        "export const Parent = ds.styles({}).asElement('div');\n"
      );
      const probe = makeProbe(root);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctx = probe.ctx as any;
      ctx.fileCache.set('Consumer.tsx', { hash: 'h', source: 'src' });
      ctx.storedManifest = {
        components: {},
        files: {},
        diagnostics: [dropDiagnostic('Consumer.tsx', 'Fancy', 'Parent')],
      };
      fail(ctx);

      const first = () => stabilizeSourceUniverse(probe.ctx);
      if (label === 'throws') expect(first).toThrow();
      else first();

      // The failed attempt published nothing, so the cache must be back to
      // its pre-fold state.
      expect(ctx.fileCache.has('Parent.tsx')).toBe(false);

      // And the next call must genuinely retry rather than short-circuit on
      // a barren-walk memo.
      let retried = false;
      ctx.runAnalysis = () => {
        retried = true;
        ctx.storedManifest = { components: {}, files: {}, diagnostics: [] };
      };
      stabilizeSourceUniverse(probe.ctx);
      expect(retried, 'stabilize must remain retryable').toBe(true);
      expect(ctx.fileCache.has('Parent.tsx')).toBe(true);
    });
  }

  it('names the exclusion rule for a resolvable but excluded parent', () => {
    mkdirSync(join(root, 'generated'));
    writeFileSync(
      join(root, 'generated', 'Parent.tsx'),
      "export const Parent = ds.styles({}).asElement('div');\n"
    );
    const probe = makeProbe(root);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = probe.ctx as any;
    ctx.options = { system: './ds.ts', exclude: ['generated'] };
    // Mirror buildStart's refresh: the context's matcher is memoized, so a
    // post-construction options mutation must rebuild it (production does
    // this at every buildStart).
    ctx.excludeMatcher = createExcludeMatcher(ctx.options.exclude);
    ctx.fileCache.set('Consumer.tsx', {
      hash: 'h',
      source:
        "import { Parent } from './generated/Parent';\n" +
        "export const Fancy = Parent.extend().styles({}).asElement('div');\n",
    });
    ctx.storedManifest = {
      components: {},
      files: {},
      diagnostics: [dropDiagnostic('Consumer.tsx', 'Fancy', 'Parent')],
    };

    stabilizeSourceUniverse(probe.ctx);

    expect(probe.analyses).toBe(0);
    const joined = probe.warns.join('\n');
    expect(joined).toContain("'Fancy'");
    expect(joined).toContain("'Parent'");
    expect(joined).toContain("excluded by pattern 'generated'");
  });
});
