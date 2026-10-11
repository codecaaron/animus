import { createExcludeMatcher } from '@animus-ui/extract/pipeline';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { reconcileSourceCorpus } from '../src/rediscovery';
import { makeContextProbe, published } from './context-probe';
import { makeComponent, makeManifest } from './manifest-fixture';

import type { ContextProbe } from './context-probe';
import type { ManifestMissingInput } from '@animus-ui/extract/pipeline';

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

/** An extension in `Consumer.tsx` dropped because analysis found no module
 *  at `base`. */
function absentParent(
  parent: string,
  base: string,
  outcome: ManifestMissingInput['outcome'] = 'absent'
): ManifestMissingInput {
  return {
    file: 'Consumer.tsx',
    component: 'Fancy',
    parent,
    specifier: `./${base}`,
    base,
    outcome,
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

  // `incomplete`: the host opens the file, which the Session does not hold
  // yet (a creation the watcher has not reported).
  for (const outcome of ['absent', 'incomplete'] as const) {
    it(`folds an on-disk ${outcome} parent and re-analyzes before publishing`, async () => {
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
        missing_inputs: [absentParent('Parent', 'Parent', outcome)],
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
  }

  it('does nothing when no extension was dropped', async () => {
    writeFileSync(join(root, 'New.tsx'), 'export const x = 1;\n');
    const probe = makeProbe(root);
    probe.ctx.storedManifest = makeManifest();

    expect(await reconcileSourceCorpus(probe.ctx)).toEqual([]);
    expect(probe.submissions).toEqual([]);
  });

  it('returns without re-analyzing when no file answers the parent', async () => {
    const probe = makeProbe(root);
    probe.ctx.storedManifest = makeManifest({
      missing_inputs: [absentParent('Ghost', 'Ghost')],
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
        missing_inputs: [absentParent('Parent', 'Parent')],
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

  /** Each pass probes afresh: a parent written after a barren pass folds
   *  on the next one. */
  it('folds a parent that appears after a barren pass', async () => {
    const probe = makeProbe(root);
    probe.ctx.storedManifest = makeManifest({
      missing_inputs: [absentParent('Parent', 'Parent')],
    });

    await reconcileSourceCorpus(probe.ctx);
    expect(probe.submissions).toEqual([]);

    writeFileSync(
      join(root, 'Parent.tsx'),
      "export const Parent = ds.styles({}).asElement('div');\n"
    );
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
      missing_inputs: [absentParent('Parent', 'generated/Parent')],
    });

    await reconcileSourceCorpus(probe.ctx);

    expect(probe.submissions).toEqual([]);
    const joined = probe.warnings.join('\n');
    expect(joined).toContain("'Fancy'");
    expect(joined).toContain("'Parent'");
    expect(joined).toContain("excluded by pattern 'generated'");
  });
});
