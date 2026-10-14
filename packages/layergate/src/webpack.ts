/**
 * The webpack adapter. The plugin inserts layergate's loader into every
 * existing global-CSS loader chain (one with a css-loader that is not a
 * CSS Modules one), so it runs on each stylesheet before PostCSS and
 * css-loader, imported ones too: css-loader's `importLoaders` is raised by
 * one, on a copy of its options. No rule is added. For an owned graph the
 * loader resolves and inlines every `@import` itself and returns finished
 * CSS with no local import, so css-loader has nothing left to resolve and
 * a `layer()` condition never reaches its import parser.
 */
import { ownership, real, resolveEach, slashes, Units } from './host';
import { resolvePlan } from './plan';
import {
  alwaysModules,
  CSS_RESOLVE,
  loaderPath,
  registry,
} from './webpack-state';

import type { LayergateOptions } from './plan';
import type { ModuleOptions, WebpackState } from './webpack-state';

export type { LayergateOptions } from './plan';

export interface LayergateWebpackOptions extends LayergateOptions {
  /** A stylesheet (a file path) whose head delivers the declared sheets,
   *  finished, in order; a module's own import of a declared sheet then
   *  loads nothing, so each arrives once. Without one, a declared sheet
   *  is owned wherever it is imported. */
  declaredBy?: string;
  /** Whether the plugin makes `watchOptions.ignored` (a RegExp or a
   *  function) watch the owned files it reads, those under node_modules
   *  too. A host that owns the watcher passes false and asks `watches`.
   *  Default true. */
  watchIgnored?: boolean;
}

/** A loader as a rule's `use` lists it. */
type UseEntry = string | { loader?: string; options?: unknown };

/** The loader entry the plugin inserts; each chain's copy also carries
 *  its css-loader's module options, so the loader leaves the stylesheets
 *  that css-loader reads as CSS Modules alone. */
export interface LoaderEntry {
  loader: string;
  options: { id: string } & ModuleOptions;
}

/** The rules webpack's module options hold, as far as the plugin reads
 *  them. */
interface Rule {
  oneOf?: unknown;
  rules?: unknown;
  use?: unknown;
}

/** How many loader chains `insertLoader` wrapped, and how many it could
 *  not: Lightning CSS chains, which have no css-loader. */
export interface Coverage {
  wrapped: number;
  uncovered: number;
}

/** What webpack's resolver is handed besides the request: nothing the
 *  plugin sets. */
type ResolveContext = Record<string, never>;

interface Resolver {
  resolve(
    context: ResolveContext,
    path: string,
    request: string,
    resolveContext: ResolveContext,
    callback: (error: Error | null, result?: string | false) => void
  ): void;
}

/** A compilation, as far as the plugin reads it. */
interface Compilation {
  warnings: Error[];
  errors: Error[];
}

/** The compiler, as far as the plugin reads it. */
export interface Compiler {
  context: string;
  /** What changed since the last compile, in watch mode. */
  modifiedFiles?: ReadonlySet<string>;
  removedFiles?: ReadonlySet<string>;
  options: {
    module: { rules: unknown[] };
    watchOptions?: { ignored?: unknown };
  };
  resolverFactory: {
    get(type: string, options: typeof CSS_RESOLVE): Resolver;
  };
  hooks: {
    beforeRun: {
      tapPromise(name: string, run: () => Promise<void>): void;
    };
    watchRun: {
      tapPromise(name: string, run: () => Promise<void>): void;
    };
    thisCompilation: {
      tap(name: string, run: (compilation: Compilation) => void): void;
    };
    shutdown: {
      tap(name: string, run: () => void): void;
    };
  };
}

const NAME = 'layergate';
const CSS_LOADER = /(?:^|[\\/])css-loader(?:[\\/]|$)/;
const POSTCSS_LOADER = /(?:^|[\\/])postcss-loader(?:[\\/]|$)/;
const LIGHTNINGCSS_LOADER = /lightningcss-loader/;
const NEXT_FONT_LOADER = /next-font/;

const loaderOf = (entry: UseEntry) =>
  entry instanceof Object ? (entry.loader ?? '') : entry;

/**
 * Inserts `entry` into every loader chain of `rules` whose css-loader does
 * not read every stylesheet as a CSS Module: just before PostCSS runs
 * (after it in `use`), or before css-loader without PostCSS.
 */
