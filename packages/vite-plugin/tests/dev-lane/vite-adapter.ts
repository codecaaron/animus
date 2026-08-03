import { createServer as createNetServer } from 'net';
import { createServer } from 'vite-plus';

import { animusExtract } from '../../src/index';

import type { DevArtifacts, DevServerAdapter } from './scenario';

/**
 * The one real bundler adapter: a programmatic Vite dev server running the
 * plugin from source, with a real chokidar watcher and real virtual modules.
 *
 * Nothing is stubbed. Artifacts are read back through
 * `environment.transformRequest`, i.e. the exact path a browser request takes,
 * so an assertion failure means the browser would have received that byte.
 */

/** Resolved ids the plugin serves — the `\0` prefix is Vite's virtual marker. */
const STATIC_MODULE_ID = '\0virtual:animus/styles.css';
const COMPONENT_MODULE_ID = '\0virtual:animus/components.js';

/** Unwrap `const __vite__css = "..."` from Vite's dev CSS module wrapper. */
function decodeStaticCss(code: string): string {
  const match = code.match(/const __vite__css = ("(?:[^"\\]|\\[\s\S])*")/);
  return match ? (JSON.parse(match[1]) as string) : code;
}

/** Unwrap the template literal the plugin emits for the adopted stylesheet. */
function decodeComponentCss(code: string): string {
  const match = code.match(/export default `([\s\S]*)`;/);
  if (!match) return code;
  return match[1]
    .replace(/\\`/g, '`')
    .replace(/\\\$/g, '$')
    .replace(/\\\\/g, '\\');
}

/**
 * A free loopback port for this server's HMR websocket. Every dev server in the
 * lane gets its own: Vite's default 24678 is a process-wide singleton, and the
 * cold-vs-incremental scenario runs two servers at once.
 */
function reserveHmrPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

export function createViteDevAdapter(): DevServerAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let server: any = null;

  const readModule = async (
    id: string,
    decode: (code: string) => string
  ): Promise<{ css: string; revision: number }> => {
    const environment = server.environments.client;
    const result = await environment.transformRequest(id);
    const node = environment.moduleGraph.getModuleById(id);
    return {
      css: decode(result?.code ?? ''),
      revision: node?.lastInvalidationTimestamp ?? 0,
    };
  };

  return {
    name: 'vite',

    async start(root: string): Promise<void> {
      // The config type is erased on purpose. The plugin is typed against its
      // `vite` peer while vite-plus vendors its own structurally identical copy
      // of those types; comparing the two inline configs is a nominal mismatch
      // that also blows the type-instantiation depth limit.
      const start = createServer as unknown as (
        config: unknown
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ) => Promise<any>;
      server = await start({
        root,
        configFile: false,
        logLevel: 'silent',
        // The fixture has no runtime deps to prebundle, and discovery would
        // crawl the symlinked workspace on every cold start.
        optimizeDeps: { noDiscovery: true, include: [] },
        server: {
          middlewareMode: true,
          // `hmr: false` would switch the watcher's HMR dispatch off entirely
          // and the plugin's hot-update hook would never run — the lane needs
          // it on, just on a port of its own.
          hmr: { port: await reserveHmrPort() },
        },
        plugins: [animusExtract({ system: './src/ds.ts' })],
      });
    },

    async read(): Promise<DevArtifacts> {
      const staticModule = await readModule(STATIC_MODULE_ID, decodeStaticCss);
      const componentModule = await readModule(
        COMPONENT_MODULE_ID,
        decodeComponentCss
      );
      return {
        staticCss: staticModule.css,
        componentCss: componentModule.css,
        staticRevision: staticModule.revision,
        componentRevision: componentModule.revision,
      };
    },

    async requestSource(projectRelativePath: string): Promise<string> {
      const result = await server.environments.client.transformRequest(
        `/${projectRelativePath}`
      );
      return result?.code ?? '';
    },

    async close(): Promise<void> {
      if (!server) return;
      const closing = server;
      server = null;
      await closing.close();
    },
  };
}
