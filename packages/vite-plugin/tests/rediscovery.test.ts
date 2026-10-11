import { createExcludeMatcher } from '@animus-ui/extract/pipeline';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { reconcileSourceCorpus } from '../src/rediscovery';
import { makeContextProbe, published } from './context-probe';
import { makeComponent, makeManifest } from './manifest-fixture';

import type { ContextProbe } from './context-probe';
import type { ManifestDiagnostic } from '@animus-ui/extract/pipeline';

function makeProbe(rootDir: string): ContextProbe {
  return makeContextProbe(rootDir, {
    extensionsSet: new Set(['.ts', '.tsx']),
  });
}

/** The change sets submitted to the Session, as sorted absolute paths. */
function submittedPaths(probe: ContextProbe): string[][] {
  return probe.submissions.map((changes) =>
    [...(changes.modifiedFiles ?? [])].sort()
  );
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
    probe.session.heldSources.set('Consumer.tsx', {
      hash: 'h',
      source: 'src',
    });
    probe.ctx.storedManifest = makeManifest({
      diagnostics: [dropDiagnostic('Consumer.tsx', 'Fancy', 'Parent')],
    });
    probe.respond(() => [
      published(probe, {
        manifest: makeManifest({
          components: {
            'Consumer.tsx::Fancy': makeComponent('Consumer.tsx', 'r'),
          },
          files: { 'Consumer.tsx': ['Consumer.tsx::Fancy'] },
        }),
        planChanged: ['Consumer.tsx'],
      }),
    ]);

    const outcomes = await reconcileSourceCorpus(probe.ctx);

    expect(submittedPaths(probe)).toEqual([[join(root, 'Parent.tsx')]]);
    expect(outcomes).toHaveLength(1);
    expect(probe.warnings).toEqual([]);
  });

  it('does nothing when no unresolved-parent drops are present', async () => {
    writeFileSync(join(root, 'New.tsx'), 'export const x = 1;\n');
    const probe = makeProbe(root);
    probe.ctx.storedManifest = makeManifest();

    expect(await reconcileSourceCorpus(probe.ctx)).toEqual([]);
    expect(probe.submissions).toEqual([]);
  });

  it('returns without re-analyzing when the walk finds nothing new', async () => {
    const probe = makeProbe(root);
    probe.ctx.storedManifest = makeManifest({
      diagnostics: [dropDiagnostic('Consumer.tsx', 'Fancy', 'Ghost')],
    });

    expect(await reconcileSourceCorpus(probe.ctx)).toEqual([]);
    expect(probe.submissions).toEqual([]);
  });

  /** A fold that publishes nothing is not remembered as barren: the next
   *  walk submits it again. The Session keeps none of a failed attempt's
   *  sources (session/replacements-epoch.test.ts). */
  for (const [label, fail] of [
    ['publishes nothing', () => []],
    [
      'throws',
      () => {
        throw new Error('error diagnostics fail the build');
      },
    ],
  ] as const) {
    it(`stays retryable when the fold's analysis ${label}`, async () => {
      writeFileSync(
        join(root, 'Parent.tsx'),
        "export const Parent = ds.styles({}).asElement('div');\n"
      );
      const probe = makeProbe(root);
      probe.session.heldSources.set('Consumer.tsx', {
        hash: 'h',
        source: 'src',
      });
      probe.ctx.storedManifest = makeManifest({
        diagnostics: [dropDiagnostic('Consumer.tsx', 'Fancy', 'Parent')],
      });
      probe.respond(fail);

      const first = reconcileSourceCorpus(probe.ctx);
      if (label === 'throws') await expect(first).rejects.toThrow();
      else await first;

      probe.respond(() => [published(probe, { manifest: makeManifest() })]);
      await reconcileSourceCorpus(probe.ctx);
      expect(submittedPaths(probe), 'the fold must remain retryable').toEqual([
        [join(root, 'Parent.tsx')],
        [join(root, 'Parent.tsx')],
      ]);
    });
  }

  /** A barren walk is remembered for the manifest it saw, never for the
   *  file set: a later publication walks again and folds the parent. */
  it('walks again once another generation publishes', async () => {
    const probe = makeProbe(root);
    const consumerSource =
      "export const Fancy = Parent.extend().styles({}).asElement('div');\n";
    writeFileSync(join(root, 'Consumer.tsx'), consumerSource);
    probe.session.heldSources.set('Consumer.tsx', {
      hash: 'h',
      source: consumerSource,
    });
    const drops = [dropDiagnostic('Consumer.tsx', 'Fancy', 'Parent')];
    probe.ctx.storedManifest = makeManifest({ diagnostics: drops });

    await reconcileSourceCorpus(probe.ctx);
    expect(probe.submissions).toEqual([]);

    writeFileSync(
      join(root, 'Parent.tsx'),
      "export const Parent = ds.styles({}).asElement('div');\n"
    );
    // The barren generation is still served: its walk is not repeated.
    await reconcileSourceCorpus(probe.ctx);
    expect(probe.submissions).toEqual([]);

    probe.ctx.storedManifest = makeManifest({ diagnostics: drops });
    probe.respond(() => [published(probe, { manifest: makeManifest() })]);
    await reconcileSourceCorpus(probe.ctx);

    expect(submittedPaths(probe)).toEqual([[join(root, 'Parent.tsx')]]);
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
    probe.session.heldSources.set('Consumer.tsx', {
      hash: 'h',
      source:
        "import { Parent } from './generated/Parent';\n" +
        "export const Fancy = Parent.extend().styles({}).asElement('div');\n",
    });
    ctx.storedManifest = makeManifest({
      diagnostics: [dropDiagnostic('Consumer.tsx', 'Fancy', 'Parent')],
    });

    await reconcileSourceCorpus(probe.ctx);

    expect(probe.submissions).toEqual([]);
    const joined = probe.warnings.join('\n');
    expect(joined).toContain("'Fancy'");
    expect(joined).toContain("'Parent'");
    expect(joined).toContain("excluded by pattern 'generated'");
  });
});
