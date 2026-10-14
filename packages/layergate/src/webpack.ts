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

/** css-loader's options that decide whether it reads a stylesheet as a
 *  CSS Module or an ICSS sheet. */
interface ModuleOptions {
  modules?: unknown;
  icss?: unknown;
}

/** The rules webpack's module options hold, as far as the plugin reads
 *  them. */
interface Rule {
  oneOf?: unknown;
  rules?: unknown;
  use?: unknown;
}

/** How many loader chains `insertLoader` wrapped, and why it left each
 *  chain it could not wrap, by the chain's place in the rules. */
export interface Coverage {
  wrapped: number;
  skipped: string[];
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

/** Whether css-loader with `options` reads every stylesheet as a CSS
 *  Module or ICSS sheet: `modules` true, a mode name, or an object
 *  without `auto`; or `icss: true`. */
function allModules({ modules, icss }: ModuleOptions): boolean {
  if (icss === true || modules === true) return true;
  if (Object.prototype.toString.call(modules) === '[object String]') {
    return true;
  }
  return (
    modules instanceof Object &&
    !(modules instanceof Function) &&
    !('auto' in modules && modules.auto !== undefined)
  );
}

/**
 * Inserts `entry` into every loader chain of `rules` whose css-loader is
 * explicitly global (`modules: false`, as Next's global chains are): just
 * before PostCSS runs (after it in `use`), or before css-loader without
 * PostCSS. A chain whose css-loader decides per file whether a stylesheet
 * is a CSS Module (`modules` unset or `auto`) is left alone, and reported:
 * layergate never predicts that decision.
 */
export function insertLoader(
  rules: unknown[],
  entry: LoaderEntry,
  prefix = 'module.rules'
): Coverage {
  const coverage: Coverage = { wrapped: 0, skipped: [] };
  for (const [index, candidate] of rules.entries()) {
    if (!(candidate instanceof Object)) continue;
    // SAFETY: a webpack rule object; only these keys are read.
    const rule = candidate as Rule;
    const place = `${prefix}[${index}]`;
    for (const [key, nested] of [
      ['oneOf', rule.oneOf],
      ['rules', rule.rules],
    ] as const) {
      if (!Array.isArray(nested)) continue;
      const counts = insertLoader(nested, entry, `${place}.${key}`);
      coverage.wrapped += counts.wrapped;
      coverage.skipped.push(...counts.skipped);
    }
    if (!Array.isArray(rule.use)) continue;
    // SAFETY: an array `use` lists loader strings or objects.
    const use = rule.use as UseEntry[];
    const loaders = use.map(loaderOf);
    if (loaders.includes(entry.loader)) continue;
    if (loaders.some((loader) => NEXT_FONT_LOADER.test(loader))) continue;
    const css = loaders.findIndex((loader) => CSS_LOADER.test(loader));
    if (css === -1) {
      if (loaders.some((loader) => LIGHTNINGCSS_LOADER.test(loader))) {
        coverage.skipped.push(
          `${place} is not layered: it uses Lightning CSS, not css-loader`
        );
      }
      continue;
    }
    const cssEntry = use[css]!;
    // SAFETY: css-loader's options object, read for three keys.
    const options = (
      cssEntry instanceof Object ? (cssEntry.options ?? {}) : {}
    ) as ModuleOptions & { importLoaders?: number };
    if (allModules(options)) continue;
    if (options.modules !== false) {
      coverage.skipped.push(
        `${place} is not layered: its css-loader is not \`modules: false\`. Give global CSS a rule with \`modules: false\`, or opt out`
      );
      continue;
    }
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

/** What `specifier` resolves to from `context`, as webpack resolves it
 *  (by realpath unless `resolve.symlinks` is false), or null. */
const resolveOne = (resolver: Resolver, context: string, specifier: string) =>
  new Promise<string | null>((done) =>
    resolver.resolve({}, context, specifier, {}, (error, result) =>
      done(error || !result ? null : slashes(result))
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
      roots: [],
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
    const { wrapped, skipped } = insertLoader(compiler.options.module.rules, {
      loader: loaderPath(),
      options: { id: this.id },
    });
    compiler.hooks.thisCompilation.tap(NAME, (compilation) => {
      for (const reason of skipped) {
        compilation.warnings.push(
          new Error(`[layergate] ${reason} [layergate.coverage]`)
        );
      }
      if (wrapped === 0 && skipped.length === 0 && this.state.owner.owning()) {
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
      // Read where webpack resolves them; owned, opted out and compared by
      // realpath.
      this.state.roots = declared;
      this.state.owner.reset(compiler.context, declared.map(real));
      this.state.optedOut = new Set(optedOut.map(real));
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
