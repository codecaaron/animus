import { join, resolve } from 'path';
import { describe, expect, it, vi } from 'vitest';

import { transformSource } from '../src/transform';
import { makeContextProbe, makeEnvGraph } from './context-probe';

import type { ContextProbe } from './context-probe';
import type { ManifestSheets } from '@animus-ui/extract/pipeline';

/**
 * The compatibility publication barrier (openspec: dev-transform-coherence,
 * "Runtime-incompatible publications are withheld"): a transform response
 * that would let a raw-served extension consumer execute `.extend()` against
 * an extracted ancestor is failed with `ANIMUS_COMPOSITION_RECOVERING`
 * instead of served — the incompatible JavaScript never evaluates, the
 * affected consumers are invalidated, and the recovery reload re-serves
 * everything extracted.
 */

const ROOT = join('/tmp', 'animus-barrier-root');

const SHEETS: ManifestSheets = {
  declaration: '',
  global: '',
  base: '',
  variants: '',
  compounds: '',
  states: '',
  system: '',
  custom: '',
};

interface BarrierProbe extends ContextProbe {
  invalidatedNodes: string[];
}

/** Per-file engine outcome: extracted, component-less, or a hard failure. */
type EngineOutcome = 'extracted' | 'no-components' | 'throws';

function makeProbe(
  outcomeFor: (relativePath: string) => EngineOutcome = () => 'extracted'
): BarrierProbe {
  const graph = makeEnvGraph({ rootDir: ROOT, file: 'src/Consumer.tsx' });
  const base = makeContextProbe(ROOT, {
    externalDirOwners: {},
    externalFileOwners: {},
    reverseProvenance: {},
    storedManifest: { components: {}, files: {}, diagnostics: [] },
    storedManifestJson: '{}',
    storedSheets: SHEETS,
    engineApi: () => ({
      transformFile: (_source: string, path: string) => {
        const outcome = outcomeFor(path);
        if (outcome === 'throws') throw new Error('planned transform failure');
        return {
          hasComponents: outcome === 'extracted',
          code: outcome === 'extracted' ? 'TRANSFORMED' : '',
        };
      },
    }),
    devServer: {
      environments: {
        client: { moduleGraph: graph.moduleGraph },
      },
    },
  });
  return Object.assign(base, { invalidatedNodes: graph.invalidated });
}

/** Serve the consumer while its parent is unresolved: a raw fallback. */
async function serveConsumerRaw(probe: BarrierProbe): Promise<void> {
  probe.ctx.mutateFileCache((cache) =>
    cache.set('src/Consumer.tsx', { hash: 'h', source: 's' })
  );
  probe.ctx.mutateFileCache((cache) =>
    cache.set('src/Parent.tsx', { hash: 'h2', source: 's2' })
  );
  probe.ctx.storedManifest = {
    components: {},
    files: {},
    diagnostics: [
      {
        file: 'src/Consumer.tsx',
        component: 'Fancy',
        kind: 'bail',
        message: "chain dropped: could not resolve parent component 'Parent'",
      },
    ],
  };
  const served = await transformSource(
    probe.ctx,
    "import { Parent } from './Parent';\nexport const Fancy = Parent.extend();",
    resolve(ROOT, 'src/Consumer.tsx')
  );
  expect(served).toBeNull(); // raw fallback
}

/** Publish the recovered manifest: both files extracted, provenance linked. */
function publishRecoveredManifest(probe: BarrierProbe): void {
  probe.ctx.storedManifest = {
    components: {
      'src/Parent.tsx::Parent': { file: 'src/Parent.tsx', replacement: 'rp' },
      'src/Consumer.tsx::Fancy': {
        file: 'src/Consumer.tsx',
        replacement: 'rf',
      },
    },
    files: {
      'src/Parent.tsx': ['src/Parent.tsx::Parent'],
      'src/Consumer.tsx': ['src/Consumer.tsx::Fancy'],
    },
    diagnostics: [],
  };
  probe.ctx.reverseProvenance = {
    'src/Parent.tsx::Parent': ['src/Consumer.tsx::Fancy'],
  };
}

