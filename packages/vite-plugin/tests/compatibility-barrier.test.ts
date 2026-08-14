import { join, resolve } from 'path';
import { describe, expect, it } from 'vitest';

import { transformSource } from '../src/transform';
import { makeContextProbe, makeEnvGraph } from './context-probe';

import type { CssSheets } from '../src/context';
import type { ContextProbe } from './context-probe';

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

const SHEETS: CssSheets = {
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

function makeProbe(): BarrierProbe {
  const graph = makeEnvGraph({ rootDir: ROOT, file: 'src/Consumer.tsx' });
  const base = makeContextProbe(ROOT, {
    externalDirOwners: {},
    externalFileOwners: {},
    reverseProvenance: {},
    storedManifest: { components: {}, files: {}, diagnostics: [] },
    storedManifestJson: '{}',
    storedSheets: SHEETS,
    engineApi: () => ({
      transformFile: () => ({ hasComponents: true, code: 'TRANSFORMED' }),
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = probe.ctx as any;
  ctx.fileCache.set('src/Consumer.tsx', { hash: 'h', source: 's' });
  ctx.fileCache.set('src/Parent.tsx', { hash: 'h2', source: 's2' });
  ctx.storedManifest = {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = probe.ctx as any;
  ctx.storedManifest = {
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
  ctx.reverseProvenance = {
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

  it('ignores raw serves that carry no unresolved-extension drop', async () => {
    const probe = makeProbe();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = probe.ctx as any;
    // A plain helper file: known, no manifest entries, no drop diagnostic.
    ctx.fileCache.set('src/util.ts', { hash: 'h', source: 's' });
    ctx.fileCache.set('src/Parent.tsx', { hash: 'h2', source: 's2' });
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
