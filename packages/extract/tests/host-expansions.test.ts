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
import {
  webpackHostExpander,
  webpackLoadExpander,
} from '../pipeline/webpack-expansions';

import type { ListedArgs, ListedLoad } from '../pipeline/host-expansions';
import type {
  WebpackOptionsReading,
  WebpackRuleReading,
} from '../pipeline/webpack-expansions';

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

  // Contract: an adapted original (`.mdx`, `.svelte`) a load expands to
  // reads as the analysis children it holds, as a probe base does
  // (`hostCandidate`): one with none analysed, or loaded with a query, is
  // not the analysed module.
  test('an adapted original reads as its analysed children', () => {
    const load: ListedLoad = {
      importer: 'src/docs.ts',
      start: 0,
      kind: 'glob',
      args: null,
    };
    const [expansion] = hostExpansions(
      [load],
      '/root',
      new Set(['src/a.mdx.tsx']),
      {
        expand: () => [
          { path: 'src/a.mdx', query: '' },
          { path: 'src/b.mdx', query: '' },
          { path: 'src/a.mdx', query: '?raw' },
        ],
      },
      builtInAssetClassification('noHost').isAsset,
      new Map([
        ['src/a.mdx', ['src/a.mdx.tsx']],
        ['src/b.mdx', ['src/b.mdx.tsx']],
      ])
    );
    expect(expansion?.files).toEqual([
      { path: 'src/a.mdx.tsx', status: 'analysed' },
      { path: 'src/b.mdx', status: 'unanalysed' },
      { path: 'src/a.mdx?raw', status: 'opaque' },
    ]);
  });
});

