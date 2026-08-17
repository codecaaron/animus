import {
  assertNoRetiredEngineSelection,
  buildPathAliasesJson,
} from '@animus-ui/extract/pipeline';
import {
  ANIMUS_CSS_MODULE_ID,
  ExtractionSession,
  getAnalysisStartedPromise,
  getReplacementEpoch,
  getSharedCss,
  getSharedExternalDirs,
  getSharedExternalEntries,
  replacementEpochPath,
  sessionArtifactDir,
  setAnalysisStartedPromise,
  setSharedEngine,
  stylesPath,
} from '@animus-ui/extract/session';
import { existsSync } from 'fs';

import { resolveAnimusLoaderPath } from './loader-path';

import type { AnimusNextOptions } from './types';

export { ANIMUS_CSS_MODULE_ID } from '@animus-ui/extract/session';

type WebpackSource = {
  source(): string | Buffer;
  size(): number;
};

/** A single watch-ignore pattern webpack 5 accepts. */
type WatchIgnoreEntry = string | RegExp;

/** The composed matcher form — what this plugin writes back when it has to
 *  wrap a user shape it cannot append to. */
type WatchIgnoreMatcher = (path: string) => boolean;

/** Every shape `watchOptions.ignored` reaches this plugin in. Mirrors the
 *  webpack-gauntlet harness's model of the same option (its own
 *  `WatchIgnored`), which is what drives the real webpack watcher in the
 *  gauntlet lanes — one vocabulary for one option. */
type WatchIgnored =
  | WatchIgnoreEntry
  | WatchIgnoreEntry[]
  | WatchIgnoreMatcher
  | null
  | undefined;

/** A string pattern, decided by representation tag rather than `typeof`: the
 *  option comes from a consumer's `next.config`, so the union above is a model
 *  of what webpack accepts, not a proof about the value in hand. */
const isWatchIgnoreString = (ignored: WatchIgnored): ignored is string =>
  Object.prototype.toString.call(ignored) === '[object String]';

/** The callable variant, distinguished by the same tag after the null, array,
 *  string, and RegExp variants are excluded (house precedent: the gauntlet
 *  harness's own watch-ignore composition). */
const isWatchIgnoreMatcher = (
  ignored: WatchIgnored
): ignored is WatchIgnoreMatcher =>
  Object.prototype.toString.call(ignored) === '[object Function]';

/** Webpack's keyed `resolve.alias` map: pattern → target path, a list of
 *  candidate targets, or `false` for a disabled alias. */
type WebpackAliasMap = Record<string, string | string[] | false>;

type Compilation = {
  hooks: {
    processAssets: {
      tap: (
        options: { name: string; stage: number },
        fn: (assets: Record<string, WebpackSource>) => void
      ) => void;
    };
  };
  /** Watch inputs webpack rebuilds per compilation (webpack 5 LazySet). */
  fileDependencies: { add(path: string): void };
  /** Currently-absent paths whose creation must trigger a rebuild. */
  missingDependencies: { add(path: string): void };
  /** Directory watch inputs (webpack 5 LazySet). External kit roots are
   *  registered here every compilation so UNIMPORTED creations still
   *  produce watch turns — webpack reports the DIRECTORY, and the
   *  session's root-dirty rewalk reconstructs the delta (openspec:
   *  external-source-watch-ingestion, design D3; probe E). */
  contextDependencies: { add(path: string): void };
  getAsset(name: string): { source: WebpackSource } | undefined;
  updateAsset(name: string, newSource: WebpackSource): void;
};

/** The slice of a webpack Module the needBuild predicate inspects. */
type CandidateModule = {
  loaders?: Array<{ loader?: string }>;
};

type NeedBuildCallback = (err?: Error | null, result?: boolean) => void;

/** The slice of webpack's needBuild build context this plugin inspects: none.
 *  The fan-out predicate is history-free (design D1) — it decides from the
 *  module's loader chain alone — so the slot is named, never read. Same
 *  spelling as the needBuild suite's own `NeedBuildContext`. */
type NeedBuildContext = Record<never, never>;

/** A webpack Compilation as `NormalModule.getCompilationHooks` uses it: an
 *  identity key into webpack's per-compilation hooks map. `thisCompilation`
 *  forwards its argument there and reads nothing from it, so this slot is
 *  named rather than modeled — the `compilation` hook's callback, which DOES
 *  read fields, is typed `Compilation` above. */
