import {
  AnimusConfigError,
  assertSupportedEngine,
  buildPathAliasesJson,
  builtInAssetClassification,
  outputExclusion,
  webpackExtensionPolicy,
} from '@animus-ui/extract/pipeline';
import {
  ANIMUS_CSS_MODULE_ID,
  ExtractionSession,
  getAnalysisStartedPromise,
  getReplacementEpoch,
  getSharedCss,
  getSharedExternalDirs,
  getSharedExternalEntries,
  getSharedExternalSideEffects,
  replacementEpochPath,
  resetAnalysisStartedPromise,
  sessionArtifactDir,
  setAnalysisStartedPromise,
  stylesPath,
  TURBOPACK_SYSTEM_PROPS_ID,
} from '@animus-ui/extract/session';
import { existsSync } from 'fs';
import { dirname } from 'path';

import { resolveAnimusLoaderPath } from './loader-path';
import { sameDirectory } from './same-directory';
import { ignoredMatcher, withinDirectories } from './watch-ignored';

import type { AnimusNextOptions } from './types';
import type {
  WatchIgnored,
  WatchIgnoreMatcher,
  WatchOptions,
} from './watch-ignored';

export { ANIMUS_CSS_MODULE_ID } from '@animus-ui/extract/session';

type WebpackSource = {
  source(): string | Buffer;
  size(): number;
};

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

/** The compilation `thisCompilation` hands over: its identity keys the
 *  NormalModule hooks, and its errors fail that build. */
