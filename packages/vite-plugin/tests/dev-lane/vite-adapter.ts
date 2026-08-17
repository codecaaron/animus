import { readFileSync } from 'fs';
import { createServer as createNetServer } from 'net';
import { join } from 'path';
import { createServer } from 'vite-plus';

import { animusExtract } from '../../src/index';

import type { DevArtifacts, DevServerAdapter } from './scenario';
import type { AddressInfo } from 'net';
import type { Logger, ViteDevServer } from 'vite-plus';

interface ViteDevLaneConfig {
  root: string;
  configFile: false;
  customLogger: Logger;
  optimizeDeps: { noDiscovery: true; include: never[] };
  server: { middlewareMode: true; hmr: { port: number } };
  plugins: ReturnType<typeof animusExtract>[];
}

type StartViteDevLane = (config: ViteDevLaneConfig) => Promise<ViteDevServer>;

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
const SYSTEM_PROPS_MODULE_ID = '\0virtual:animus/system-props';

/** Unwrap `const __vite__css = "..."` from Vite's dev CSS module wrapper. */
function decodeStaticCss(code: string): string {
  const match = code.match(/const __vite__css = ("(?:[^"\\]|\\[\s\S])*")/);
  // SAFETY: The capture is a complete quoted JSON string literal, so parsing it
  // can only produce the CSS string represented by that literal.
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
      // SAFETY: A listening net.Server opened with a numeric port and IP host
      // reports a non-null TCP AddressInfo, never a Unix-socket string.
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

export function createViteDevAdapter(): DevServerAdapter {
  let server: ViteDevServer | null = null;
  let projectRoot = '';

  const startedServer = () => {
    // SAFETY: The adapter lifecycle starts the server before invoking every
    // server-backed method; close handles the allowed never-started state.
    return server!;
  };

  // Bounded evidence trail for timeout forensics: raw chokidar events plus
  // everything the plugin and Vite log. The server runs with a capturing
  // logger instead of `logLevel: 'silent'` — silent DISCARDS the
  // `logger.error` that Vite's watcher handlers route swallowed exceptions
  // into, which is exactly the line that explains a lost file event.
  const trace: string[] = [];
  const record = (line: string): void => {
    trace.push(`${new Date().toISOString().slice(11, 23)} ${line}`);
    if (trace.length > 400) trace.splice(0, trace.length - 400);
  };
  const capturingLogger: Logger = {
    info: (msg: string) => record(`log.info ${msg}`),
    warn: (msg: string) => record(`log.warn ${msg}`),
    warnOnce: (msg: string) => record(`log.warn ${msg}`),
    error: (msg: string) => record(`log.error ${msg}`),
    clearScreen: () => {},
    hasErrorLogged: () => false,
    hasWarned: false,
  };

  // Every hot payload the client environment sends, oldest first. This is the
  // suppression gate's direct observable: a js-update for a module PROVES the
  // browser would re-execute it (and remount its React subtree); its absence
  // while the components virtual module updates proves the gate held.
  const sentUpdatePaths: string[] = [];

  const readModule = async (id: string, decode: (code: string) => string) => {
    const environment = startedServer().environments.client;
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
      projectRoot = root;
      // SAFETY: vite-plus runs Vite's server implementation and consumes the
      // same runtime plugin hooks as the peer-vite Plugin returned by
      // animusExtract; this named seam avoids comparing the duplicate nominal
      // declaration graphs while preserving the exact config and server API.
      const startViteDevLane = createServer as StartViteDevLane;
      server = await startViteDevLane({
        root,
        configFile: false,
        customLogger: capturingLogger,
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
        // verbose: the plugin's HMR decision log (skip/analyzed/reset) goes to
        // the capturing logger, so a barrier timeout can name the layer that
        // dropped an event instead of guessing.
        plugins: [animusExtract({ system: './src/ds.ts', verbose: true })],
      });
      server.watcher.on('all', (event, path) =>
        record(`watcher ${event} ${path}`)
      );
      server.watcher.on('error', (error) =>
        record(`watcher error ${String(error)}`)
      );
      // Capture the client environment's outgoing hot payloads. `hot.send` is
      // the exact seam Vite's updateModules routes through, so what lands in
      // `sentUpdatePaths` is byte-for-byte what a connected browser would act
      // on — no browser needed for update-delivery assertions.
      const hot = server.environments.client.hot;
      // Vite's overloaded send contract forwards either an HMR payload or a
      // custom event tuple; the wrapper preserves both argument forms.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const originalSend: (...args: any[]) => void = hot.send.bind(hot);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hot.send = (...args: any[]) => {
        const payload = args[0];
        if (payload && payload.type === 'update') {
          for (const update of payload.updates ?? []) {
            const path = update.acceptedPath ?? update.path ?? '';
            sentUpdatePaths.push(path);
            record(`hot ${update.type} ${path}`);
          }
        } else if (payload && payload.type === 'full-reload') {
          sentUpdatePaths.push('full-reload');
          record('hot full-reload');
        }
        return originalSend(...args);
      };
    },

    trace(): string[] {
      return [...trace];
    },

    hotUpdatePaths(): string[] {
      return [...sentUpdatePaths];
    },

    isModuleWarm(projectRelativePath: string): boolean {
      const environment = startedServer().environments.client;
      const abs = join(projectRoot, projectRelativePath);
      const mods = environment.moduleGraph.getModulesByFile(abs);
      if (!mods || mods.size === 0) return false;
      for (const mod of mods) {
        if (!mod.transformResult) return false;
      }
      return true;
    },

    async read(): Promise<DevArtifacts> {
      const staticModule = await readModule(STATIC_MODULE_ID, decodeStaticCss);
      const componentModule = await readModule(
        COMPONENT_MODULE_ID,
        decodeComponentCss
      );
      // The prop map module is JS, not CSS — served verbatim.
      const systemPropsModule = await readModule(
        SYSTEM_PROPS_MODULE_ID,
        (code) => code
      );
      return {
        staticCss: staticModule.css,
        componentCss: componentModule.css,
        systemProps: systemPropsModule.css,
        staticRevision: staticModule.revision,
        componentRevision: componentModule.revision,
        systemPropsRevision: systemPropsModule.revision,
      };
    },

    async requestSource(projectRelativePath: string): Promise<string> {
      const result = await startedServer().environments.client.transformRequest(
        `/${projectRelativePath}`
      );
      return result?.code ?? '';
    },

    async requestUrl(url: string): Promise<string> {
      // Vite's transform middleware normalizes a browser URL via `unwrapId`
      // before serving it (see BRIDGE_SCRIPT_SRC in src/constants.ts);
      // `transformRequest` does not, so requesting the raw URL would assert on
      // a path no browser takes. Mirrored here, and nowhere else in the lane,
      // because this is the only URL that is not a plain file path.
      const stripped = url.startsWith('/@id/')
        ? url.slice('/@id/'.length)
        : url;
      const id = stripped.replace('__x00__', '\0');
      const result =
        await startedServer().environments.client.transformRequest(id);
      return result?.code ?? '';
    },

    async indexHtml(): Promise<string> {
      // `server.transformIndexHtml` is the same call the dev HTML middleware
      // makes for a `/` request: it runs the pre/normal/post hook chain over
      // the file on disk, so the returned string is byte-for-byte what a
      // browser is handed.
      const raw = readFileSync(join(projectRoot, 'index.html'), 'utf-8');
      return startedServer().transformIndexHtml('/index.html', raw, '/');
    },

    async close(): Promise<void> {
      if (!server) return;
      const closing = server;
      server = null;
      await closing.close();
    },
  };
}