type CompilationIdentity = Record<never, never>;

/** NormalModule.getCompilationHooks(...) slice (webpack 5). */
type NormalModuleCompilationHooks = {
  needBuild?: {
    tapAsync: (
      name: string,
      fn: (
        module: CandidateModule,
        context: NeedBuildContext,
        callback: NeedBuildCallback
      ) => void
    ) => void;
  };
};

type Compiler = {
  hooks: {
    run: {
      tapPromise: (name: string, fn: (c: Compiler) => Promise<void>) => void;
    };
    watchRun: {
      tapPromise: (name: string, fn: (c: Compiler) => Promise<void>) => void;
    };
    compilation: {
      tap: (name: string, fn: (compilation: Compilation) => void) => void;
    };
    thisCompilation: {
      tap: (
        name: string,
        fn: (compilation: CompilationIdentity) => void
      ) => void;
    };
  };
  context: string;
  /** Present on watchRun compilers after the first compilation (webpack 5). */
  modifiedFiles?: ReadonlySet<string>;
  removedFiles?: ReadonlySet<string>;
  options?: {
    name?: string;
    resolve?: {
      alias?: WebpackAliasMap;
    };
    watchOptions?: {
      ignored?: WatchIgnored;
    };
  };
  webpack?: {
    Compilation: {
      PROCESS_ASSETS_STAGE_ADDITIONAL: number;
    };
    sources: {
      RawSource: new (source: string) => WebpackSource;
    };
    /** Obtained from the compiler instance at hook time — NEVER a top-level
     *  webpack import (Next ships its own compiled webpack). */
    NormalModule?: {
      getCompilationHooks?: (
        compilation: CompilationIdentity
      ) => NormalModuleCompilationHooks;
    };
  };
};

/** Loud unsupported-version failure (design D7): the coherence mechanism
 *  cannot exist without the per-compilation needBuild hook, so a webpack
 *  that lacks it fails immediately instead of serving stale transforms. */
const UNSUPPORTED_WEBPACK_MESSAGE =
  '[animus-extract] Unsupported webpack: NormalModule.getCompilationHooks(compilation).needBuild ' +
  'is required for dev transform coherence and this webpack does not expose it. ' +
  'Use a Next.js version covered by the animus webpack gauntlet.';

const PLUGIN_NAME = 'AnimusWebpackPlugin';

/**
 * Webpack adapter for the extraction pipeline. All pipeline logic lives in
 * the bundler-agnostic ExtractionSession — this class owns only the webpack
 * wiring: hook registration, cross-compiler analysis dedup, alias
 * harvesting from the compiler config, watch-event translation, and
 * in-memory CSS asset replacement.
 */
export class AnimusWebpackPlugin {
  private options: AnimusNextOptions;
  private session: ExtractionSession;
  private initialized = false;
  private aliasesExtracted = false;
  /** Loader paths counting as "the animus loader" in a module's chain —
   *  this package's own loader plus an optional harness override. */
  private readonly animusLoaderPaths: Set<string>;
  /** Epoch THIS compiler last proceeded with (set after every awaited
   *  watchRun transaction — including joined ones). Null until the
   *  initialization pipeline publishes. */
  private lastBuiltEpoch: string | null = null;
  /** Armed by watchRun when the transaction moved the epoch; captured and
   *  disarmed by the next compilation's needBuild wiring (design D1). */
  private epochMovedForNextCompilation = false;

  constructor(options: AnimusNextOptions) {
    this.options = options;
    // v2 is the only engine (openspec: retire-extract-v1). Reject a retired v1
    // selection loudly before publishing the shared choice. The option type no
    // longer admits 'v1', but the retirement check's own parameter is the wide
    // `string | undefined` precisely so a stale config or an ANIMUS_ENGINE=v1
    // override still reaches it at runtime — the declared option widens into
    // that contract on its own.
    assertNoRetiredEngineSelection(options.engine);
    setSharedEngine(options.engine ?? 'v2');
    this.session = new ExtractionSession(options);
    this.animusLoaderPaths = new Set([resolveAnimusLoaderPath()]);
    if (options.loaderPath) {
      this.animusLoaderPaths.add(options.loaderPath);
    }
  }