describe('viteLoadExpander', () => {
  // Contract: a Vite record lists exactly the modules a Vite 8 build bundles
  // for that load, and a load it cannot reproduce exactly lists none. Each
  // expected set is what a real \`vite build\` (8.2.2; 8.3.4 with rolldown
  // 1.2.14 for the dot-led and \`node_modules\` names below a common walk
  // base, and an object query) bundled.
  test('lists what a Vite build bundles, or nothing', () => {
    const root = mkdtempSync(join(tmpdir(), 'animus-vite-expansions-'));
    for (const file of [
      'src/pages/a.js',
      'src/pages/b.ts',
      'src/pages/.hidden.js',
      'src/pages/sub/d.js',
      'src/pages/sub/.cfg.js',
      'src/pages/.config/c.js',
      'src/pages/node_modules/pkg/index.js',
      'src/pages/x.test.js',
      'src/other/o.js',
      'src/external/mutate.js',
      'src/dots/..foo.js',
      'locked/l.js',
    ]) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), 'export default 1;\n');
    }
    // A link Vite follows to the file it bundles, and a directory it
    // cannot read.
    mkdirSync(join(root, 'src/linked'));
    symlinkSync('../external/mutate.js', join(root, 'src/linked/linked.js'));
    chmodSync(join(root, 'locked'), 0o000);
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
        unreadable: glob(['../../locked/*.js']),
        // The walk starts where every affirmed glob's base is, and leaves
        // out every dot-led and node_modules name below it.
        dottedBelow: glob(['./*/.cfg.js']),
        dottedTwo: glob(['./.config/*.js', '../other/*.js']),
        nodeModulesTwo: glob(['./node_modules/pkg/*.js', '../other/*.js']),
        dottedBase: glob(['./.config/*.js']),
        objectQuery: expand('glob', {
          patterns: ['./*.js'],
          options: { query: { foo: 'bar', baz: true } },
        }),
        unreadSyntax: [glob(['../d?ta/*.js']), glob(['../d[ab]ta/*.js'])],
        dotDot: expand('glob', {
          patterns: ['../dots/*.js'],
          options: { exhaustive: true },
        }),
      }).toEqual({
        negated: ['src/pages/x.test.js'],
        deep: ['src/pages/a.js', 'src/pages/sub/d.js', 'src/pages/x.test.js'],
        exhaustive: [
          'src/pages/.config/c.js',
          'src/pages/.hidden.js',
          'src/pages/a.js',
          'src/pages/node_modules/pkg/index.js',
          'src/pages/sub/.cfg.js',
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
        dottedBelow: [],
        dottedTwo: ['src/other/o.js'],
        nodeModulesTwo: ['src/other/o.js'],
        dottedBase: ['src/pages/.config/c.js'],
        objectQuery: [
          'src/pages/a.js?foo=bar&baz=true',
          'src/pages/x.test.js?foo=bar&baz=true',
        ],
        dotDot: ['src/dots/..foo.js'],
      });
      // An environment that leaves a variable import at runtime is not
      // reproduced, nor a load whose file an alias rewrites: Vite imports
      // each by its path from the importer (here `./sub/d.js`) through the
      // aliases, and aliases no pattern (vite-plus-core 1.3.0).
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
        matchingString: host([/node_modules/], [{ find: './sub' }]),
        matchingRegExp: host([/node_modules/], [{ find: /^\.\/sub\/d\.js$/ }]),
        otherDirectory: host([/node_modules/], [{ find: './pages' }]),
        namePrefix: host([/node_modules/], [{ find: './su' }]),
        fromRoot: host([/node_modules/], [{ find: '/src/pages/sub' }]),
        packageRegExp: host([/node_modules/], [{ find: /^@/ }]),
      }).toEqual({
        everyDefault: ['src/pages/sub/d.js'],
        ssrExcluded: undefined,
        matchingString: undefined,
        matchingRegExp: undefined,
        otherDirectory: [{ path: 'src/pages/sub/d.js', query: '' }],
        namePrefix: [{ path: 'src/pages/sub/d.js', query: '' }],
        fromRoot: [{ path: 'src/pages/sub/d.js', query: '' }],
        packageRegExp: [{ path: 'src/pages/sub/d.js', query: '' }],
      });
      // Environments that resolve links differently load a globbed link by
      // different paths: no one expansion is exact.
      expect(
        viteHostExpander({
          root,
          resolve: { alias: [] },
          environments: {
            client: bundled,
            ssr: { ...bundled, resolve: { preserveSymlinks: true } },
          },
        })
      ).toBeUndefined();
    } finally {
      chmodSync(join(root, 'locked'), 0o755);
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('viteHostExpander', () => {
  // Contract: a Vite glob of adapted originals reads as their analysed
  // children under aliases that rewrite none of its files, as in a docs app
  // that aliases its snippets from the root.
  test('an mdx glob under root aliases reads as its analysed children', () => {
    const root = mkdtempSync(join(tmpdir(), 'animus-vite-mdx-glob-'));
    for (const file of [
      'src/shell/Shell.tsx',
      'content/ui/a.mdx',
      'content/guide/deep/b.mdx',
      'content/snippets/s.mdx',
    ]) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), '\n');
    }
    try {
      const expander = viteHostExpander({
        root,
        resolve: {
          alias: [
            { find: '/snippets/ui/StoryEmbed.mdx' },
            { find: /^\/snippets\// },
          ],
        },
        environments: { client: { isBundled: true } },
      });
      const children = ['content/ui/a.mdx.tsx', 'content/guide/deep/b.mdx.tsx'];
      const expansions = hostExpansions(
        [
          {
            importer: 'src/shell/Shell.tsx',
            start: 0,
            kind: 'glob',
            args: {
              patterns: ['../../content/{ui,guide}/**/*.mdx'],
              options: null,
            },
          },
        ],
        root,
        new Set(['src/shell/Shell.tsx', ...children]),
        expander!,
        undefined,
        new Map([
          ['content/ui/a.mdx', [children[0]!]],
          ['content/guide/deep/b.mdx', [children[1]!]],
        ])
      );
      expect(expansions.map(({ files }) => files)).toEqual([
        [
          { path: 'content/guide/deep/b.mdx.tsx', status: 'analysed' },
          { path: 'content/ui/a.mdx.tsx', status: 'analysed' },
        ],
      ]);
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
      'src/locked/l.js',
    ]) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), 'export default 1;\n');
    }
    // A directory the walk cannot read.
    chmodSync(join(root, 'src/locked'), 0o000);
    const reading = (aliasNames: string[] = []) => ({
      extensions: ['.js', '.json', '.wasm'],
      mainFiles: ['index'],
      modules: [['node_modules']],
      fullySpecified: false,
      enforceExtension: false,
      aliasNames,
      symlinks: true,
    });
    const expandWith = (
      expander: ReturnType<typeof webpackLoadExpander> | undefined,
      kind: ListedLoad['kind'],
      args: ListedArgs
    ) =>
      expander
        ?.expand({ importer: 'src/entry.js', start: 0, kind, args }, root)
        ?.map(({ path, query }) => `${path}${query}`);
    const expander = webpackLoadExpander(() => reading(), true);
    const expand = (kind: ListedLoad['kind'], args: ListedArgs) =>
      expandWith(expander, kind, args);
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
      // \`resolve.symlinks\` decides which path a linked file loads by, and
      // so where its own imports resolve: the real file, or the link (what
      // webpack 5.105.4 loaded, \`symlinks\` on and off).
      mkdirSync(join(root, 'src/real'), { recursive: true });
      writeFileSync(join(root, 'src/real/r.js'), 'export default 1;\n');
      mkdirSync(join(root, 'src/linked'));
      symlinkSync('../real/r.js', join(root, 'src/linked/r.js'));
      const linked = (symlinks: boolean | undefined) =>
        expandWith(
          webpackLoadExpander(() => ({ ...reading(), symlinks }), true),
          'context',
          {
            dir: './linked',
            recursive: null,
            regExp: null,
            include: null,
            exclude: null,
            mode: null,
          }
        );
      expect({
        followed: linked(true),
        kept: linked(false),
        resolversDiffer: linked(undefined),
      }).toEqual({
        followed: ['src/real/r.js'],
        kept: ['src/linked/r.js'],
        resolversDiffer: undefined,
      });
      // What the expander does not read gives no record: a resolver alias
      // that could redirect a relative or absolute request, a rule with its
      // own resolve or context parser options, an unreadable directory.
      const pages = {
        dir: './pages',
        recursive: null,
        regExp: null,
        include: null,
        exclude: null,
        mode: null,
      };
      // The rules as the compiler holds them, read at each expansion.
      const rules: WebpackRuleReading[] = [];
      const host = (
        options: Partial<WebpackOptionsReading> = {},
        aliasNames: string[] = []
      ) =>
        webpackHostExpander({
          resolveReading: () => reading(aliasNames),
          options: () => ({
            rules,
            defaultRulesAreWebpacks: true,
            wrappedDefaults: true,
            ...options,
          }),
        });
      const viaHost = (hostExpander: ReturnType<typeof webpackHostExpander>) =>
        expandWith(hostExpander, 'context', pages)?.length;
      const later = host();
      const before = viaHost(later);
      // A rule a plugin adds after the host installed.
      rules.push({ resolve: { extensions: ['.special'] } });
      const after = viaHost(later);
      rules.length = 0;
      expect({
        before,
        after,
        // Any alias or fallback, a package's or a module directory's
        // included, could redirect a context or a matched request.
        relativeAlias: viaHost(host({}, ['./pages'])),
        absoluteAlias: viaHost(host({}, [join(root, 'src/pages/a.js')])),
        packageAlias: viaHost(host({}, ['pkg'])),
        directoryAlias: viaHost(host({}, ['pages'])),
        ruleResolve: viaHost(
          host({ rules: [{ resolve: { extensions: ['.special'] } }] })
        ),
        ruleParser: viaHost(
          host({ rules: [{ parser: { wrappedContextRegExp: /[\s\S]*/ } }] })
        ),
        ruleOther: viaHost(host({ rules: [{ parser: { javascript: {} } }] })),
        changedDefaultRules: viaHost(host({ defaultRulesAreWebpacks: false })),
        unreadableOptions: viaHost(
          webpackHostExpander({
            resolveReading: () => reading(),
            options: () => {
              throw new Error('options unavailable');
            },
          })
        ),
        unreadable: context('./locked'),
      }).toEqual({
        before: 5,
        after: undefined,
        relativeAlias: undefined,
        absoluteAlias: undefined,
        packageAlias: undefined,
        directoryAlias: undefined,
        ruleResolve: undefined,
        ruleParser: undefined,
        ruleOther: 5,
        changedDefaultRules: undefined,
        unreadableOptions: undefined,
        unreadable: undefined,
      });
    } finally {
      chmodSync(join(root, 'src/locked'), 0o755);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
