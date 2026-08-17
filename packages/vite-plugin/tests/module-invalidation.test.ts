import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

import { invalidateFileModules } from '../src/module-invalidation';
import { makeContextProbe, makeEnvGraph } from './context-probe';

// The file-plan snapshot/diff suite lives with its authoritative
// definition in packages/extract/tests/replacement-plans.test.ts.

/**
 * Node enumeration: invalidation covers every module node the dev server
 * holds for a physical file — each environment's graph and query-suffixed
 * variants (openspec: dev-transform-coherence, "Client and SSR nodes are
 * both evicted").
 */

describe('invalidateFileModules', () => {
  it('invalidates every node for the file in every environment graph', () => {
    const probe = makeContextProbe('/tmp/proj');
    const abs = resolve('/tmp/proj', 'src/Card.tsx');
    const client = makeEnvGraph({
      rootDir: '/tmp/proj',
      file: 'src/Card.tsx',
      ids: [abs, `${abs}?v=123`],
    });
    const ssr = makeEnvGraph({ rootDir: '/tmp/proj', file: 'src/Card.tsx' });
    probe.ctx.devServer = {
      environments: {
        client: { moduleGraph: client.moduleGraph },
        ssr: { moduleGraph: ssr.moduleGraph },
      },
    };

    const count = invalidateFileModules(probe.ctx, ['src/Card.tsx']);

    expect(client.invalidated.sort()).toEqual([abs, `${abs}?v=123`].sort());
    expect(ssr.invalidated).toEqual([abs]);
    expect(count).toBe(3);
  });

  it('is a safe no-op for files without loaded nodes', () => {
    const probe = makeContextProbe('/tmp/proj');
    const client = makeEnvGraph({
      rootDir: '/tmp/proj',
      file: 'src/Card.tsx',
      ids: [],
    });
    probe.ctx.devServer = {
      environments: { client: { moduleGraph: client.moduleGraph } },
    };
    expect(invalidateFileModules(probe.ctx, ['src/Other.tsx'])).toBe(0);
  });

  it('falls back to the mixed module graph when environments are absent', () => {
    const probe = makeContextProbe('/tmp/proj');
    const mixed = makeEnvGraph({ rootDir: '/tmp/proj', file: 'src/Card.tsx' });
    probe.ctx.devServer = { moduleGraph: mixed.moduleGraph };
    expect(invalidateFileModules(probe.ctx, ['src/Card.tsx'])).toBe(1);
    expect(mixed.invalidated.length).toBe(1);
  });
});
