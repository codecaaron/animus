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
import { fileOf, ownership, real, resolveEach, slashes, Units } from './host';
import { resolvePlan } from './plan';
import { CSS_RESOLVE, loaderPath, registry } from './webpack-state';

import type { LayergateOptions } from './plan';
import type { WebpackState } from './webpack-state';

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

/** The loader entry the plugin inserts. */
export interface LoaderEntry {
  loader: string;
  options: { id: string };
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

/** What webpack hands `needBuild` besides the module; not read. */
interface NeedBuildContext {
  readonly compilation?: Compilation;
}

/** The compiler, as far as the plugin reads it. */
export interface Compiler {
  context: string;
  /** What changed since the last compile, in watch mode. */
  modifiedFiles?: ReadonlySet<string>;
  removedFiles?: ReadonlySet<string>;
  webpack: {
    NormalModule: {
      getCompilationHooks(compilation: Compilation): {
        needBuild: {
          tapAsync(
            name: string,
            run: (
              module: { resource?: string },
              context: NeedBuildContext,
              done: (error?: Error | null, rebuild?: boolean) => void
            ) => void
          ): void;
        };
      };
    };
  };
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
 * Inserts `entry` into every loader chain of `rules` with a non-module
 * css-loader: just before PostCSS runs (after it in `use`), or before
 * css-loader without PostCSS.
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
    // SAFETY: css-loader's options object, read for two keys.
    const options = (
      cssEntry instanceof Object ? (cssEntry.options ?? {}) : {}
    ) as { modules?: unknown; importLoaders?: number };
    if (options.modules) continue;
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
      entry,
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

let instances = 0;

export class LayergatePlugin {
  readonly id: string;
  private readonly state: WebpackState;
  private readonly watchIgnored: boolean;
  /** Bumped by each watch run that changes a file a finished stylesheet
   *  read. */
  private generation = 0;
  /** Each finished stylesheet a changed file was read into → the
   *  generation of that change: rebuilt, though webpack takes a file under
   *  `node_modules` to change only with its package's version. */
  private readonly staleSince = new Map<string, number>();
  /** Each module of a stale stylesheet → the generation it was rebuilt
   *  at. A stylesheet has several modules (Next's CSS extraction builds
   *  the loader chain as a module of its own), and each rebuilds once. */
  private readonly rebuilt = new WeakMap<object, number>();
  /** Each module resource → its file, by realpath. */
  private readonly files = new Map<string, string>();

  constructor(options: LayergateWebpackOptions = {}) {
    this.id = `layergate-${process.pid}-${instances++}`;
    this.watchIgnored = options.watchIgnored !== false;
    const plan = resolvePlan(options);
    this.state = {
      plan,
      owner: ownership(plan),
      optedOut: new Set(),
      declaredBy: options.declaredBy ? real(options.declaredBy) : null,
      units: new Units(),
    };
    registry().set(this.id, this.state);
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
      compiler.webpack.NormalModule.getCompilationHooks(
        compilation
      ).needBuild.tapAsync(NAME, (module, _context, done) => {
        done(null, this.rebuilds(module) || undefined);
      });
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
      this.invalidate([
        ...(compiler.modifiedFiles ?? []),
        ...(compiler.removedFiles ?? []),
      ]);
      await prepare();
    });
    compiler.hooks.shutdown.tap(NAME, () => registry().delete(this.id));
  }

  /** Whether `module` belongs to a stale finished stylesheet and has not
   *  been rebuilt since it went stale. */
  private rebuilds(module: { resource?: string }): boolean {
    if (this.staleSince.size === 0 || module.resource === undefined) {
      return false;
    }
    let file = this.files.get(module.resource);
    if (file === undefined) {
      file = fileOf(module.resource);
      this.files.set(module.resource, file);
    }
    const since = this.staleSince.get(file);
    if (since === undefined || (this.rebuilt.get(module) ?? -1) >= since) {
      return false;
    }
    this.rebuilt.set(module, this.generation);
    return true;
  }

  /** Forgets what the changed files fed and marks the finished
   *  stylesheets that read them for rebuilding. */
  private invalidate(changed: string[]): void {
    if (changed.length === 0) return;
    this.generation += 1;
    for (const path of changed) {
      for (const unit of this.state.units.changed(slashes(path))) {
        this.staleSince.set(unit, this.generation);
      }
    }
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
