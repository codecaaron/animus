// @vitest-environment node
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, describe, expect, test, vi } from 'vitest';

import { insertLoader, LayergatePlugin } from '../src/webpack';
import layergateLoader from '../src/webpack-loader';
import { loaderPath } from '../src/webpack-state';

import type { Compiler as LayergateCompiler } from '../src/webpack';

vi.setConfig({ testTimeout: 60_000 });

const requireCjs = createRequire(import.meta.url);
// The webpack and css-loader Next 15 builds with.
const NEXT = join(
  dirname(
    requireCjs.resolve('next/package.json', {
      paths: [resolve(import.meta.dirname, '../../../e2e/next-app')],
    })
  )
);
const CSS_LOADER = join(
  NEXT,
  'dist/build/webpack/loaders/css-loader/src/index.js'
);
const postcss: unknown = requireCjs(
  requireCjs.resolve('postcss', { paths: [NEXT] })
);

interface StatsOptions {
  errors?: boolean;
  warnings?: boolean;
}
interface Stats {
  hasErrors(): boolean;
  toJson(options: StatsOptions): {
    errors?: { message: string }[];
    warnings?: { message: string }[];
  };
}
interface WatchOptions {
  aggregateTimeout: number;
}
/** The config these tests hand webpack. */
interface Config {
  mode: 'development';
  devtool: false;
  context: string;
  entry: string;
  target: 'node';
  output: {
    path: string;
    filename: string;
    library: { type: 'commonjs2' };
    assetModuleFilename: string;
    publicPath: string;
  };
  module: {
    rules: (
      | { test: RegExp; use: { loader: string; options: CssLoaderOptions }[] }
      | { test: RegExp; type: 'asset/resource' }
    )[];
  };
  resolve: { symlinks: boolean; alias: Record<string, string> };
  cache: { type: 'memory' } | { type: 'filesystem'; cacheDirectory: string };
  snapshot: { managedPaths: RegExp[] };
  plugins: LayergatePlugin[];
}
/** How a test varies the compiler. */
interface Variant {
  symlinks?: boolean;
  alias?: Record<string, string>;
  cacheDirectory?: string;
  /** css-loader's `modules`, when not `false`, as Next's global chains
   *  set it. */
  modules?: { value: unknown };
  /** Whether layergate's plugin runs; false builds natively. */
  plugin?: boolean;
  sheets?: string[];
}
interface CssLoaderOptions {
  postcss(): Promise<{ postcss: unknown }>;
  modules?: unknown;
}
/** A compilation, as the trace hook reads it: not at all. */
interface Compilation {
  readonly name?: string;
}
/** A loader context, which the trace hook gives a span. */
interface LoaderContext {
  currentTraceSpan?: typeof span;
}
interface Compiler extends LayergateCompiler {
  run(done: (error: Error | null, stats?: Stats) => void): void;
  watch(
    options: WatchOptions,
    done: (error: Error | null, stats?: Stats) => void
  ): { close(done: () => void): void };
  close(done: () => void): void;
}
type Webpack = (config: Config) => Compiler & {
  webpack: {
    NormalModule: {
      getCompilationHooks(compilation: Compilation): {
        loader: {
          tap(name: string, run: (context: LoaderContext) => void): void;
        };
      };
    };
  };
  hooks: {
    compilation: {
      tap(name: string, run: (compilation: Compilation) => void): void;
    };
  };
};

/** What Next's profiling plugin gives each loader: a trace span. */
const span = {
  traceChild: () => span,
  traceFn: <T>(run: () => T) => run(),
  traceAsyncFn: <T>(run: () => T) => run(),
  setAttribute: () => {},
  stop: () => {},
};

const nextWebpack = (() => {
  // SAFETY: Next's compiled webpack module: `init` (Next 15) then `webpack`.
  const compiled = requireCjs(
    join(NEXT, 'dist/compiled/webpack/webpack.js')
  ) as {
    init?: () => void;
    webpack: Webpack;
  };
  compiled.init?.();
  return compiled.webpack;
})();