  /** True when the module's loader chain contains the animus loader — the
   *  needBuild fan-out predicate (design D1: no historical records; covers
   *  restored persistent-cache modules and raw passthroughs alike). */
  private moduleUsesAnimusLoader(module: CandidateModule): boolean {
    const loaders = module?.loaders;
    if (!Array.isArray(loaders)) return false;
    // A chain entry names its loader by resolved path (`CandidateModule`
    // above): presence of that path IS the decision, and the membership test
    // is what admits it — a non-path value cannot be in the set.
    return loaders.some(
      (entry) =>
        entry?.loader !== undefined && this.animusLoaderPaths.has(entry.loader)
    );
  }

  /** Append the exact epoch artifact path to `watchOptions.ignored`,
   *  preserving the user's shape (design D2: the artifact participates in
   *  module snapshots via addDependency but never triggers live watch
   *  turns — no echo compilations). Session identity is process-claimed,
   *  so every compiler's plugin instance derives the SAME session-scoped
   *  path here regardless of which instance ends up owning the pipeline.
   *  Derived from the ONE root (session.rootDir, set at config time by
   *  with-animus); compiler.context is the fallback for bare-apply
   *  harnesses — identical when compiler.context === cwd. */
  private appendEpochWatchIgnore(compiler: Compiler): void {
    const options = compiler.options;
    if (!options) return;
    const epochPath = replacementEpochPath(
      sessionArtifactDir(
        this.session.rootDir ?? compiler.context,
        this.session.sessionId
      )
    );
    options.watchOptions ??= {};
    const watchOptions = options.watchOptions;
    const ignored = watchOptions.ignored;
    if (ignored === undefined || ignored === null) {
      watchOptions.ignored = [epochPath];
    } else if (Array.isArray(ignored)) {
      if (!ignored.includes(epochPath)) ignored.push(epochPath);
    } else if (isWatchIgnoreString(ignored)) {
      watchOptions.ignored = [ignored, epochPath];
    } else if (ignored instanceof RegExp) {
      watchOptions.ignored = (path: string) =>
        path === epochPath || ignored.test(path);
    } else if (isWatchIgnoreMatcher(ignored)) {
      watchOptions.ignored = (path: string) =>
        path === epochPath || Boolean(ignored(path));
    }
    // Any other shape is left untouched: the epoch write is value-guarded,
    // so the worst case is one echo compilation per real epoch move.
  }

  /** Extract path aliases from webpack's resolve.alias config. Runs once per
   *  plugin instance — the resolve config is immutable after apply. */
  private extractAliases(compiler: Compiler): void {
    if (this.aliasesExtracted) return;
    this.aliasesExtracted = true;
    const rootDir = compiler.context;
    const rawAlias = compiler.options?.resolve?.alias;
    if (rawAlias === undefined) return;
    // Webpack also admits an ARRAY `resolve.alias` form; only the keyed map
    // (`WebpackAliasMap`) carries the pattern→target pairs this harvest reads,
    // so the keyed-object tag is the admission test — the array form yields no
    // pair either way.
    if (Object.prototype.toString.call(rawAlias) !== '[object Object]') return;

    const pairs: Array<{ pattern: string; target: string }> = [];
    for (const [key, value] of Object.entries(rawAlias)) {
      // `false` disables an alias, and an array alias contributes the FIRST
      // target webpack would try — an empty one names no target at all.
      if (value === false) continue;
      const target = Array.isArray(value) ? value.at(0) : value;
      if (target === undefined) continue;
      // Skip exactly the alias with-animus injected for the emitter's CSS
      // import — a consumer alias merely containing '.animus' must survive.
      if (key === ANIMUS_CSS_MODULE_ID) continue;
      pairs.push({ pattern: key, target });
    }

    const built = buildPathAliasesJson(pairs, rootDir);
    if (built) {
      this.session.pathAliasesJson = built.json;
    }
  }

