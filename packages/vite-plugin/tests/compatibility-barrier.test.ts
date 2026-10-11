import { join, resolve } from 'path';
import { describe, expect, it } from 'vitest';

import { transformSource } from '../src/transform';
import { makeContextProbe, makeEnvGraph } from './context-probe';
import { makeComponent, makeManifest } from './manifest-fixture';

import type { ContextProbe } from './context-probe';
import type { ManifestSheets } from '@animus-ui/extract/pipeline';

/** A raw-served consumer running `.extend()` against an extracted ancestor
 *  breaks at runtime, so the ancestor's transform is withheld instead. */

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

type EngineOutcome = 'extracted' | 'no-components' | 'throws';

function makeProbe(
  outcomeFor: (relativePath: string) => EngineOutcome = () => 'extracted'
): BarrierProbe {
  const graph = makeEnvGraph({ rootDir: ROOT, file: 'src/Consumer.tsx' });
  const base = makeContextProbe(ROOT, {
    externalDirOwners: {},
    externalFileOwners: {},
    reverseProvenance: {},
    storedManifest: makeManifest(),
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

async function serveConsumerRaw(probe: BarrierProbe): Promise<void> {
  probe.ctx.mutateFileCache((cache) =>
    cache.set('src/Consumer.tsx', { hash: 'h', source: 's' })
  );
  probe.ctx.mutateFileCache((cache) =>
    cache.set('src/Parent.tsx', { hash: 'h2', source: 's2' })
  );
  probe.ctx.storedManifest = makeManifest({
    diagnostics: [
      {
        file: 'src/Consumer.tsx',
        component: 'Fancy',
        kind: 'bail',
        message: "chain dropped: could not resolve parent component 'Parent'",
      },
    ],
  });
  const served = await transformSource(
    probe.ctx,
    "import { Parent } from './Parent';\nexport const Fancy = Parent.extend();",
    resolve(ROOT, 'src/Consumer.tsx')
  );
  expect(served).toBeNull();
}

function publishRecoveredManifest(probe: BarrierProbe): void {
  probe.ctx.storedManifest = makeManifest({
    components: {
      'src/Parent.tsx::Parent': makeComponent('src/Parent.tsx', 'rp'),
      'src/Consumer.tsx::Fancy': makeComponent('src/Consumer.tsx', 'rf'),
    },
    files: {
      'src/Parent.tsx': ['src/Parent.tsx::Parent'],
      'src/Consumer.tsx': ['src/Consumer.tsx::Fancy'],
    },
  });
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

    expect(probe.invalidatedNodes).toContain(resolve(ROOT, 'src/Consumer.tsx'));
    expect(probe.extractedInvalidations).toBe(1);

    // The withheld response never reached a page and the invalidation killed
    // the cached raw transform, so the next parent request serves.
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

  /** SA1: a failure for a file the manifest calls extracted is the
   *  transform's error, never a raw serve, so it never feeds the barrier;
   *  only the unresolved-extension drop does, until row 11 retires it. */
  it.each([
    ['a transform failure', 'throws'],
    ['an engine result carrying no components', 'no-components'],
  ] as const)(
    'fails the consumer on %s and never withholds its ancestor',
    async (_label, outcome) => {
      const probe = makeProbe((path) =>
        path === 'src/Consumer.tsx' ? outcome : 'extracted'
      );
      publishRecoveredManifest(probe);

      await expect(
        transformSource(
          probe.ctx,
          'export const Fancy = 1;',
          resolve(ROOT, 'src/Consumer.tsx')
        )
      ).rejects.toThrow();

      const parentOut = await transformSource(
        probe.ctx,
        'export const Parent = 1;',
        resolve(ROOT, 'src/Parent.tsx')
      );
      expect(parentOut?.code).toContain('TRANSFORMED');
    }
  );

  it('ignores raw serves that carry no unresolved-extension drop', async () => {
    const probe = makeProbe();
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