// webpack loads loaders from disk, and cannot load the TS source: the shim
// hands each call to the loader this test imported.
const LOADER_KEY = '__LAYERGATE_TEST_LOADER__';
Reflect.set(globalThis, LOADER_KEY, layergateLoader);

// By realpath: the bundle is required, and Node keys its cache so.
const root = realpathSync(mkdtempSync(join(tmpdir(), 'layergate-webpack-')));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const files = {
  'package.json': '{"name":"app","private":true}',
  'shim.cjs': `module.exports = function () { return globalThis[${JSON.stringify(LOADER_KEY)}].apply(this, arguments); };`,
  'node_modules/owned/package.json': '{"name":"owned","version":"1.0.0"}',
  'node_modules/owned/a.css':
    '@import "./nested.css" layer(inner);\n.owned-a{color:red}\n',
  'node_modules/owned/nested.css': '.owned-nested{color:red}\n',
  'node_modules/owned/declared.css': '.declared{color:red}\n',
  'node_modules/owned/remote.css':
    '@import url("https://example.com/r.css");\n.remote{color:red}\n',
  'app/declarer.css': '.declarer{color:red}\n',
  'app/app.css': '@import "owned/a.css" layer(app);\n.app-own{color:red}\n',
  'app/plain.css': '.plain{color:red}\n',
  // ICSS exports only: Next's css-loader names local classes only with
  // the getLocalIdent Next passes it.
  'node_modules/owned/button.module.css': ':export{accent:red}\n',
  'node_modules/owned/sheet.icss.css':
    ':export{tone:blue}\n.icss-rule{color:red}\n',
  'app/link/img.png': 'image beside the link',
  'elsewhere/root.css': '.linked-root{background:url(./img.png)}\n',
  'node_modules/owned/wraps.css':
    '@import "../../app/declarer.css";\n@import "animus-styles";\n.wraps{color:red}\n',
  'node_modules/owned/warm.css': '.warm{color:red}\n',
  'node_modules/linked/package.json': '{"name":"linked","version":"1.0.0"}',
  'node_modules/linked/root.css': '@import "./child.css";\n',
  'node_modules/linked/img.png': 'vendor image',
  'elsewhere/child.css': '.child{background:url(./img.png)}\n',
  'elsewhere/img.png': 'app image',
} satisfies Record<string, string>;
// Older than webpack's timestamp accuracy, so a watcher's first scan finds
// nothing changed.
const past = new Date(Date.now() - 3_600_000);
for (const [path, text] of Object.entries(files)) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
  utimesSync(join(root, path), past, past);
}
// A package file that is a symlink to a file elsewhere, beside another
// image: webpack with `resolve.symlinks: false` reads it where it lies.
symlinkSync(
  join(root, 'elsewhere/child.css'),
  join(root, 'node_modules/linked/child.css')
);
symlinkSync(join(root, 'elsewhere/root.css'), join(root, 'app/link/root.css'));

/** A compiler whose entry exports each stylesheet's CSS text by name, or
 *  runs the given module source. */
