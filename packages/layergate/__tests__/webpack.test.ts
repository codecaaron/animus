// @vitest-environment node
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
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
  errors: boolean;
}
interface Stats {
  hasErrors(): boolean;
  toJson(options: StatsOptions): { errors?: { message: string }[] };
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
  output: { path: string; filename: string; library: { type: 'commonjs2' } };
  module: {
    rules: {
      test: RegExp;
      use: { loader: string; options: CssLoaderOptions }[];
    }[];
  };
  snapshot: { managedPaths: RegExp[] };
  plugins: LayergatePlugin[];
}
interface CssLoaderOptions {
  postcss(): Promise<{ postcss: unknown }>;
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
  'shim.cjs': `module.exports = function (source) { return globalThis[${JSON.stringify(LOADER_KEY)}].call(this, source); };`,
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
} satisfies Record<string, string>;
// Older than webpack's timestamp accuracy, so a watcher's first scan finds
// nothing changed.
const past = new Date(Date.now() - 3_600_000);
for (const [path, text] of Object.entries(files)) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
  utimesSync(join(root, path), past, past);
}

/** A compiler whose entry exports each stylesheet's CSS text by name. */
function compiler(sheets: Record<string, string>, output: string): Compiler {
  const entry = join(root, `${output}.mjs`);
  writeFileSync(
    entry,
    Object.entries(sheets)
      .map(
        ([name, request], index) =>
          `import s${index} from ${JSON.stringify(request)};\nexport const ${name} = String(s${index});\n`
      )
      .join('')
  );
  utimesSync(entry, past, past);
  const plugin = new LayergatePlugin({
    sheets: ['owned/declared.css'],
    dependencies: ['owned'],
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
    },
    module: {
      rules: [
        {
          test: /\.css$/,
          use: [
            {
              loader: CSS_LOADER,
              options: { postcss: async () => ({ postcss }) },
            },
          ],
        },
      ],
    },
    // As Next sets it: every `node_modules` file changes only with its
    // package's version.
    snapshot: { managedPaths: [/^(.+?[\\/]node_modules[\\/])/] },
    plugins: [plugin],
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
      // SAFETY: the one rule above, whose `use` the plugin rewrote.
      for (const use of (rule as { use: { loader: string }[] }).use) {
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

describe('layergate webpack adapter', () => {
  // Contract: the loader joins every global CSS chain (one with a non-module
  // css-loader), just before PostCSS runs, and raises css-loader's
  // importLoaders by one on a copy; CSS Modules and next/font chains are
  // left alone, a Lightning CSS chain is counted uncovered, inserting twice
  // changes nothing, and no rule is added (Next drops its own CSS rules
  // when a top-level rule matches `.css`).
  test('wraps each global CSS chain and nothing else', () => {
    const entry = { loader: '/layergate-loader.js', options: { id: 'x' } };
    const cssOptions = { importLoaders: 1, url: true };
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
          options: { importLoaders: 3 },
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
    const lightning = { use: [{ loader: '/lightningcss-loader/index.js' }] };
    const rules: unknown[] = [
      { oneOf: [modules, font, global, { rules: [sass] }] },
      lightning,
    ];

    expect(insertLoader(rules, entry)).toEqual({ wrapped: 2, uncovered: 1 });
    expect(rules).toHaveLength(2);
    expect(global.use).toEqual([
      '/next/mini-css-extract/loader.js',
      {
        loader: '/next/css-loader/src/index.js',
        options: { importLoaders: 2, url: true },
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

    expect(insertLoader(rules, entry)).toEqual({ wrapped: 0, uncovered: 1 });
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
    const webpack = compiler({ owned: 'owned/a.css' }, 'watch');
    const outputs: string[] = [];
    let edited = false;
    await new Promise<void>((done, fail) => {
      const watching = webpack.watch(
        { aggregateTimeout: 20 },
        (error, stats) => {
          if (error || stats?.hasErrors()) {
            watching.close(() => fail(error ?? new Error('compile failed')));
            return;
          }
          outputs.push(exported('watch').owned!);
          if (!edited) {
            edited = true;
            writeFileSync(
              join(root, 'node_modules/owned/nested.css'),
              '.owned-nested{color:blue}\n'
            );
            return;
          }
          watching.close(done);
        }
      );
    });
    expect(outputs[0]).toContain('.owned-nested{color:red}');
    expect(outputs[1]).toContain('.owned-nested{color:blue}');
  });
});
