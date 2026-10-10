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

/** The optimizer would prebundle an installed source kit from compiled
 *  code, past the transform, so the plugin excludes it and prebundles its
 *  dependencies in its place; a linked kit is source to Vite already. */
test('an installed source kit leaves the dependency optimizer, and its dependencies take its place', () => {
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

  const hook = animusExtract({ system: './src/ds.ts' }).config;
  if (hook === undefined || 'handler' in hook) {
    throw new Error('expected a plain function `config` hook');
  }
  const config: ConfigHookCall = hook;
  expect(
    config({ root: app }, { command: 'serve', mode: 'development' })
  ).toEqual({
    define: { __ANIMUS_DEV__: true },
    optimizeDeps: {
      exclude: ['@acme/installed'],
      include: ['@acme/installed > cjs-dep'],
    },
  });
});