type OwnCompilation = CompilationIdentity & { errors: Error[] };

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
      tap: (name: string, fn: (compilation: OwnCompilation) => void) => void;
    };
    /** `compiler.close()` (webpack 5), and the end of a watch. */
    shutdown?: { tap: (name: string, fn: () => void) => void };
    watchClose?: { tap: (name: string, fn: () => void) => void };
  };
  context: string;
  /** webpack's resolvers; package discovery asks the normal one first. */
  resolverFactory?: {
    get(
      type: 'normal',
      options: { dependencyType: string }
    ): {
      resolve(
        context: Record<string, never>,
        path: string,
        request: string,
        resolveContext: Record<string, never>,
        callback: (error: Error | null, result?: string | false) => void
      ): void;
    };
  };
  /** Present on watchRun compilers after the first compilation (webpack 5). */
  modifiedFiles?: ReadonlySet<string>;
  removedFiles?: ReadonlySet<string>;
  options?: {
    name?: string;
    resolve?: {
      alias?: WebpackAliasMap;
      conditionNames?: string[];
      extensions?: string[];
      extensionAlias?: Record<string, string | string[]>;
      byDependency?: Record<
        string,
        | {
            extensions?: string[];
            extensionAlias?: Record<string, string | string[]>;
          }
        | undefined
      >;
    };
    watchOptions?: WatchOptions;
    /** Next resolves a production build's entries before it compiles, and
     *  keeps a function, which adds entries on demand, in development. */
    entry?: object;
  };
  webpack?: {
    version?: string;
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

/** A compiler whose resolved entries are none: it loads no module. */
function buildsNothing(compiler: Compiler): boolean {
  const entry = compiler.options?.entry;
  return (
    entry !== undefined &&
    !(entry instanceof Function) &&
    Object.keys(entry).length === 0
  );
}

/** Paths the Session's watch plan registers: files (and absent paths it
 *  waits for) by exact path, directories with everything under them. */
interface RegisteredWatch {
  files: ReadonlySet<string>;
  directories: (path: string) => boolean;
}

export class AnimusWebpackPlugin {
  private options: AnimusNextOptions;
  private session: ExtractionSession;
  private initialized = false;
  /** A compiler took this plugin. */
  private applied = false;
  /** Left its build: the next turn joins again and catches up, retried
   *  until it succeeds, never reusing the startup it already consumed. */
  private rejoining = false;
  private aliasesExtracted = false;
  private readonly animusLoaderPaths: Set<string>;
  private lastBuiltEpoch: string | null = null;
  private epochMovedForNextCompilation = false;
  /** This turn's rejected analysis. A rejection must fail the compilation,
   *  never `watchRun`: webpack stops watching after a failed `watchRun`. */
  private watchFailure: Error | null = null;
  /** What the Session's watch plan last registered: `watchIgnored` never
   *  ignores it. */
  private registered: RegisteredWatch = {
    files: new Set(),
    directories: () => false,
  };
  /** Other files the watcher must see, by the plugins that read them. */
  private readonly alsoWatched: ((path: string) => boolean)[] = [];
  /** The webpack config Next hands its watcher, when withAnimus made it. */
  private watchedConfig: { watchOptions?: WatchOptions } | undefined;

  /** `development` is `next dev`: an error-level diagnostic reports and the
   *  compilation keeps publishing, whatever the emission mode. */
  constructor(
    options: AnimusNextOptions,
    {
      development = false,
      build,
    }: { development?: boolean; build?: string } = {}
  ) {
    this.options = options;
    assertSupportedEngine(options.engine);
    // Every compiler of one `next build` joins the build its config wrapper
    // created; a plugin made alone is a build of its own.
    this.session = new ExtractionSession(options, { build });
    this.session.development = development;
    this.session.writesFontPreloadsModule = true;
    // Transforms import the virtual id, which the module factory resolves to
    // this session's system-props module: a transform a persistent cache
    // restores then binds to the current session, not the one that built it.
    this.session.delivery = {
      ...this.session.delivery,
      systemPropsModuleId: TURBOPACK_SYSTEM_PROPS_ID,
    };
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

  /** The webpack config whose watch options the host's watcher reads,
   *  rewritten when the plugin is applied. */
  watchConfig(config: { watchOptions?: WatchOptions }): void {
    this.watchedConfig = config;
  }

  /** Makes `watchIgnored` watch the paths `watches` names too: one matcher
   *  owns the host's watch options. */
  watchAlso(watches: (path: string) => boolean): void {
    this.alsoWatched.push(watches);
  }

  /**
   * `watchOptions.ignored` for the host's own `ignored`: this session's epoch
   * file stays ignored, and every file and directory the Session's watch plan
   * registers is watched, whatever the host ignores. Next ignores every
   * `node_modules` path, where an installed source kit and its system live.
   */
  watchIgnored(ignored: WatchIgnored, context?: string): WatchIgnoreMatcher {
    const hostIgnores = ignoredMatcher(ignored);
    // Its root can be set after this is installed: read when asked.
    let epochRoot: string | undefined;
    let epochPath: string | undefined;
    const epoch = () => {
      const root = this.session.rootDir ?? context;
      if (root !== epochRoot) {
        epochRoot = root;
        epochPath =
          root === undefined
            ? undefined
            : replacementEpochPath(
                sessionArtifactDir(root, this.session.sessionId)
              );
      }
      return epochPath;
    };
    return (path) => {
      if (path === epoch()) return true;
      if (
        this.registered.files.has(path) ||
        this.registered.directories(path)
      ) {
        return false;
      }
      return (
        hostIgnores(path) && !this.alsoWatched.some((watches) => watches(path))
      );
    };
  }

  /** Webpack's export conditions select the system's kit files as they
   *  select the bundle's; `...`, webpack's own defaults, names none. Its
   *  extension order and aliases are captured alongside. */
  private extractConditions(compiler: Compiler): void {
    const resolve = compiler.options?.resolve;
    const names = resolve?.conditionNames ?? [];
    this.session.conditions = names.filter((name) => name !== '...');
    // Package discovery asks webpack's own resolver first, as the bundle
    // resolves (spec §2.2 A4); the loader answers only a declared workspace
    // it cannot resolve.
    const resolverFactory = compiler.resolverFactory;
    if (resolverFactory !== undefined) {
      this.session.hostResolve = (specifier: string, importer?: string) =>
        new Promise<string | null>((done) => {
          resolverFactory
            .get('normal', { dependencyType: 'esm' })
            .resolve(
              {},
              importer === undefined ? compiler.context : dirname(importer),
              specifier,
              {},
              (error, result) => done(error !== null || !result ? null : result)
            );
        });
    }
    // webpack's rules are not modelled: a conditional rule may never apply,
    // so the built-in list answers (spec §2.2 A8).
    this.session.assetClassification = builtInAssetClassification(
      'hostOptionUnreadable',
      'next-webpack rules not modelled'
    );
    this.session.extensionPolicy = webpackExtensionPolicy(
      'next-webpack',
      resolve ?? {},
      compiler.webpack?.version
    );
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
    this.applied = true;
    // The compiler's end leaves the build, which retires with its last
    // compiler: withAnimus joins every compiler's plugin at config time.
    compiler.hooks.shutdown?.tap(PLUGIN_NAME, () => this.leave());
    compiler.hooks.watchClose?.tap(PLUGIN_NAME, () => this.leave());

    // Every compiler joins the build, the edge compiler too: it has no CSS
    // dependencies, but its loader transforms the middleware. In Next's
    // build worker each compiler runs in its own process, and under `next
    // dev` an edit to the middleware reaches only the edge compiler.
    this.joinOnRun(compiler);
    this.analyzeOnWatchRun(compiler);
    if (compiler.options?.name === 'edge-server') return;

    const NormalModule = compiler.webpack?.NormalModule;
    if (NormalModule?.getCompilationHooks === undefined) {
      throw new Error(UNSUPPORTED_WEBPACK_MESSAGE);
    }

    // Whichever watch options the host's watcher reads: the compiler's, or
    // the config Next passes it, validated by now, which Next freezes.
    const options = compiler.options;
    if (options) {
      options.watchOptions ??= {};
      options.watchOptions.ignored = this.watchIgnored(
        options.watchOptions.ignored,
        compiler.context
      );
    }
    if (this.watchedConfig) {
      this.watchedConfig.watchOptions = {
        ...this.watchedConfig.watchOptions,
        ignored: this.watchIgnored(
          this.watchedConfig.watchOptions?.ignored,
          compiler.context
        ),
      };
    }

    compiler.hooks.thisCompilation.tap(PLUGIN_NAME, (compilation) => {
      const epochMoved = this.epochMovedForNextCompilation;
      this.epochMovedForNextCompilation = false;
      if (this.watchFailure) compilation.errors.push(this.watchFailure);
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
      // The Session's watch plan, as webpack's dependency kinds: a path the
      // system load found absent reloads it when created.
      const registerSystemDependencies = () => {
        const plan = this.session.watchPlan();
        this.registered = {
          files: new Set([...plan.files, ...plan.missing]),
          directories: withinDirectories(plan.directories),
        };
        for (const path of plan.files) {
          if (existsSync(path)) compilation.fileDependencies.add(path);
          else compilation.missingDependencies.add(path);
        }
        for (const path of plan.missing) {
          compilation.missingDependencies.add(path);
        }
        for (const root of plan.directories) {
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

        // Before its root is known, the session has joined no build.
        const css = this.session.rootDir ? getSharedCss(this.session.key) : '';
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
  }

  /** Each watch turn analyzes what changed, or joins the build at first. */
  private analyzeOnWatchRun(compiler: Compiler): void {
    compiler.hooks.watchRun.tapPromise(
      PLUGIN_NAME,
      async (_compiler: Compiler) => {
        this.adoptCompilerContext(_compiler);
        this.extractAliases(_compiler);
        this.extractConditions(_compiler);
        try {
          await this.analyzeWatchTurn(_compiler);
          this.watchFailure = null;
        } catch (err) {
          this.watchFailure =
            err instanceof Error ? err : new Error(String(err));
        }
      }
    );
  }

  /** A run joins the build: it catches up with a build this compiler left,
   *  waits for the analysis another compiler started, or analyzes. */
  private joinOnRun(compiler: Compiler): void {
    compiler.hooks.run.tapPromise(PLUGIN_NAME, async (_compiler: Compiler) => {
      // Next's edge compiler in a build without middleware or edge routes:
      // in Next's build worker it would analyze for nothing.
      if (buildsNothing(_compiler)) return;
      this.adoptCompilerContext(_compiler);
      this.extractAliases(_compiler);
      this.extractConditions(_compiler);

      if (await this.rejoin()) {
        await this.session.agreeWithSystemAuthority();
        return;
      }
      const existing = getAnalysisStartedPromise(this.session.key);
      if (existing) {
        await existing;
        // Another compiler's conditions loaded the build's system.
        await this.session.agreeWithSystemAuthority();
        return;
      }

      const promise = this.session.runFullPipeline();
      setAnalysisStartedPromise(this.session.key, promise);
      await promise;
    });
  }

  /** Joins the build this compiler left and catches up with it: true when
   *  the build was live, false when it starts as at first. */
  private async rejoin(): Promise<boolean> {
    if (!this.rejoining) return false;
    this.session.reattach();
    const live = await this.session.catchUp();
    this.rejoining = false;
    return live;
  }

  /** Rejects with the analysis error; the published generation stays the
   *  last successful one. */
  private async analyzeWatchTurn(compiler: Compiler): Promise<void> {
    if (!this.initialized && (await this.rejoin())) {
      await this.session.agreeWithSystemAuthority();
      this.initialized = true;
      this.lastBuiltEpoch = getReplacementEpoch(this.session.key);
      // The build moved on while this compiler was away: rebuild them all.
      this.epochMovedForNextCompilation = true;
      return;
    }
    if (!this.initialized) {
      let startup = getAnalysisStartedPromise(this.session.key);
      if (!startup) {
        startup = this.session.runFullPipeline();
        setAnalysisStartedPromise(this.session.key, startup);
      }
      try {
        await startup;
      } catch (err) {
        // A rejected startup must not answer every later watchRun: the
        // next one re-runs it against the repaired sources.
        if (getAnalysisStartedPromise(this.session.key) === startup) {
          resetAnalysisStartedPromise(this.session.key);
        }
        throw err;
      }
      // Another compiler's conditions may have loaded the build's system.
      await this.session.agreeWithSystemAuthority();
      this.initialized = true;
      this.lastBuiltEpoch = getReplacementEpoch(this.session.key);
      // A failed startup's compilation passed every module through
      // untransformed: rebuild them all.
      this.epochMovedForNextCompilation = this.watchFailure !== null;
      return;
    }

    await this.session.handleWatchUpdate({
      modifiedFiles: compiler.modifiedFiles,
      removedFiles: compiler.removedFiles,
    });
    // A system reload under another compiler's conditions is checked again.
    await this.session.agreeWithSystemAuthority();

    const epoch = getReplacementEpoch(this.session.key);
    this.epochMovedForNextCompilation =
      this.lastBuiltEpoch !== null &&
      epoch !== null &&
      epoch !== this.lastBuiltEpoch;
    if (epoch !== null) {
      this.lastBuiltEpoch = epoch;
    }
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

  /** Joins this compiler's build now, at config time. Next creates every
   *  compiler's config before `next build` runs them one after another, so
   *  the build then lasts until the last of them leaves: a compiler that
   *  starts after another left takes its analysis, never another one. Call
   *  after `setRootDir`. */
  joinBuild(): void {
    this.session.joinBuild();
  }

  /** Leaves the build unless a compiler took this plugin. Next creates a
   *  config it never runs when an earlier compiler fails (the client after a
   *  server error), and its participant would keep that build live for the
   *  next `next build` in the process. */
  retireUnapplied(): void {
    if (!this.applied) this.leave();
  }

  /** Leaves the build, which retires with its last participant. A compiler
   *  that runs again analyzes in full: its build may have retired
   *  meanwhile. */
  private leave(): void {
    this.session.close();
    this.initialized = false;
    this.rejoining = true;
  }

  /** Keeps system loads across builds in `directory`, Next's own cache. */
  setCacheDir(directory: string): void {
    this.session.systemLoadCacheDir = directory;
  }

  /** Keeps Next's output directory out of discovery, whatever the user's
   *  exclude list says. Call after `setRootDir`. */
  excludeOutputDir(outDir: string): void {
    const pattern = outputExclusion(this.session.rootDir!, outDir);
    if (pattern !== null) this.session.structuralExclude = [pattern];
  }

  /** Adopts `compiler.context` only when no config-time root exists: every
   *  frozen derivation came from that root, so an overwrite re-keys it.
   *  Stub path, css alias, virtual system-props target and watch-ignore are
   *  all frozen from it, so a disagreement fails, never reconciled. */
  private adoptCompilerContext(compiler: Compiler): void {
    const context = compiler.context;
    if (!this.session.rootDir) {
      this.session.rootDir = context;
      return;
    }
    // A root override the plugin cannot honor fails (SA2): the analysis
    // would read one tree while webpack builds another.
    if (context && !sameDirectory(context, this.session.rootDir)) {
      throw new AnimusConfigError(
        `[animus-extract] compiler.context (${context}) differs from the ` +
          `configured project root (${this.session.rootDir}). Run next ` +
          `against the app directory, or align your custom webpack context, ` +
          `so both agree.`
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
      : getSharedExternalDirs(this.session.key);
  }

  /** An import webpack resolved while bundling, with the resolve options of
   *  the rules its importer matches (spec §2.2 A4). */
  reportHostResolution(
    importer: string,
    request: string,
    resolved: string
  ): void {
    this.session.reportHostResolution(importer, request, resolved);
  }

  getExternalSourceEntries(): Map<string, string> {
    return this.session.externalSourceEntries.size > 0
      ? this.session.externalSourceEntries
      : getSharedExternalEntries(this.session.key);
  }

  /** The classification of the entries `getExternalSourceEntries` returns,
   *  from the same source. */
  getExternalSourceSideEffects(): Map<string, boolean> {
    return this.session.externalSourceEntries.size > 0
      ? this.session.externalSourceSideEffects
      : getSharedExternalSideEffects(this.session.key);
  }
}