function compiler(
  sheets: Record<string, string> | string,
  output: string,
  variant: Variant = {}
): Compiler {
  const entry = join(root, `${output}.mjs`);
  writeFileSync(
    entry,
    Object.prototype.toString.call(sheets) === '[object String]'
      ? String(sheets)
      : Object.entries(sheets)
          .map(
            ([name, request], index) =>
              `import s${index} from ${JSON.stringify(request)};\nexport const ${name} = String(s${index});\n`
          )
          .join('')
  );
  utimesSync(entry, past, past);
  const plugin = new LayergatePlugin({
    sheets: variant.sheets ?? ['owned/declared.css'],
    dependencies: ['owned', 'linked'],
    declaredBy: join(root, 'app/declarer.css'),
  });
  const webpack = nextWebpack({
    mode: 'development',
    devtool: false,
    context: root,
    entry,
    target: 'node',
    output: {
      path: join(root, 'dist'),
      filename: `${output}.cjs`,
      library: { type: 'commonjs2' },
      assetModuleFilename: '[path][name][ext]',
      publicPath: '',
    },
    module: {
      rules: [
        {
          test: /\.css$/,
          use: [
            {
              loader: CSS_LOADER,
              options: {
                postcss: async () => ({ postcss }),
                modules: variant.modules ? variant.modules.value : false,
              },
            },
          ],
        },
        { test: /\.png$/, type: 'asset/resource' },
      ],
    },
    resolve: {
      symlinks: variant.symlinks ?? true,
      alias: variant.alias ?? {},
    },
    // A module cache, as in Next's builds: a module whose snapshot holds
    // is not built again.
    cache: variant.cacheDirectory
      ? { type: 'filesystem', cacheDirectory: variant.cacheDirectory }
      : { type: 'memory' },
    // As Next sets it: every `node_modules` file changes only with its
    // package's version.
    snapshot: { managedPaths: [/^(.+?[\\/]node_modules[\\/])/] },
    plugins: variant.plugin === false ? [] : [plugin],
  });
  webpack.hooks.compilation.tap('trace', (compilation) => {
    webpack.webpack.NormalModule.getCompilationHooks(compilation).loader.tap(
      'trace',
      (context) => {
        context.currentTraceSpan = span;
      }
    );
  });
  // The plugin inserted the loader's own path; tests run the shim instead.
  const swap = (rules: unknown[]) => {
    for (const rule of rules) {
      // SAFETY: the rules above; only the CSS one has a `use`.
      for (const use of (rule as { use?: { loader: string }[] }).use ?? []) {
        if (use.loader === loaderPath()) use.loader = join(root, 'shim.cjs');
      }
    }
  };
  swap(webpack.options.module.rules);
  return webpack;
}

/** The exported CSS text, without line breaks. */
function exported(output: string): Record<string, string> {
  const path = join(root, 'dist', `${output}.cjs`);
  delete requireCjs.cache[path];
  // SAFETY: the entry exports a string per stylesheet.
  const sheets = requireCjs(path) as Record<string, string>;
  return Object.fromEntries(
    Object.entries(sheets).map(([name, css]) => [name, css.replace(/\s+/g, '')])
  );
}

const run = (webpack: Compiler) =>
  new Promise<Stats>((done, fail) =>
    webpack.run((error, stats) => (error ? fail(error) : done(stats!)))
  );

/** Runs `webpack` once and closes it, storing a persistent cache. */
const runAndClose = async (webpack: Compiler) => {
  const stats = await run(webpack);
  await new Promise<void>((done) => webpack.close(done));
  return stats;
};

/** Watches until `edits` have each been made after a build, returning each
 *  build's exports. */
function watchThrough(
  webpack: Compiler,
  output: string,
  edits: (() => void)[]
): Promise<Record<string, string>[]> {
  const outputs: Record<string, string>[] = [];
  return new Promise((done, fail) => {
    const watching = webpack.watch({ aggregateTimeout: 20 }, (error, stats) => {
      if (error || stats?.hasErrors()) {
        watching.close(() => fail(error ?? new Error('compile failed')));
        return;
      }
      outputs.push(exported(output));
      const edit = edits.shift();
      if (edit) edit();
      else watching.close(() => done(outputs));
    });
  });
}

