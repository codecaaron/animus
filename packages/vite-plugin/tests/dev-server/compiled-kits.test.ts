import { execFileSync } from 'child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { build, createServer } from 'vite-plus';
import { afterEach, expect, test } from 'vitest';

import { animusExtract } from '../../src/index';

import type { ViteDevServer } from 'vite-plus';

interface KitAppConfig {
  root: string;
  configFile: false;
  logLevel: 'silent';
  plugins: ReturnType<typeof animusExtract>[];
}

type StartDevServer = (
  config: KitAppConfig & {
    optimizeDeps: { noDiscovery: true; include: string[] };
    server: { middlewareMode: true; hmr: false };
  }
) => Promise<ViteDevServer>;

type RunSsrBuild = (
  config: KitAppConfig & { build: { ssr: string; outDir: string } }
) => Promise<object>;

const REPO_ROOT = resolve(__dirname, '../../../..');

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * An application whose system extends the installed compiled kit `kit`,
 * whose own system extends the installed compiled kit `nested`; neither
 * declares the source condition. `src/render.js` renders nested's Card.
 */
function nestedKitApp(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'animus-kits-')));
  roots.push(root);
  const write = (path: string, source: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  };
  mkdirSync(join(root, 'node_modules/@animus-ui'), { recursive: true });
  symlinkSync(
    join(REPO_ROOT, 'packages/system'),
    join(root, 'node_modules/@animus-ui/system'),
    'dir'
  );
  for (const name of ['react', 'react-dom']) {
    symlinkSync(
      realpathSync(join(REPO_ROOT, 'node_modules', name)),
      join(root, 'node_modules', name),
      'dir'
    );
  }
  write(
    'package.json',
    JSON.stringify({
      name: 'app',
      type: 'module',
      dependencies: { kit: '1.0.0', nested: '1.0.0' },
    })
  );
  for (const [name, extended] of [
    ['nested', null],
    ['kit', 'nested'],
  ] as const) {
    write(
      `node_modules/${name}/package.json`,
      JSON.stringify({
        name,
        version: '1.0.0',
        type: 'module',
        exports: {
          '.': './dist/index.js',
          './definition': './dist/definition.js',
        },
      })
    );
    write(
      `node_modules/${name}/dist/definition.js`,
      extended === null
        ? `import { createSystem } from '@animus-ui/system';
export const ds = createSystem().build().seal();`
        : `import { createSystem } from '@animus-ui/system';
import { ds as nested } from '${extended}/definition';
export const ds = createSystem().extend(nested).build().seal();`
    );
    write(
      `node_modules/${name}/dist/index.js`,
      `import { ds } from './definition.js';
export const Card = ds.styles({ padding: 4 }).asElement('div');`
    );
  }
  write(
    'src/ds.js',
    `import { createSystem, createTheme } from '@animus-ui/system';
import { ds as kit } from 'kit/definition';
export const theme = createTheme().build();
export const ds = createSystem().extend(kit).build().seal();`
  );
  write(
    'src/main.js',
    `import React from 'react';
import { Card } from 'nested';
export const App = () => React.createElement(Card, null, 'hello');`
  );
  write(
    'src/render.js',
    `import React from 'react';
import { renderToString } from 'react-dom/server';
import { App } from './main.js';
export const html = renderToString(React.createElement(App));`
  );
  return root;
}

const RENDERED_CARD = /^<div class="animus-Card-\w+">hello/;

// Contract: a discovered kit is never served past the transform — not by
// the dependency optimizer, and not by SSR externalizing it — including a
// kit only another kit's system extends.
test('dev SSR serves a kit another kit extends through the transform, though the config asks to prebundle it', async () => {
  const root = nestedKitApp();
  // SAFETY: vite-plus runs Vite's server and consumes the same plugin hooks;
  // only the nominal declarations differ, and tsc overflows on them.
  const startDevServer = createServer as StartDevServer;
  const server = await startDevServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [animusExtract({ system: './src/ds.js' })],
    optimizeDeps: { noDiscovery: true, include: ['nested', 'react'] },
    server: { middlewareMode: true, hmr: false },
  });
  try {
    await server.pluginContainer.buildStart({});
    const { html } = await server.ssrLoadModule('/src/render.js');
    expect(html).toMatch(RENDERED_CARD);
    expect(server.config.optimizeDeps.exclude).toEqual(['kit', 'nested']);
  } finally {
    await server.close();
  }
});

test("a kit's private copy of a kit it extends is the copy served through the transform, beside the application's own", async () => {
  const root = nestedKitApp();
  const own = join(root, 'node_modules/nested');
  const copy = join(root, 'node_modules/kit/node_modules/nested');
  mkdirSync(join(copy, 'dist'), { recursive: true });
  for (const file of ['package.json', 'dist/definition.js']) {
    writeFileSync(join(copy, file), readFileSync(join(own, file)));
  }
  writeFileSync(
    join(copy, 'dist/index.js'),
    `import { ds } from './definition.js';
export const Card = ds.styles({ padding: 16 }).asElement('div');`
  );
  writeFileSync(
    join(root, 'node_modules/kit/dist/index.js'),
    `export { Card } from 'nested';`
  );
  writeFileSync(
    join(root, 'src/main.js'),
    `import React from 'react';
import { Card } from 'kit';
export const App = () => React.createElement(Card, null, 'hello');`
  );
  // SAFETY: vite-plus runs Vite's server and consumes the same plugin hooks;
  // only the nominal declarations differ, and tsc overflows on them.
  const startDevServer = createServer as StartDevServer;
  const server = await startDevServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [animusExtract({ system: './src/ds.js' })],
    optimizeDeps: { noDiscovery: true, include: ['react'] },
    server: { middlewareMode: true, hmr: false },
  });
  try {
    await server.pluginContainer.buildStart({});
    const { html } = await server.ssrLoadModule('/src/render.js');
    expect(html).toMatch(RENDERED_CARD);
  } finally {
    await server.close();
  }
});

test('an SSR build renders a compiled kit through the transform', async () => {
  const root = nestedKitApp();
  // SAFETY: vite-plus runs Vite's build and consumes the same plugin hooks;
  // only the nominal declarations differ, and tsc overflows on them.
  const runSsrBuild = build as RunSsrBuild;
  await runSsrBuild({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [animusExtract({ system: './src/ds.js' })],
    build: { ssr: 'src/render.js', outDir: join(root, 'out') },
  });
  // Node runs the output as an SSR server would, its externals included.
  const html = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { html } from './out/render.js';
process.stdout.write(html);`,
    ],
    { cwd: root, encoding: 'utf-8' }
  );
  expect(html).toMatch(RENDERED_CARD);
});