  apply(compiler: Compiler): void {
    // Edge compiler has no CSS dependencies — skip entirely
    if (compiler.options?.name === 'edge-server') return;

    // Runtime existence check (design D7): required loader-coherence APIs
    // must exist or the plugin fails immediately — no efficacy probing. The
    // question is EXISTENCE, and the modeled webpack slice above spells an
    // absent hook API as an absent property.
    const NormalModule = compiler.webpack?.NormalModule;
    if (NormalModule?.getCompilationHooks === undefined) {
      throw new Error(UNSUPPORTED_WEBPACK_MESSAGE);
    }

    // The epoch artifact is a loader file dependency but never a live watch
    // trigger (design D2).
    this.appendEpochWatchIgnore(compiler);

    // needBuild fan-out (design D1): capture the per-compiler arm exactly
    // once per top-level compilation, then force every animus-loader-chain
    // module to rebuild within it.
    compiler.hooks.thisCompilation.tap(PLUGIN_NAME, (compilation) => {
      const epochMoved = this.epochMovedForNextCompilation;
      this.epochMovedForNextCompilation = false;
      const needBuild =
        NormalModule.getCompilationHooks!(compilation).needBuild;
      if (needBuild === undefined) {
        throw new Error(UNSUPPORTED_WEBPACK_MESSAGE);
      }
      needBuild.tapAsync(PLUGIN_NAME, (module, _context, callback) => {
        if (epochMoved && this.moduleUsesAnimusLoader(module)) {
          callback(null, true);
          return;
        }
        callback();
      });
    });

    // processAssets: inject shared CSS into the .animus/styles.css asset in-memory.
    // This fires per-compilation for every compiler, ensuring all get correct CSS
    // regardless of which instance ran the extraction pipeline.
    compiler.hooks.compilation.tap(PLUGIN_NAME, (compilation: Compilation) => {
      // Register the system's evaluated module-file set as watch inputs on
      // EVERY compilation (webpack rebuilds its dependency sets per
      // compilation; per-compiler, no process-global guard). Paths that do
      // not currently exist go into missingDependencies so deletion →
      // recreation still produces events. processAssets below re-adds the
      // refreshed set after a successful in-compilation system load.
      const registerSystemDependencies = () => {
        for (const dep of this.session.systemDependencyPaths) {
          if (existsSync(dep)) compilation.fileDependencies.add(dep);
          else compilation.missingDependencies.add(dep);
        }
        for (const dep of this.session.assetDependencyPaths) {
          if (existsSync(dep)) compilation.fileDependencies.add(dep);
          else compilation.missingDependencies.add(dep);
        }
        // Admitted external canonical roots become context dependencies
        // EVERY compilation (design D3): webpack does not watch unimported
        // files, so kit creations reach the watch pass only through the
        // directory registration.
        for (const root of this.session.externalWatchRoots) {
          compilation.contextDependencies.add(root);
        }
      };
      registerSystemDependencies();

      const stage =
        compiler.webpack?.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL ?? -2000;
      const RawSource = compiler.webpack?.sources.RawSource;
      compilation.hooks.processAssets.tap({ name: PLUGIN_NAME, stage }, () => {
        // The pipeline (and a possible geological reset) ran by now —
        // re-register so a refreshed dependency set reaches this
        // compilation's watch inputs too.
        registerSystemDependencies();

        const css = getSharedCss();
        if (!css || !RawSource) return;

        // Try absolute path first, then relative — asset name depends on
        // how webpack resolved the .animus/styles.css import (with-animus
        // aliases it to the session-scoped stylesheet).
        const rootDir = this.session.rootDir || compiler.context;
        const cssPath = stylesPath(
          sessionArtifactDir(rootDir, this.session.sessionId)
        );
        if (compilation.getAsset(cssPath)) {
          compilation.updateAsset(cssPath, new RawSource(css));
          return;
        }
        if (compilation.getAsset(ANIMUS_CSS_MODULE_ID)) {
          compilation.updateAsset(ANIMUS_CSS_MODULE_ID, new RawSource(css));
        }
      });
    });

    // Production build: run once
    compiler.hooks.run.tapPromise(PLUGIN_NAME, async (_compiler: Compiler) => {
      this.adoptCompilerContext(_compiler);
      this.extractAliases(_compiler);

      const existing = getAnalysisStartedPromise();
      if (existing) {
        await existing;
        return;
      }

      const promise = this.session.runFullPipeline();
      setAnalysisStartedPromise(promise);
      await promise;
    });

    // Dev watch: first run = full pipeline, subsequent = incremental
    compiler.hooks.watchRun.tapPromise(
      PLUGIN_NAME,
      async (_compiler: Compiler) => {
        this.adoptCompilerContext(_compiler);
        this.extractAliases(_compiler);

        if (!this.initialized) {
          const existing = getAnalysisStartedPromise();
          if (existing) {
            await existing;
          } else {
            const promise = this.session.runFullPipeline();
            setAnalysisStartedPromise(promise);
            await promise;
          }
          this.initialized = true;
          // Baseline only — initialization NEVER arms the fan-out: restart
          // coherence belongs to the persistent-cache epoch witness
          // (design D2), not a whole-graph rebuild on every cold start.
          this.lastBuiltEpoch = getReplacementEpoch();
          return;
        }

        // Incremental: detect changes and re-analyze if needed. The awaited
        // call is the single-flight transaction boundary — this compiler
        // either runs the analysis or joins the in-flight one (design D3).
        await this.session.handleWatchUpdate({
          modifiedFiles: _compiler.modifiedFiles,
          removedFiles: _compiler.removedFiles,
        });

        // Arm the fan-out when the epoch this compiler last proceeded with
        // is no longer current — whether this watchRun ran the transaction
        // or joined one that already published (design D1).
        const epoch = getReplacementEpoch();
        this.epochMovedForNextCompilation =
          this.lastBuiltEpoch !== null &&
          epoch !== null &&
          epoch !== this.lastBuiltEpoch;
        if (epoch !== null) {
          this.lastBuiltEpoch = epoch;
        }
      }
    );
  }