describe('layergate webpack adapter', () => {
  // Contract: the loader joins every CSS chain whose css-loader is
  // explicitly global (`modules: false`), just before PostCSS runs, and
  // raises css-loader's importLoaders by one on a copy; CSS Modules and
  // next/font chains are left alone, a chain whose css-loader decides per
  // file (`modules` unset or `auto`) and a Lightning CSS chain are left
  // alone and reported by their place, inserting twice
  // changes nothing, and no rule is added (Next drops its own CSS rules
  // when a top-level rule matches `.css`).
  test('wraps each global CSS chain and nothing else', () => {
    const entry = { loader: '/layergate-loader.js', options: { id: 'x' } };
    const cssOptions = { importLoaders: 1, url: true, modules: false };
    const global = {
      use: [
        '/next/mini-css-extract/loader.js',
        { loader: '/next/css-loader/src/index.js', options: cssOptions },
        { loader: '/next/postcss-loader/src/index.js', options: {} },
      ],
    };
    const sass = {
      use: [
        '/next/mini-css-extract/loader.js',
        {
          loader: '/next/css-loader/src/index.js',
          options: { importLoaders: 3, modules: false },
        },
        { loader: '/next/postcss-loader/src/index.js' },
        { loader: '/resolve-url-loader/index.js' },
        { loader: '/sass-loader/dist/cjs.js' },
      ],
    };
    const modules = {
      use: [
        {
          loader: '/css-loader/index.js',
          options: { modules: { mode: 'local' } },
        },
      ],
    };
    const font = {
      use: [
        { loader: '/next/css-loader/src/index.js' },
        { loader: '/next/next-font-loader/index.js' },
      ],
    };
    const auto = {
      use: [
        {
          loader: '/css-loader/index.js',
          options: { modules: { auto: () => true } },
        },
      ],
    };
    const unset = { use: [{ loader: '/css-loader/index.js' }] };
    const lightning = { use: [{ loader: '/lightningcss-loader/index.js' }] };
    const rules: unknown[] = [
      { oneOf: [modules, font, global, { rules: [sass] }, auto] },
      unset,
      lightning,
    ];
    const coverage = {
      wrapped: 2,
      skipped: [
        expect.stringMatching(
          /^module\.rules\[0\]\.oneOf\[4\] is not layered: its css-loader is not `modules: false`/
        ),
        expect.stringMatching(
          /^module\.rules\[1\] is not layered: its css-loader/
        ),
        expect.stringMatching(
          /^module\.rules\[2\] is not layered: it uses Lightning CSS/
        ),
      ],
    };

    expect(insertLoader(rules, entry)).toEqual(coverage);
    expect(rules).toHaveLength(3);
    expect(global.use).toEqual([
      '/next/mini-css-extract/loader.js',
      {
        loader: '/next/css-loader/src/index.js',
        options: { importLoaders: 2, url: true, modules: false },
      },
      { loader: '/next/postcss-loader/src/index.js', options: {} },
      entry,
    ]);
    expect(cssOptions.importLoaders).toBe(1);
    expect(
      sass.use.map((use) => (use instanceof Object ? use.loader : use))
    ).toEqual([
      '/next/mini-css-extract/loader.js',
      '/next/css-loader/src/index.js',
      '/next/postcss-loader/src/index.js',
      '/layergate-loader.js',
      '/resolve-url-loader/index.js',
      '/sass-loader/dist/cjs.js',
    ]);
    expect(sass.use[1]).toMatchObject({ options: { importLoaders: 4 } });
    expect(modules.use).toHaveLength(1);
    expect(font.use).toHaveLength(2);
    expect(auto.use).toHaveLength(1);
    expect(unset.use).toHaveLength(1);

    expect(insertLoader(rules, entry)).toEqual({ ...coverage, wrapped: 0 });
    expect(global.use).toHaveLength(4);
  });

  // Contract: through Next's css-loader, an owned graph arrives finished in
  // the layer with no `@import` left (Next's css-loader reads a `layer()`
  // condition as media); a declared sheet imported directly loads nothing,
  // since the `declaredBy` stylesheet delivers it at its head; an app sheet
  // reaching an owned file keeps its own rules unlayered, its import's
  // `layer()` kept as a block inside the quarantine layer; one reaching none is untouched.
  test('finishes owned graphs, delivers declared sheets once, keeps app rules', async () => {
    const stats = await run(
      compiler(
        {
          owned: 'owned/a.css',
          declared: 'owned/declared.css',
          declarer: './app/declarer.css',
          app: './app/app.css',
          plain: './app/plain.css',
        },
        'finish'
      )
    );
    expect(stats.toJson({ errors: true }).errors).toEqual([]);
    const css = exported('finish');

    expect(css.owned).not.toContain('@import');
    expect(css.owned).toBe(
      '@layervendor;@layervendor{@layerinner{.owned-nested{color:red}}}@layervendor{.owned-a{color:red}}'
    );
    expect(css.declared).toBe('');
    expect(css.declarer).toMatch(
      /^@layervendor;@layervendor\{\.declared\{color:red\}\}\.declarer\{color:red\}$/
    );
    expect(css.app).toBe(
      '@layervendor;@layervendor{@layerapp{@layerinner{.owned-nested{color:red}}}}@layervendor{@layerapp{.owned-a{color:red}}}.app-own{color:red}'
    );
    expect(css.plain).toBe('.plain{color:red}');
  });

  // Contract: a remote `@import` in an owned sheet fails the build, naming
  // the remedy: webpack cannot load it inside the layer, and an unlayered
  // copy would escape it.
  test('refuses a remote import in an owned sheet', async () => {
    const stats = await run(compiler({ remote: 'owned/remote.css' }, 'remote'));
    const errors = stats.toJson({ errors: true }).errors ?? [];
    expect(errors.map((error) => error.message).join('\n')).toMatch(
      /@import "https:\/\/example\.com\/r\.css" is remote.*vendor the sheet locally, or opt this file out.*\[layergate\.remote\]/
    );
  });

  // Contract: in watch mode, editing a file a finished stylesheet read
  // rebuilds that stylesheet, though webpack takes a file under
  // `node_modules` to change only with its package's version.
  test('rebuilds a finished stylesheet when an owned file it read changes', async () => {
    const outputs = await watchThrough(
      compiler({ owned: 'owned/a.css' }, 'watch'),
      'watch',
      [
        () =>
          writeFileSync(
            join(root, 'node_modules/owned/nested.css'),
            '.owned-nested{color:blue}\n'
          ),
      ]
    );
    expect(outputs[0]!.owned).toContain('.owned-nested{color:red}');
    expect(outputs[1]!.owned).toContain('.owned-nested{color:blue}');
  });

  // Contract: a persistent cache never serves a finished stylesheet built
  // before a file it read changed: a warm start finishes it again, and
  // later edits rebuild it.
  test('finishes owned stylesheets again on a warm start', async () => {
    const warm = join(root, 'node_modules/owned/warm.css');
    const cacheDirectory = join(root, 'cache-warm');
    await runAndClose(
      compiler({ warm: 'owned/warm.css' }, 'warm', { cacheDirectory })
    );
    expect(exported('warm').warm).toContain('.warm{color:red}');
    writeFileSync(warm, '.warm{color:blue}\n');
    const outputs = await watchThrough(
      compiler({ warm: 'owned/warm.css' }, 'warm', { cacheDirectory }),
      'warm',
      [() => writeFileSync(warm, '.warm{color:green}\n')]
    );
    expect(outputs[0]!.warm).toContain('.warm{color:blue}');
    expect(outputs[1]!.warm).toContain('.warm{color:green}');
  });

  // Contract: a chain whose css-loader decides per file whether a
  // stylesheet is a CSS Module is never touched, whatever decides it:
  // Next's own classifier (`modules` unset), a stateful /g RegExp, an
  // `auto` function (which css-loader may hand a query and fragment), or
  // `auto: false` beside an ICSS name. Owned stylesheets it builds come out
  // exactly as natively, exports included, and the chain is reported with
  // the remedy.
  test.each([
    ['unset', () => undefined],
    ['a /g RegExp', () => ({ auto: /\.module\.css$/g })],
    [
      'a function',
      () => ({
        auto: (path: string, query?: string, fragment?: string) =>
          /\.module\.css$/.test(path) && !query && !fragment,
      }),
    ],
    ['auto: false', () => ({ auto: false })],
  ])(
    'leaves a per-file css-loader chain alone: modules %s',
    async (name, modules) => {
      const entry =
        "import button from 'owned/button.module.css';\nimport sheet from 'owned/sheet.icss.css';\n" +
        'export const accent = String(button.locals?.accent);\nexport const tone = String(sheet.locals?.tone);\n' +
        'export const css = String(button) + String(sheet);\n';
      const output = `per-file-${name.replace(/\W+/g, '-')}`;
      const layered = await run(
        compiler(entry, output, { modules: { value: modules() } })
      );
      const withLayergate = exported(output);
      await run(
        compiler(entry, output, {
          modules: { value: modules() },
          plugin: false,
        })
      );
      expect(withLayergate).toEqual(exported(output));
      expect(withLayergate.css).not.toContain('@layer');
      const warnings = layered
        .toJson({ warnings: true })
        .warnings?.map((warning) => warning.message);
      expect(warnings).toContainEqual(
        expect.stringMatching(
          /^\[layergate\] module\.rules\[0\] is not layered: .*`modules: false`, or opt out \[layergate\.coverage\]$/
        )
      );
    }
  );

  // Contract: the declared sheets are read where webpack resolves them, so
  // a declared sheet that is a symlink rebases its `url()`s from the link
  // under `resolve.symlinks: false`, as css-loader would; it is still
  // declared and owned by realpath.
  test('delivers a symlinked declared sheet from where it lies', async () => {
    const stats = await run(
      compiler({ declarer: './app/declarer.css' }, 'declared-link', {
        symlinks: false,
        sheets: ['./app/link/root.css'],
      })
    );
    expect(stats.toJson({ errors: true }).errors).toEqual([]);
    expect(exported('declared-link').declarer).toBe(
      '@layervendor;@layervendor{.linked-root{background:url(app/link/img.png)}}.declarer{color:red}'
    );
    expect(readdirSync(join(root, 'dist/app/link'))).toEqual(['img.png']);
  });

  // Contract: the `declaredBy` stylesheet (Animus's own) is never layered
  // inside an owned graph, whether reached by path or through an alias:
  // its rules stay outside the quarantine layer, as an opted-out file's do.
  test("keeps the declaredBy stylesheet out of an owned graph's layer", async () => {
    await run(
      compiler({ wraps: 'owned/wraps.css' }, 'wraps', {
        alias: { 'animus-styles': join(root, 'app/declarer.css') },
      })
    );
    expect(exported('wraps').wraps).toBe(
      '@layervendor;.declarer{color:red}.declarer{color:red}@layervendor{.wraps{color:red}}'
    );
  });

  // Contract: two copies of the plugin's module in one process (its ESM
  // and CJS builds) register under different ids, so neither's plan
  // replaces the other's.
  test('keeps the plans of two module copies apart', async () => {
    vi.resetModules();
    const first = await import('../src/webpack');
    vi.resetModules();
    const second = await import('../src/webpack');
    const a = new first.LayergatePlugin({ layer: 'first' });
    const b = new second.LayergatePlugin({ layer: 'second' });
    expect(a.id).not.toBe(b.id);
    const { registry } = await import('../src/webpack-state');
    expect(registry().states.get(a.id)?.plan.layer).toBe('first');
    expect(registry().states.get(b.id)?.plan.layer).toBe('second');
  });

  // Contract: an owned stylesheet's `url()` reaches the file css-loader
  // would reach from where the stylesheet lies: with `resolve.symlinks:
  // false`, a symlinked file's image is the one beside the link, though
  // ownership is decided by realpath.
  test('rebases url() from where a stylesheet lies', async () => {
    const stats = await run(
      compiler({ linked: 'linked/root.css' }, 'linked', { symlinks: false })
    );
    expect(stats.toJson({ errors: true }).errors).toEqual([]);
    expect(exported('linked').linked).toContain(
      'url(node_modules/linked/img.png)'
    );
    expect(readdirSync(join(root, 'dist/node_modules/linked'))).toEqual([
      'img.png',
    ]);
  });
});
