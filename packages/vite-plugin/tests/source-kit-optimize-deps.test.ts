import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, expect, test } from 'vitest';

import { animusExtract } from '../src/index';

import type { HookHandler, Plugin } from 'vite';

type ConfigHookCall = OmitThisParameter<
  HookHandler<NonNullable<Plugin['config']>>
>;

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function sourceKit(dir: string, dependencies: Record<string, string>): void {
  write(
    join(dir, 'package.json'),
    JSON.stringify({
      exports: {
        '.': { animus: './src/index.ts', import: './dist/index.mjs' },
      },
      dependencies,
    })
  );
  write(join(dir, 'src', 'index.ts'), 'export const Card = 1;');
}

/** Contract: a discovered kit is never served past the transform. The
 *  optimizer would prebundle an installed kit past it (a source kit from
 *  compiled code, a compiled kit with its builder code raw), so the plugin
 *  excludes every installed kit, one that declares the source condition or
 *  one the system extends, and prebundles its dependencies in its place; a
 *  linked kit is source to Vite already. SSR, in development and in a build,
 *  would externalize it and load its dist, so it stays in the SSR
 *  transform. */
test('an installed kit leaves the dependency optimizer and SSR externals, and its dependencies take its place', async () => {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), 'animus-kit-optimize-'))
  );
  roots.push(root);
  const app = join(root, 'app');
  write(
    join(app, 'package.json'),
    JSON.stringify({
      dependencies: {
        '@acme/installed': '1.0.0',
        '@acme/linked': 'link:../linked',
        react: '19',
      },
    })
  );
  sourceKit(join(app, 'node_modules', '@acme', 'installed'), {
    'cjs-dep': '1.0.0',
  });
  sourceKit(join(root, 'linked'), { 'other-dep': '1.0.0' });
  symlinkSync(
    join(root, 'linked'),
    join(app, 'node_modules', '@acme', 'linked'),
    'dir'
  );
  write(
    join(app, 'node_modules', 'react', 'package.json'),
    '{"main":"index.js"}'
  );
  // A compiled kit, with no source condition: the system extends it.
  write(
    join(app, 'node_modules', 'compiled-kit', 'package.json'),
    JSON.stringify({
      name: 'compiled-kit',
      exports: { './definition': './dist/definition.js' },
      dependencies: { 'runtime-dep': '1.0.0' },
    })
  );
  write(
    join(app, 'node_modules', 'compiled-kit', 'dist', 'definition.js'),
    'export const system = {};'
  );
  write(
    join(app, 'src', 'ds.ts'),
    [
      `import { createSystem } from '@animus-ui/system';`,
      `import { system as kit } from 'compiled-kit/definition';`,
      `export const ds = createSystem().extend(kit).build();`,
    ].join('\n')
  );

  const hook = animusExtract({ system: './src/ds.ts' })[0].config;
  if (hook === undefined || 'handler' in hook) {
    throw new Error('expected a plain function `config` hook');
  }
  const config: ConfigHookCall = hook;
  const kits = {
    optimizeDeps: {
      exclude: ['@acme/installed', 'compiled-kit'],
      include: ['@acme/installed > cjs-dep', 'compiled-kit > runtime-dep'],
    },
    ssr: { noExternal: ['@acme/installed', 'compiled-kit'] },
  };
  expect(
    await config({ root: app }, { command: 'serve', mode: 'development' })
  ).toEqual({ define: { __ANIMUS_DEV__: true }, ...kits });
  expect(
    await config({ root: app }, { command: 'build', mode: 'production' })
  ).toEqual({ define: { __ANIMUS_DEV__: false }, ...kits });
});