  /**
   * Reset analysis state for HMR geological reset.
   */
  resetForHmr(): void {
    this.session.resetForHmr();
  }

  /** Session identity (process-claimed) — with-animus derives the
   *  session-scoped alias/stub paths from it (design D2). */
  get sessionId(): string {
    return this.session.sessionId;
  }

  /** Set the project root at CONFIG time (with-animus) — the ONE root all
   *  session-path derivations use. The compiler hooks ADOPT
   *  compiler.context only when no root was published (bare-apply
   *  harnesses); they never overwrite this. */
  setRootDir(rootDir: string): void {
    this.session.rootDir = rootDir;
  }

  /** One warning per plugin instance for a context/root mismatch. */
  private warnedRootDivergence = false;

  /** The run/watchRun taps' root handling: adopt compiler.context when no
   *  config-time root exists; otherwise KEEP the configured root — every
   *  frozen config-time derivation (stub path, css alias target,
   *  virtual:animus/system-props target, watch-ignore) came from it, and a
   *  silent overwrite re-keys sessionDir so the pipeline publishes
   *  artifacts where none of those consumers look. A disagreement is
   *  surfaced loudly instead (with-animus derives the root from Next's own
   *  `dir`, which equals compiler.context in real Next runs — a mismatch
   *  means a custom-webpack setup wired the plugin differently). */
  private adoptCompilerContext(compiler: Compiler): void {
    const context = compiler.context;
    if (!this.session.rootDir) {
      this.session.rootDir = context;
      return;
    }
    if (
      context &&
      this.session.rootDir !== context &&
      !this.warnedRootDivergence
    ) {
      this.warnedRootDivergence = true;
      console.warn(
        `[animus-extract] compiler.context (${context}) differs from the ` +
          `configured project root (${this.session.rootDir}); keeping the ` +
          `configured root — run next against the app directory (or align ` +
          `your custom webpack context) so both agree`
      );
    }
  }

  /** This session's artifact directory, derived from the one root. */
  get sessionDir(): string {
    return this.session.sessionDir;
  }

  /** Expose options for the loader */
  getOptions(): AnimusNextOptions {
    return this.options;
  }

  /** Expose external package directories for webpack loader allowlisting.
   *  Falls back to shared globalThis state for non-owning compiler instances. */
  getExternalPackageDirs(): string[] {
    return this.session.externalPackageDirs.length > 0
      ? this.session.externalPackageDirs
      : getSharedExternalDirs();
  }

  /** Expose external package source entries for webpack resolve alias.
   *  Falls back to shared globalThis state for non-owning compiler instances. */
  getExternalSourceEntries(): Map<string, string> {
    return this.session.externalSourceEntries.size > 0
      ? this.session.externalSourceEntries
      : getSharedExternalEntries();
  }
}
