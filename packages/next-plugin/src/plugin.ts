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

type WatchIgnoreEntry = string | RegExp;

type WatchIgnoreMatcher = (path: string) => boolean;

type WatchIgnored =
  | WatchIgnoreEntry
  | WatchIgnoreEntry[]
  | WatchIgnoreMatcher
  | null
  | undefined;

/** The value arrives from a consumer's `next.config`, so the union above is a
 *  model of what webpack accepts, not a proof about the value in hand. */
const isWatchIgnoreString = (ignored: WatchIgnored): ignored is string =>
  Object.prototype.toString.call(ignored) === '[object String]';

const isWatchIgnoreMatcher = (
  ignored: WatchIgnored
): ignored is WatchIgnoreMatcher =>
  Object.prototype.toString.call(ignored) === '[object Function]';

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
  fileDependencies: { add(path: string): void };
  missingDependencies: { add(path: string): void };
  contextDependencies: { add(path: string): void };
  getAsset(name: string): { source: WebpackSource } | undefined;
  updateAsset(name: string, newSource: WebpackSource): void;
};

type CandidateModule = {
  loaders?: Array<{ loader?: string }>;
};

type NeedBuildCallback = (err?: Error | null, result?: boolean) => void;

type NeedBuildContext = Record<never, never>;

type CompilationIdentity = Record<never, never>;

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
    /** Read from the compiler instance, never a top-level webpack import —
     *  Next ships its own compiled webpack. */
    NormalModule?: {
      getCompilationHooks?: (
        compilation: CompilationIdentity
      ) => NormalModuleCompilationHooks;
    };
  };
};

const UNSUPPORTED_WEBPACK_MESSAGE =
  '[animus-extract] Unsupported webpack: NormalModule.getCompilationHooks(compilation).needBuild ' +
  'is required for dev transform coherence and this webpack does not expose it. ' +
  'Use a Next.js version whose webpack exposes this hook.';

const PLUGIN_NAME = 'AnimusWebpackPlugin';

export class AnimusWebpackPlugin {
  private options: AnimusNextOptions;
  private session: ExtractionSession;
  private initialized = false;
  private aliasesExtracted = false;
  private readonly animusLoaderPaths: Set<string>;
  private lastBuiltEpoch: string | null = null;
  private epochMovedForNextCompilation = false;

  constructor(options: AnimusNextOptions) {
    this.options = options;
    assertNoRetiredEngineSelection(options.engine);
    setSharedEngine(options.engine ?? 'v2');
    this.session = new ExtractionSession(options);
    this.animusLoaderPaths = new Set([resolveAnimusLoaderPath()]);
    if (options.loaderPath) {
      this.animusLoaderPaths.add(options.loaderPath);
    }
  }

  private moduleUsesAnimusLoader(module: CandidateModule): boolean {
    const loaders = module?.loaders;
    if (!Array.isArray(loaders)) return false;
    return loaders.some(
      (entry) =>
        entry?.loader !== undefined && this.animusLoaderPaths.has(entry.loader)
    );
  }

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
  }

  private extractAliases(compiler: Compiler): void {
    if (this.aliasesExtracted) return;
    this.aliasesExtracted = true;
    const rootDir = compiler.context;
    const rawAlias = compiler.options?.resolve?.alias;
    if (rawAlias === undefined) return;
    // Webpack also admits an array `resolve.alias`; only the keyed map
    // carries the pattern→target pairs this harvest reads.
    if (Object.prototype.toString.call(rawAlias) !== '[object Object]') return;

    const pairs: Array<{ pattern: string; target: string }> = [];
    for (const [key, value] of Object.entries(rawAlias)) {
      if (value === false) continue;
      const target = Array.isArray(value) ? value.at(0) : value;
      if (target === undefined) continue;
      if (key === ANIMUS_CSS_MODULE_ID) continue;
      pairs.push({ pattern: key, target });
    }

    const built = buildPathAliasesJson(pairs, rootDir);
    if (built) {
      this.session.pathAliasesJson = built.json;
    }
  }

  apply(compiler: Compiler): void {
    // Edge compiler has no CSS dependencies.
    if (compiler.options?.name === 'edge-server') return;

    const NormalModule = compiler.webpack?.NormalModule;
    if (NormalModule?.getCompilationHooks === undefined) {
      throw new Error(UNSUPPORTED_WEBPACK_MESSAGE);
    }

    this.appendEpochWatchIgnore(compiler);

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

    compiler.hooks.compilation.tap(PLUGIN_NAME, (compilation: Compilation) => {
      const registerSystemDependencies = () => {
        for (const dep of this.session.systemDependencyPaths) {
          if (existsSync(dep)) compilation.fileDependencies.add(dep);
          else compilation.missingDependencies.add(dep);
        }
        for (const dep of this.session.assetDependencyPaths) {
          if (existsSync(dep)) compilation.fileDependencies.add(dep);
          else compilation.missingDependencies.add(dep);
        }
        for (const root of this.session.externalWatchRoots) {
          compilation.contextDependencies.add(root);
        }
      };
      registerSystemDependencies();

      const stage =
        compiler.webpack?.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL ?? -2000;
      const RawSource = compiler.webpack?.sources.RawSource;
      compilation.hooks.processAssets.tap({ name: PLUGIN_NAME, stage }, () => {
        // The pipeline (and any system reload) has run by now — re-register
        // so a refreshed dependency set reaches this compilation.
        registerSystemDependencies();

        const css = getSharedCss();
        if (!css || !RawSource) return;

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
          this.lastBuiltEpoch = getReplacementEpoch();
          return;
        }

        await this.session.handleWatchUpdate({
          modifiedFiles: _compiler.modifiedFiles,
          removedFiles: _compiler.removedFiles,
        });

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

  resetForHmr(): void {
    this.session.resetForHmr();
  }

  get sessionId(): string {
    return this.session.sessionId;
  }

  setRootDir(rootDir: string): void {
    this.session.rootDir = rootDir;
  }

  private warnedRootDivergence = false;

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

  get sessionDir(): string {
    return this.session.sessionDir;
  }

  getOptions(): AnimusNextOptions {
    return this.options;
  }

  getExternalPackageDirs(): string[] {
    return this.session.externalPackageDirs.length > 0
      ? this.session.externalPackageDirs
      : getSharedExternalDirs();
  }

  getExternalSourceEntries(): Map<string, string> {
    return this.session.externalSourceEntries.size > 0
      ? this.session.externalSourceEntries
      : getSharedExternalEntries();
  }
}
