import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { builtInAssetClassification } from '../pipeline/host-assets';
import { hostExpansions } from '../pipeline/host-expansions';
import { viteLoadExpander } from '../pipeline/vite-expansions';
import { webpackLoadExpander } from '../pipeline/webpack-expansions';

import type { ListedArgs, ListedLoad } from '../pipeline/host-expansions';

describe('hostExpansions', () => {
  // Contract: a query selects how the host loads a file, which can be other
  // code than the module (a plugin transforms `p.ts?mutate`), so a queried
  // file is never the analysed module: opaque where the host loads it as a
  // value, otherwise unanalysed, keyed with its query.
  test('a queried expansion file is never the analysed module', () => {
    const load: ListedLoad = {
      importer: 'src/load.ts',
      start: 0,
      kind: 'glob',
      args: null,
    };
    const [expansion] = hostExpansions(
      [load],
      '/root',
      new Set(['src/p.ts']),
      {
        expand: () => [
          { path: 'src/p.ts', query: '' },
          { path: 'src/p.ts', query: '?mutate' },
          { path: 'src/p.ts', query: '?raw' },
        ],
      },
      builtInAssetClassification('noHost').isAsset
    );
    expect(expansion?.files).toEqual([
      { path: 'src/p.ts', status: 'analysed' },
      { path: 'src/p.ts?mutate', status: 'unanalysed' },
      { path: 'src/p.ts?raw', status: 'opaque' },
    ]);
  });
});