export function insertLoader(rules: unknown[], entry: LoaderEntry): Coverage {
  const coverage: Coverage = { wrapped: 0, uncovered: 0 };
  for (const candidate of rules) {
    if (!(candidate instanceof Object)) continue;
    // SAFETY: a webpack rule object; only these keys are read.
    const rule = candidate as Rule;
    for (const nested of [rule.oneOf, rule.rules]) {
      if (!Array.isArray(nested)) continue;
      const counts = insertLoader(nested, entry);
      coverage.wrapped += counts.wrapped;
      coverage.uncovered += counts.uncovered;
    }
    if (!Array.isArray(rule.use)) continue;
    // SAFETY: an array `use` lists loader strings or objects.
    const use = rule.use as UseEntry[];
    const loaders = use.map(loaderOf);
    if (loaders.includes(entry.loader)) continue;
    if (loaders.some((loader) => NEXT_FONT_LOADER.test(loader))) continue;
    const css = loaders.findIndex((loader) => CSS_LOADER.test(loader));
    if (css === -1) {
      if (loaders.some((loader) => LIGHTNINGCSS_LOADER.test(loader)))
        coverage.uncovered += 1;
      continue;
    }
    const cssEntry = use[css]!;
    // SAFETY: css-loader's options object, read for three keys.
    const options = (
      cssEntry instanceof Object ? (cssEntry.options ?? {}) : {}
    ) as ModuleOptions & { importLoaders?: number };
    if (alwaysModules(options)) continue;
    const postcss = loaders.findIndex((loader) => POSTCSS_LOADER.test(loader));
    const at = (postcss === -1 ? css : postcss) + 1;
    rule.use = [
      ...use.slice(0, css),
      {
        loader: loaderOf(cssEntry),
        options: {
          ...options,
          importLoaders: (options.importLoaders ?? 0) + 1,
        },
      },
      ...use.slice(css + 1, at),
      {
        loader: entry.loader,
        options: {
          ...entry.options,
          modules: options.modules,
          icss: options.icss,
        },
      },
      ...use.slice(at),
    ];
    coverage.wrapped += 1;
  }
  return coverage;
}

/** What `specifier` resolves to from `context`, by realpath, or null. */
const resolveOne = (resolver: Resolver, context: string, specifier: string) =>
  new Promise<string | null>((done) =>
    resolver.resolve({}, context, specifier, {}, (error, result) =>
      done(error || !result ? null : real(result))
    )
  );

export class LayergatePlugin {
  readonly id: string;
  private readonly state: WebpackState;
  private readonly watchIgnored: boolean;

  constructor(options: LayergateWebpackOptions = {}) {
    const shared = registry();
    this.id = `layergate-${process.pid}-${shared.made++}`;
    this.watchIgnored = options.watchIgnored !== false;
    const plan = resolvePlan(options);
    this.state = {
      plan,
      owner: ownership(plan),
      optedOut: new Set(),
      declaredBy: options.declaredBy ? real(options.declaredBy) : null,
      units: new Units(),
    };
    shared.states.set(this.id, this.state);
  }

  /** Whether `path` is a file a finished stylesheet read: one the watcher
   *  must see, wherever it lies. The watcher asks of every path it scans,
   *  so this reads no file system: webpack watches the resolved paths the
   *  loader reported. */
  watches(path: string): boolean {
    return this.state.units.reads(slashes(path));
  }

  apply(compiler: Compiler): void {
    const { wrapped, uncovered } = insertLoader(compiler.options.module.rules, {
      loader: loaderPath(),
      options: { id: this.id },
    });
    compiler.hooks.thisCompilation.tap(NAME, (compilation) => {
      if (uncovered > 0) {
        compilation.warnings.push(
          new Error(
            `[layergate] ${uncovered} CSS loader chain(s) use Lightning CSS, which has no css-loader for layergate to work with: their stylesheets are not layered [layergate.coverage]`
          )
        );
      } else if (wrapped === 0 && this.state.owner.owning()) {
        compilation.warnings.push(
          new Error(
            '[layergate] no CSS loader chain with a css-loader was found: nothing is layered [layergate.coverage]'
          )
        );
      }
    });
    if (this.watchIgnored) this.watchOwned(compiler);

    const prepare = async () => {
      // webpack gives a resolver its file system only once every plugin
      // has applied.
      const resolver = compiler.resolverFactory.get('normal', CSS_RESOLVE);
      const resolve = (specifier: string) =>
        resolveOne(resolver, compiler.context, specifier);
      const { sheets, optOut } = this.state.plan;
      const [declared, optedOut] = await Promise.all([
        resolveEach(sheets, 'sheets', compiler.context, resolve),
        resolveEach(optOut, 'optOut', compiler.context, resolve),
      ]);
      this.state.owner.reset(compiler.context, declared);
      this.state.optedOut = new Set(optedOut);
    };
    compiler.hooks.beforeRun.tapPromise(NAME, prepare);
    compiler.hooks.watchRun.tapPromise(NAME, async () => {
      // A finished stylesheet is never cached (the loader says so), so it
      // is finished again each compile; a changed file is read again.
      for (const path of compiler.modifiedFiles ?? []) {
        this.state.units.changed(slashes(path));
      }
      for (const path of compiler.removedFiles ?? []) {
        this.state.units.changed(slashes(path));
      }
      await prepare();
    });
    compiler.hooks.shutdown.tap(NAME, () => registry().states.delete(this.id));
  }

  /** Makes the host's `watchOptions.ignored` watch every file a finished
   *  stylesheet read. */
  private watchOwned(compiler: Compiler): void {
    const watchOptions = (compiler.options.watchOptions ??= {});
    const ignored = watchOptions.ignored;
    const ignores =
      ignored instanceof RegExp
        ? (path: string) => ignored.test(path)
        : ignored instanceof Function
          ? (path: string) => Boolean(ignored(path))
          : null;
    if (!ignores) return;
    watchOptions.ignored = (path: string) =>
      ignores(path) && !this.watches(path);
  }
}

export default LayergatePlugin;
