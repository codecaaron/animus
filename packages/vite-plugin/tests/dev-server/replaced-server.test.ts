import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { createServer as createNetServer } from 'net';
import { tmpdir } from 'os';
import { join, relative } from 'path';
import { createServer } from 'vite-plus';
import { afterEach, expect, test } from 'vitest';

import { animusExtract } from '../../src/index';
import { createDevFixture, INITIAL_BRAND_HEX } from './fixture';
import { until } from './scenario';

import type { AddressInfo } from 'net';
import type { ViteDevServer } from 'vite-plus';

/** A free loopback port: each server's HMR socket needs its own. */
function reserveHmrPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      // SAFETY: a listening net.Server bound to a numeric port and IP host
      // reports a TCP AddressInfo, never a Unix-socket string.
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/** What each of the two servers is started with. */
interface ReplacedServerConfig {
  root: string;
  configFile: false;
  logLevel: 'silent';
  optimizeDeps: { noDiscovery: true; include: never[] };
  server: { middlewareMode: true; hmr: { port: number } };
  plugins: ReturnType<typeof animusExtract>;
}

/** The plugin's resolved stylesheet id; `\0` is Vite's virtual marker. */
const STYLES_ID = '\0virtual:animus/styles.css';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

// Contract: a plugin instance reused with a replacement dev server watches
// the system's outside-root modules on the new server too, so their edits
// still reach the served CSS.
test("a replacement dev server watches the system's outside-root modules", async () => {
  const fixture = createDevFixture();
  cleanups.push(() => fixture.dispose());
  const outside = mkdtempSync(join(tmpdir(), 'animus-outside-palette-'));
  cleanups.push(() => rmSync(outside, { recursive: true, force: true }));
  const palette = join(outside, 'palette.ts');
  writeFileSync(palette, `export const brand = '${INITIAL_BRAND_HEX}';\n`);
  const themePath = join(fixture.root, 'src/theme.ts');
  const specifier = relative(join(fixture.root, 'src'), palette).replace(
    /\.ts$/,
    ''
  );
  fixture.write(
    'src/theme.ts',
    `import { brand } from '${specifier}';\n` +
      readFileSync(themePath, 'utf8').replace(`'${INITIAL_BRAND_HEX}'`, 'brand')
  );

  // One set of plugin objects, as a host that restarts its server keeps it.
  const plugins = animusExtract({ system: './src/ds.ts' });
  const start = async (): Promise<ViteDevServer> => {
    // SAFETY: vite-plus runs Vite's server and consumes the same plugin hooks;
    // only the nominal declarations differ.
    const startServer = createServer as (
      config: ReplacedServerConfig
    ) => Promise<ViteDevServer>;
    const server = await startServer({
      root: fixture.root,
      configFile: false,
      logLevel: 'silent',
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { middlewareMode: true, hmr: { port: await reserveHmrPort() } },
      plugins,
    });
    for (const url of ['/src/main.ts', '/src/Button.ts']) {
      await server.environments.client.transformRequest(url);
    }
    return server;
  };
  const staticCss = async (server: ViteDevServer): Promise<string> => {
    // As the adapter reads it: the graph node first, as import analysis
    // registers it, then the module.
    const environment = server.environments.client;
    await environment.moduleGraph.ensureEntryFromUrl(STYLES_ID, false);
    const result = await environment.transformRequest(STYLES_ID);
    return result?.code ?? '';
  };

  const first = await start();
  await first.close();
  const second = await start();
  cleanups.push(() => second.close());
  expect(await staticCss(second)).toContain(INITIAL_BRAND_HEX);

  writeFileSync(palette, `export const brand = '#ff0000';\n`);
  await until(async () => (await staticCss(second)).includes('#ff0000'), {
    what: 'the outside-root palette edit in the served CSS',
  });
}, 30_000);
