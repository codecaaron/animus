import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { builtInAssetClassification } from '../pipeline/host-assets';
import { hostExpansions } from '../pipeline/host-expansions';
import {
  viteHostExpander,
  viteLoadExpander,
} from '../pipeline/vite-expansions';

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
      'src/external/mutate.js',
      'src/dots/..foo.js',
      'src/locked/l.js',
    ]) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), 'export default 1;\n');
    }
    // A link Vite follows to the file it bundles, and a directory it
    // cannot read.
    mkdirSync(join(root, 'src/linked'));
    symlinkSync('../external/mutate.js', join(root, 'src/linked/linked.js'));
    chmodSync(join(root, 'src/locked'), 0o000);
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
        linked: glob(['../linked/*.js']),
        unreadable: glob(['../locked/*.js']),
        unreadSyntax: [glob(['../d?ta/*.js']), glob(['../d[ab]ta/*.js'])],
        dotDot: expand('glob', {
          patterns: ['../dots/*.js'],
          options: { exhaustive: true },
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
        linked: ['src/external/mutate.js'],
        unreadable: undefined,
        unreadSyntax: [undefined, undefined],
        dotDot: ['src/dots/..foo.js'],
      });
      // An environment that leaves a variable import at runtime, or an
      // alias that could rewrite a relative specifier, is not reproduced.
      const bundled = {
        isBundled: true,
        build: { dynamicImportVarsOptions: { exclude: [/node_modules/] } },
      };
      const host = (
        ssrExclude: unknown[],
        alias: Array<{ find: string | RegExp }>
      ) =>
        viteHostExpander({
          root,
          resolve: { alias },
          environments: {
            client: bundled,
            ssr: {
              isBundled: true,
              build: { dynamicImportVarsOptions: { exclude: ssrExclude } },
            },
          },
        })?.expand(
          {
            importer: 'src/pages/entry.js',
            start: 0,
            kind: 'import',
            args: {
              quasis: ['./sub/', '.js'],
              template: true,
              options: null,
              comments: [],
            },
          },
          root
        );
      expect({
        // Vite's own client aliases are in every configuration.
        everyDefault: host(
          [/node_modules/],
          [{ find: /^\/?@vite\/env/ }, { find: /^\/?@vite\/client/ }]
        )?.map(({ path }) => path),
        ssrExcluded: host(['**/entry.js'], []),
        relativeAlias: host([/node_modules/], [{ find: './pages' }]),
        regExpAlias: host([/node_modules/], [{ find: /^@/ }]),
      }).toEqual({
        everyDefault: ['src/pages/sub/d.js'],
        ssrExcluded: undefined,
        relativeAlias: undefined,
        regExpAlias: undefined,
      });
    } finally {
      chmodSync(join(root, 'src/locked'), 0o755);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