describe('compatibility publication barrier', () => {
  it('withholds an extracted ancestor while a raw fallback consumer is live', async () => {
    const probe = makeProbe();
    await serveConsumerRaw(probe);
    publishRecoveredManifest(probe);

    await expect(
      transformSource(
        probe.ctx,
        'export const Parent = 1;',
        resolve(ROOT, 'src/Parent.tsx')
      )
    ).rejects.toThrow(/ANIMUS_COMPOSITION_RECOVERING/);

    // The raw consumer was invalidated and the recovery reload scheduled.
    expect(probe.invalidatedNodes).toContain(resolve(ROOT, 'src/Consumer.tsx'));
    expect(probe.extractedInvalidations).toBe(1);

    // The trip is one-shot and self-clearing: the invalidation killed the
    // cached raw transform and the withheld response never reached a page,
    // so the very next parent request serves — even if the consumer is
    // never re-imported by the reloaded page.
    const retried = await transformSource(
      probe.ctx,
      'export const Parent = 1;',
      resolve(ROOT, 'src/Parent.tsx')
    );
    expect(retried?.code).toContain('TRANSFORMED');
  });

  it('serves the parent once the consumer has re-served extracted', async () => {
    const probe = makeProbe();
    await serveConsumerRaw(probe);
    publishRecoveredManifest(probe);

    // The recovery reload re-fetches the consumer first: extracted serve
    // clears its fallback record.
    const consumerOut = await transformSource(
      probe.ctx,
      'export const Fancy = 1;',
      resolve(ROOT, 'src/Consumer.tsx')
    );
    expect(consumerOut?.code).toContain('TRANSFORMED');

    const parentOut = await transformSource(
      probe.ctx,
      'export const Parent = 1;',
      resolve(ROOT, 'src/Parent.tsx')
    );
    expect(parentOut?.code).toContain('TRANSFORMED');
  });

  /**
   * The two raw-serve exits taken AFTER the manifest confirmed this file is
   * extracted. Both produce exactly the pair the barrier exists to prevent —
   * a raw consumer running `.extend()` against an extracted ancestor — so
   * both must land in the fallback record, not just the unresolved-parent
   * exit above.
   */
  const POST_MANIFEST_RAW_EXITS = [
    ['a non-strict transform failure', 'throws'],
    ['an engine result carrying no components', 'no-components'],
  ] as const;

  it.each(POST_MANIFEST_RAW_EXITS)(
    'withholds the ancestor after %s serves the consumer raw',
    async (_label, outcome) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const probe = makeProbe((path) =>
          path === 'src/Consumer.tsx' ? outcome : 'extracted'
        );
        publishRecoveredManifest(probe);

        // The consumer is manifest-known and extracted-by-belief, yet the
        // hook serves it raw.
        expect(
          await transformSource(
            probe.ctx,
            'export const Fancy = 1;',
            resolve(ROOT, 'src/Consumer.tsx')
          )
        ).toBeNull();

        await expect(
          transformSource(
            probe.ctx,
            'export const Parent = 1;',
            resolve(ROOT, 'src/Parent.tsx')
          )
        ).rejects.toThrow(/ANIMUS_COMPOSITION_RECOVERING/);
        expect(probe.invalidatedNodes).toContain(
          resolve(ROOT, 'src/Consumer.tsx')
        );
      } finally {
        warn.mockRestore();
      }
    }
  );

  it('clears the record once the file serves extracted again', async () => {
    // Worst ordering from the audit: fallback → extracted → fallback. The
    // clear must be the file's own state transition, not a one-shot.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      let consumerOutcome: EngineOutcome = 'throws';
      const probe = makeProbe((path) =>
        path === 'src/Consumer.tsx' ? consumerOutcome : 'extracted'
      );
      publishRecoveredManifest(probe);

      await transformSource(
        probe.ctx,
        'export const Fancy = 1;',
        resolve(ROOT, 'src/Consumer.tsx')
      );
      consumerOutcome = 'extracted';
      await transformSource(
        probe.ctx,
        'export const Fancy = 1;',
        resolve(ROOT, 'src/Consumer.tsx')
      );

      const parentOut = await transformSource(
        probe.ctx,
        'export const Parent = 1;',
        resolve(ROOT, 'src/Parent.tsx')
      );
      expect(parentOut?.code).toContain('TRANSFORMED');
    } finally {
      warn.mockRestore();
    }
  });

  it('ignores raw serves that carry no unresolved-extension drop', async () => {
    const probe = makeProbe();
    // A plain helper file: known, no manifest entries, no drop diagnostic.
    probe.ctx.mutateFileCache((cache) =>
      cache.set('src/util.ts', { hash: 'h', source: 's' })
    );
    probe.ctx.mutateFileCache((cache) =>
      cache.set('src/Parent.tsx', { hash: 'h2', source: 's2' })
    );
    expect(
      await transformSource(
        probe.ctx,
        'export const u = 1;',
        resolve(ROOT, 'src/util.ts')
      )
    ).toBeNull();

    publishRecoveredManifest(probe);

    const parentOut = await transformSource(
      probe.ctx,
      'export const Parent = 1;',
      resolve(ROOT, 'src/Parent.tsx')
    );
    expect(parentOut?.code).toContain('TRANSFORMED');
  });
});