describe('viteLoadExpander', () => {
  // Contract: a Vite record lists exactly the modules a Vite 8 build bundles
  // for that load, and a load it cannot reproduce exactly lists none. Each
  // expected set is what a real \`vite build\` (8.2.2) bundled.
  test('lists what a Vite build bundles, or nothing', () => {
    const root = mkdtempSync(join(tmpdir(), 'animus-vite-expansions-'));
    for (const file of [
      'src/pages/a.js',
      'src/pages/b.ts',
      'src/pages/.hidden.js',
      'src/pages/sub/d.js',
      'src/pages/node_modules/pkg/index.js',
      'src/pages/x.test.js',
      'src/other/o.js',
    ]) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), 'export default 1;\n');
    }
    const expander = viteLoadExpander(root, true);
    const expand = (kind: ListedLoad['kind'], args: ListedArgs) =>
      expander
        .expand({ importer: 'src/pages/entry.js', start: 0, kind, args }, root)
        ?.map(({ path, query }) => `${path}${query}`);
    const glob = (patterns: string[]) =>
      expand('glob', { patterns, options: null });
    const vars = (quasis: string[], template = true) =>
      expand('import', { quasis, template, options: null, comments: [] });
    try {
      expect({
        negated: glob(['./*.js', '!./a.js']),
        deep: glob(['../pages/**/*.js']),
        exhaustive: expand('glob', {
          patterns: ['./**/*.js'],
          options: { exhaustive: true },
        }),
        raw: expand('glob', {
          patterns: ['/src/pages/{a,b}.*'],
          options: { query: '?raw', import: 'default' },
        }),
        twoPatterns: glob(['./*.ts', '../other/*.js']),
        template: vars(['./sub/', '.js']),
        ownDirectory: vars(['./', '.js']),
        deprecatedAs: expand('glob', {
          patterns: ['./*.js'],
          options: { as: 'raw' },
        }),
        concatenation: vars(['./sub/', '.js'], false),
        noExtension: vars(['./sub/', '']),
        ignored: expand('import', {
          quasis: ['./sub/', '.js'],
          template: true,
          options: null,
          comments: ['/* @vite-ignore */'],
        }),
      }).toEqual({
        negated: ['src/pages/x.test.js'],
        deep: ['src/pages/a.js', 'src/pages/sub/d.js', 'src/pages/x.test.js'],
        exhaustive: [
          'src/pages/.hidden.js',
          'src/pages/a.js',
          'src/pages/node_modules/pkg/index.js',
          'src/pages/sub/d.js',
          'src/pages/x.test.js',
        ],
        raw: ['src/pages/a.js?raw', 'src/pages/b.ts?raw'],
        twoPatterns: ['src/other/o.js', 'src/pages/b.ts'],
        template: ['src/pages/sub/d.js'],
        ownDirectory: ['src/pages/a.js', 'src/pages/x.test.js'],
        deprecatedAs: undefined,
        concatenation: undefined,
        noExtension: undefined,
        ignored: undefined,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('webpackLoadExpander', () => {
  // Contract: a webpack record lists exactly the modules a webpack 5 build
  // puts in that load's context module, and a load it cannot reproduce
  // exactly lists none. Each expected set is what a real webpack (5.105.4)
  // build put there, under its default resolver reading.
  test('lists what a webpack context holds, or nothing', () => {
    const root = mkdtempSync(join(tmpdir(), 'animus-webpack-expansions-'));
    for (const file of [
      'src/pages/a.js',
      'src/pages/.hidden.js',
      'src/pages/sub/index.js',
      'src/pages/data.json',
      'src/pages/x.test.js',
      'src/pages/entry.js',
    ]) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), 'export default 1;\n');
    }
    const expander = webpackLoadExpander(
      () => ({
        extensions: ['.js', '.json', '.wasm'],
        mainFiles: ['index'],
        modules: [['node_modules']],
        fullySpecified: false,
        enforceExtension: false,
      }),
      true
    );
    const expand = (kind: ListedLoad['kind'], args: ListedArgs) =>
      expander
        .expand({ importer: 'src/entry.js', start: 0, kind, args }, root)
        ?.map(({ path, query }) => `${path}${query}`);
    const context = (
      dir: string,
      read: {
        recursive?: boolean;
        regExp?: { source: string; flags: string };
        include?: { source: string; flags: string };
      } = {}
    ) =>
      expand('context', {
        dir,
        recursive: read.recursive ?? null,
        regExp: read.regExp ?? null,
        include: read.include ?? null,
        exclude: null,
        mode: null,
      });
    const specifier = (
      quasis: string[],
      template = true,
      comments: string[] = []
    ) => expand('import', { quasis, template, options: null, comments });
    try {
      expect({
        everything: context('./pages'),
        flat: context('./pages', { recursive: false }),
        extensionless: context('./pages', {
          regExp: { source: '^\\.\\/[a-z]+$', flags: '' },
        }),
        included: context('./pages', { include: { source: 'sub', flags: '' } }),
        template: specifier(['./pages/', '.js']),
        concatenation: specifier(['./pages/', '.js'], false),
        selected: specifier(['./pages/', ''], true, [
          '/* webpackInclude: /\\.json$/ */',
        ]),
        twoHoles: specifier(['./pages/', '/', '.js'], false),
        sticky: context('./pages', { regExp: { source: 'a', flags: 'g' } }),
      }).toEqual({
        everything: [
          'src/pages/a.js',
          'src/pages/data.json',
          'src/pages/entry.js',
          'src/pages/sub/index.js',
          'src/pages/x.test.js',
        ],
        flat: [
          'src/pages/a.js',
          'src/pages/data.json',
          'src/pages/entry.js',
          'src/pages/x.test.js',
        ],
        extensionless: [
          'src/pages/a.js',
          'src/pages/data.json',
          'src/pages/entry.js',
          'src/pages/sub/index.js',
        ],
        included: ['src/pages/sub/index.js'],
        template: [
          'src/pages/a.js',
          'src/pages/entry.js',
          'src/pages/sub/index.js',
          'src/pages/x.test.js',
        ],
        concatenation: [
          'src/pages/a.js',
          'src/pages/entry.js',
          'src/pages/sub/index.js',
          'src/pages/x.test.js',
        ],
        selected: undefined,
        twoHoles: undefined,
        sticky: undefined,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
