/**
 * @vitest-environment node
 */
import { createServer } from 'vite-plus';
import { afterEach, expect, test, vi } from 'vitest';

import { probeEnginePrerequisites } from '../../../extract/tests/engine-prerequisites';
import {
  createAliasedKitApp,
  disposeTempRoots,
} from '../../../extract/tests/session/session-fixtures';
import { animusExtract } from '../../src/index';

import type { ViteDevServer } from 'vite-plus';

vi.setConfig({ testTimeout: 60_000 });

const prerequisites = probeEnginePrerequisites();

type StartDevServer = (config: {
  root: string;
  configFile: false;
  logLevel: 'silent';
  resolve: { alias: Record<string, string> };
  plugins: ReturnType<typeof animusExtract>[];
  optimizeDeps: { noDiscovery: true; include: string[] };
  server: { middlewareMode: true; hmr: false };
}) => Promise<ViteDevServer>;

afterEach(() => {
  disposeTempRoots();
});

/** Contract (C8): under Vite's `resolve.alias`, the system evaluates the
 *  kit instance the alias names, the one extraction analyses, so a strict
 *  dev server serves that instance's vocabulary. */
test.skipIf(!prerequisites.ok)(
  'an aliased kit is evaluated from the instance the alias names',
  async () => {
    const root = createAliasedKitApp('animus-vite-aliased-', { esm: true });
    // SAFETY: vite-plus runs Vite's server and consumes the same plugin
    // hooks; only the nominal declarations differ.
    const startDevServer = createServer as StartDevServer;
    const server = await startDevServer({
      root,
      configFile: false,
      logLevel: 'silent',
      resolve: { alias: { kit: 'alt-kit' } },
      plugins: [animusExtract({ system: './src/system.ts', strict: true })],
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { middlewareMode: true, hmr: false },
    });
    try {
      await server.pluginContainer.buildStart({});
      // The served stylesheet module, which embeds the CSS text.
      const served = await server.environments.client.transformRequest(
        '\0virtual:animus/styles.css'
      );
      const css = served?.code ?? '';
      expect(css).toContain('#ff6347');
      expect(css).not.toContain('#111111');
    } finally {
      await server.close();
    }
  }
);
