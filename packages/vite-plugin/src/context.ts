import {
  buildSystemPropsModule,
  BUILT_IN_EXTENSION_POLICY,
  builtInAssetClassification,
  contentHash,
  DEFAULT_EXTENSIONS,
  DEFAULT_RUNTIME_IMPORT,
  findSheetAssetSpecifiers,
  isPathWithinRoot,
  parseFilesJson,
  resolveAssetFile,
  resolveVerbosity,
  runStructuralSelfCheck,
  substituteSheetAssets,
  writeAssetCopy,
  toWatchKeys,
} from '@animus-ui/extract/pipeline';
import {
  CoalescingWindow,
  createBuildId,
  engineFactory,
  engineHandle,
  ExtractionSession,
  releaseEngineHandle,
  sessionKey,
} from '@animus-ui/extract/session';
import { rmSync } from 'fs';
import { join } from 'path';

import {
  RESOLVED_COMPONENTS_ID,
  RESOLVED_CSS_ID,
  RESOLVED_SYSTEM_PROPS_ID,
  VIRTUAL_CSS_ID,
  VIRTUAL_SYSTEM_PROPS_ID,
} from './constants';
import { HotUpdateEvents } from './hot-update-events';

import type { LightningTargets } from './css';
import type { AnimusExtractOptions } from './index';
import type {
  AssetSheets,
  ExcludeMatcher,
  ExternalPackageOutcome,
  HostAssetClassification,
  HostExtensionPolicy,
  ProjectManifest,
  SystemConfig,
} from '@animus-ui/extract/pipeline';
import type {
  SessionKey,
  SessionOutcome,
  WatchChanges,
} from '@animus-ui/extract/session';
import type { Logger } from 'vite';

function emptySystemConfig(): SystemConfig {
  return {
    propConfigJson: '{}',
    groupRegistryJson: '{}',
    scalesJson: '{}',
    variableMapJson: '{}',
    variableCss: '',
    contextualVarsJson: '{}',
    selectorAliasesJson: null,
    globalStyleBlocksJson: null,
    keyframesJson: null,
  };
}

/** A Session outcome, and whether its publication changed the served
 *  system-props module. */
export interface ObservedOutcome {
  outcome: SessionOutcome;
  systemPropsChanged: boolean;
}

function generateSystemPropsModule(ctx: PluginContext): string {
  return buildSystemPropsModule({
    systemPropMapJson: ctx.storedSystemPropMapJson,
    groupRegistryJson: ctx.system.groupRegistryJson,
    dynamicProps: JSON.parse(ctx.storedDynamicPropsJson),
    admittedTransforms: JSON.parse(ctx.storedAdmittedTransformsJson),
    typedSystemProps: JSON.parse(ctx.storedTypedSystemPropsJson),
  });
}

/** Memoized on the inputs themselves, so no writer owes the memo a refresh
 *  and a stale memo cannot serve a module from a generation that is gone. */
const systemPropsModules = new WeakMap<
  PluginContext,
  { key: string; source: string }
>();

/** NUL cannot appear in JSON text, so concatenation is injective. */
function systemPropsModuleKey(ctx: PluginContext): string {
  return [
    ctx.storedSystemPropMapJson,
    ctx.system.groupRegistryJson,
    ctx.storedDynamicPropsJson,
    ctx.storedAdmittedTransformsJson,
    ctx.storedTypedSystemPropsJson,
  ].join('\u0000');
}

/** The exact source `virtual:animus/system-props` serves now — one definition,
 *  so the served bytes and the HMR change decision cannot diverge. */
export function systemPropsModuleSource(ctx: PluginContext): string {
  const key = systemPropsModuleKey(ctx);
  const memo = systemPropsModules.get(ctx);
  if (memo && memo.key === key) return memo.source;
  const source = generateSystemPropsModule(ctx);
  systemPropsModules.set(ctx, { key, source });
  return source;
}

const NO_SHEETS: AssetSheets = {
  variableCss: '',
  globalCss: '',
  componentCss: '',
};

export class PluginContext {
  readonly options: AnimusExtractOptions;
  readonly verbose: boolean;
  /** The higher tier: `verbose: 'trace'` or `ANIMUS_DEBUG=trace`. */
  readonly tracing: boolean;

  isProd = false;
  /** Serving or watching: an error-level diagnostic reports, and only a
   *  one-shot build fails on one. */
  development = false;
  /** Emission mode (the explicit `mode` option wins over the command); feeds
   *  engine devMode and the minify default. Lifecycle stays on `isProd`. */
  emissionProd = false;
  rootDir = '';
  logger: Logger | null = null;

  system: SystemConfig = emptySystemConfig();
  lcssTargets: LightningTargets = {};

  pathAliasesJson: string | null = null;

  /** Vite's export conditions, so the loader reads the files Vite serves. */
  resolveConditions: string[] = [];
  /** Vite's resolved extension order; the built-in policy until
   *  `configResolved`. */
  extensionPolicy: HostExtensionPolicy = BUILT_IN_EXTENSION_POLICY;
  /** Vite's asset classification, captured at `configResolved`. */
  assetClassification: HostAssetClassification =
    builtInAssetClassification('noHost');

  extensionsSet: ReadonlySet<string>;

  /** Built once per buildStart, before any discovery, from the user's
   *  exclude list and the output directory. */
  excludeMatcher!: ExcludeMatcher;

  /** Vite's output directory as a structural exclusion; null outside the
   *  root. Set in `configResolved`. */
  outputExclude: string | null = null;

  // `null` means no analysis has published yet; a failed analysis leaves the
  // previous manifest current instead of clearing it.
  storedManifest: ProjectManifest | null = null;
  storedManifestJson = '';

  /** The analysis sheets with their asset() placeholders. They are read
   *  through `globalCss` and `resolvedComponentCss`, which substitute the
   *  current asset URLs, so an edited asset changes its URL without
   *  re-analysis. */
  private analysisGlobalCss = '';
  private analysisComponentCss = '';

  get globalCss(): string {
    return this.substitutedSheets().globalCss;
  }

  set globalCss(css: string) {
    this.analysisGlobalCss = css;
  }

  get resolvedComponentCss(): string {
    return this.substitutedSheets().componentCss;
  }

  set resolvedComponentCss(css: string) {
    this.analysisComponentCss = css;
  }

  private substitutedSheets(): ReturnType<typeof substituteSheetAssets> {
    return substituteSheetAssets(
      {
        ...NO_SHEETS,
        globalCss: this.analysisGlobalCss,
        componentCss: this.analysisComponentCss,
      },
      this.assetUrlBySpecifier
    );
  }

  layerDeclaration = '';

  transformOutputHashes = new Map<string, string>();

  recordTransformOutput(relativePath: string, code: string): void {
    this.transformOutputHashes.set(relativePath, contentHash(code));
  }

  reverseProvenance: Record<string, string[]> = {};

  storedSystemPropMapJson = '{}';
  storedDynamicPropsJson = '{}';
  storedAdmittedTransformsJson = '{}';
  storedTypedSystemPropsJson = '[]';

  rawExtensionFallbacks = new Set<string>();

  /** Original path → hash of bytes whose parse aborted in a rejected attempt;
   *  non-empty while that rejection holds publication. Those bytes are served
   *  raw so the host reports its own syntax error instead of receiving the
   *  previous module from the retained engine. */
  readonly abortedParseHashes = new Map<string, string>();

  /** The one mutator of a file's fallback state — every raw-serve exit of the
   *  transform hook reports here, except aborted bytes, which never execute.
   *  Production keeps the set empty. The
   *  barrier's one-shot withhold release must not route through here: it
   *  retires other files' records, no claim about their current serve. */
  recordFallbackState(relativePath: string, isFallback: boolean): void {
    if (this.isProd) return;
    if (isFallback) this.rawExtensionFallbacks.add(relativePath);
    else this.rawExtensionFallbacks.delete(relativePath);
  }

  readonly hotUpdateEvents = new HotUpdateEvents();

  /** Coalesces a burst of invalidations into one full reload. */
  private readonly reloadWindow = new CoalescingWindow(() => {
    this.devServer?.hot?.send({ type: 'full-reload' });
  });

  base = '/';

  // specifier → dev /@fs URL, or the `__VITE_ASSET__<referenceId>__` marker
  // Vite rewrites to the hashed file name before hashing the stylesheet.
  assetUrlBySpecifier = new Map<string, string>();

  /** Where dev asset() copies live, immutable and content-named; null in a
   *  build, or when the dev server does not serve the directory, which
   *  serves the live files instead. Set in `configResolved`. */
  assetCopyDir: string | null = null;
  /** specifier → the source file its dev copy was made from. */
  assetSourceBySpecifier = new Map<string, string>();
  /** source → its copies, oldest first: the current and the previous. */
  private assetCopyHistory = new Map<string, string[]>();
  /** Specifiers whose copy the dev server does not serve, warned once. */
  private unservedAssetCopies = new Set<string>();
  /** Whether the dev server serves `path`, by Vite's `server.fs` rule;
   *  set in `configResolved`. */
  servesFile: (path: string) => boolean = () => true;

  assetResolutionFailures = new Set<string>();

  assetPassComplete = false;

  externalPackageDirs: string[] = [];
  /** specifier → whether its redirected source entry has side effects, from
   *  the owning package's `sideEffects`; absent leaves Vite's default. */
  externalSourceSideEffects = new Map<string, boolean>();

  externalSourceEntries: ReadonlyMap<string, string> = new Map();

  externalPackageOutcomes: ExternalPackageOutcome[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  devServer: any;

  /** The Session's path lists already registered with Vite's watcher; the
   *  Session replaces a list when it changes. */
  private readonly watchedPathLists = new WeakSet<readonly string[]>();

  // Per-plugin-instance engine state: two differently-configured plugins in
  // one process must not share an engine.

  /** Every native extraction call goes through this one accessor. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly engineApi: () => any;
  /** The native module's stateless lookups, before the root resolves: the
   *  shared factory, which registers no handle. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly kitEngine: () => any = engineFactory;
  private engineKey: SessionKey | null = null;
  /** This context's build: one Vite config instance, one build. */
  readonly build = createBuildId();
  /** The build's Session, created once the Vite root resolves. */
  session: ExtractionSession | null = null;
  /** The outcomes each in-flight `submitChanges` collects. */
  private readonly outcomeCollectors = new Set<ObservedOutcome[]>();

  constructor(
    options: AnimusExtractOptions,
    // Test seam: `vi.mock` is a no-op in this repo's setup, so behavioral
    // tests inject a canned engine instead of loading the NAPI binary.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    engineApiOverride?: () => any
  ) {
    this.options = options;
    const verbosity = resolveVerbosity(
      options.verbose,
      process.env.ANIMUS_DEBUG
    );
    this.verbose = verbosity !== 'quiet';
    this.tracing = verbosity === 'trace';
    this.extensionsSet = new Set(options.extensions ?? DEFAULT_EXTENSIONS);

    if (engineApiOverride) {
      this.engineApi = engineApiOverride;
      this.kitEngine = engineApiOverride;
      return;
    }
    // This context is one build: its engine state is its own in the one
    // engine-handle store, keyed once the root is resolved and released
    // when the context closes.
    const build = this.build;
    const rehydrateFilesJson = (filesJsonRaw: string): string => {
      if (!filesJsonRaw.includes('"source":""')) return filesJsonRaw;
      const entries = parseFilesJson(filesJsonRaw, 'animus-extract');
      const analysisEntries =
        this.session?.corpus.published.analysisEntries ?? new Map();
      for (const entry of entries) {
        if (entry.source === '') {
          entry.source = analysisEntries.get(entry.path)?.source ?? '';
        }
      }
      return JSON.stringify(entries);
    };
    this.engineApi = () => {
      if (!this.rootDir) {
        throw new Error(
          '[animus-extract] the engine was used before the Vite root resolved'
        );
      }
      this.engineKey ??= sessionKey(build, this.rootDir);
      return engineHandle(this.engineKey, {
        label: 'animus-extract',
        rehydrateFilesJson,
      })();
    };
  }

  /** Creates the build's Session from the resolved config: Vite's engine,
   *  logger and core options, kept in memory. */
  createSession(): ExtractionSession {
    // A config resolved again (once per environment) supersedes the Session
    // the last one built; it leaves the registry before it is replaced.
    this.session?.close();
    const options = this.options;
    const session = new ExtractionSession(
      {
        system: options.system,
        exclude: options.exclude,
        extensions: options.extensions,
        strict: options.strict,
        diagnostics: options.diagnostics,
        verbose: options.verbose,
        prefix: options.prefix,
        prefixContextualVars: options.prefixContextualVars,
        targets: options.targets,
        minify: options.minify,
        staticCss: options.staticCss,
        layers: options.layers,
        engine: options.engine,
        mode: this.emissionProd ? 'production' : 'development',
      },
      {
        build: this.build,
        unbundledComputedImports: true,
        engine: () => this.engineApi(),
        logger: {
          info: (line) => (this.logger ?? console).info(line),
          warn: (line) => (this.logger ?? console).warn(line),
          error: (line) => (this.logger ?? console).error(line),
        },
      }
    );
    session.persistArtifacts = false;
    // Vite resolves asset() specifiers through its own asset pipeline.
    session.hostSubstitutesAssets = true;
    session.driverLabel = 'animus-extract';
    session.onOutcome = (outcome) => this.observeOutcome(session, outcome);
    session.development = this.development;
    session.rootDir = this.rootDir;
    session.conditions = this.resolveConditions;
    session.extensionPolicy = this.extensionPolicy;
    session.assetClassification = this.assetClassification;
    session.pathAliasesJson = this.pathAliasesJson;
    session.runtimeImport = options.runtimeImport ?? DEFAULT_RUNTIME_IMPORT;
    session.cssModuleId = VIRTUAL_CSS_ID;
    session.systemPropsModuleId = VIRTUAL_SYSTEM_PROPS_ID;
    session.structuralExclude =
      this.outputExclude === null ? [] : [this.outputExclude];
    this.session = session;
    return session;
  }

  /** Serves each publication as the Session makes it, so every reader in
   *  between sees one generation. */
  private observeOutcome(
    session: ExtractionSession,
    outcome: SessionOutcome
  ): void {
    let systemPropsChanged = false;
    // Aborted bytes go to Vite's own parser until a publication ends the
    // hold (see the transform hook).
    if (outcome.kind === 'held') {
      for (const [path, hash] of outcome.abortedOriginals) {
        this.abortedParseHashes.set(path, hash);
      }
    } else {
      this.abortedParseHashes.clear();
      const before = systemPropsModuleSource(this);
      this.adoptPublication(session);
      systemPropsChanged = systemPropsModuleSource(this) !== before;
    }
    for (const collected of this.outcomeCollectors) {
      collected.push({ outcome, systemPropsChanged });
    }
  }

  /** Submits a dev change set to the Session. Until a first publication
   *  there is no generation to update: the full read covers the change. */
  submitChanges(changes: WatchChanges): Promise<ObservedOutcome[]> {
    return this.runAttempt((session) =>
      session.publication === null
        ? session.runFullPipeline([], changes.sources)
        : session.handleWatchUpdate(changes)
    );
  }

  /** Runs one Session attempt and returns the outcomes that settle it. A
   *  hold warns and resolves with its outcome (Vite reports the syntax
   *  error itself); any other failure rejects. Either way the watcher
   *  learns the paths the attempt's system load named. */
  async runAttempt(
    attempt: (session: ExtractionSession) => Promise<void>
  ): Promise<ObservedOutcome[]> {
    const session = this.session ?? this.createSession();
    const collected: ObservedOutcome[] = [];
    this.outcomeCollectors.add(collected);
    try {
      await attempt(session);
    } catch (error) {
      if (!collected.some(({ outcome }) => outcome.kind === 'held')) {
        throw error;
      }
      this.warn(error instanceof Error ? error.message : String(error));
    } finally {
      this.outcomeCollectors.delete(collected);
      this.registerSystemWatchPaths();
    }
    return collected;
  }

  /** Serves the Session's last publication: the manifest, the analysis
   *  sheets (asset placeholders kept; Vite substitutes them), the system,
   *  the package map and the external-package state. */
  adoptPublication(session: ExtractionSession): void {
    const publication = session.publication;
    if (publication === null) return;
    const manifest = publication.manifest;
    this.system = publication.system;
    this.storedManifest = manifest;
    this.storedManifestJson = publication.manifestJson;
    this.globalCss = publication.analysisGlobalCss;
    this.resolvedComponentCss = publication.analysisComponentCss;
    this.reverseProvenance = manifest.reverse_provenance;
    this.storedSystemPropMapJson = JSON.stringify(manifest.system_prop_map);
    this.storedDynamicPropsJson = JSON.stringify(manifest.dynamic_props);
    this.storedAdmittedTransformsJson = JSON.stringify(
      manifest.admitted_transforms
    );
    this.storedTypedSystemPropsJson = JSON.stringify(
      manifest.typed_system_props
    );
    this.externalPackageDirs = session.externalPackageDirs;
    this.externalSourceEntries = session.externalSourceEntries;
    this.externalSourceSideEffects = session.externalSourceSideEffects;
    this.externalPackageOutcomes = session.lastExternalOutcomes;
    this.applyAssetSubstitutions();
  }

  /** Retires this context's build when Vite closes it: the Session leaves
   *  the registry (with its manifest and watch state) and the engine handle
   *  is released, injected engine or not. The next build start rejoins. */
  close(): void {
    this.session?.close();
    this.releaseEngine();
  }

  /** Releases this context's engine handle: a standalone one, which no
   *  joined build retires. The next use makes a fresh one. */
  releaseEngine(): void {
    if (this.engineKey === null) return;
    releaseEngineHandle(this.engineKey);
    this.engineKey = null;
  }

  log(msg: string): void {
    if (this.verbose) {
      (this.logger ?? console).info(`[animus] ${msg}`);
    }
  }

  /** One line per item — a pruned option, a transformed file, an HMR
   *  decision — printed only at the trace tier. */
  trace(msg: string): void {
    if (this.tracing) {
      (this.logger ?? console).info(`[animus] ${msg}`);
    }
  }

  /** Logs whether or not `verbose` is on — for events a developer must see
   *  without opting in. */
  info(msg: string): void {
    (this.logger ?? console).info(`[animus] ${msg}`);
  }

  warn(msg: string): void {
    (this.logger ?? console).warn(`[animus] ${msg}`);
  }

  /** Development's sink for error-level diagnostics: they are reported and
   *  the server or watch keeps running. Only a build fails on them. */
  reportErrors(): ((message: string) => void) | undefined {
    if (!this.development) return undefined;
    // Every reported line carries `[animus]`, as the warn sink's do;
    // `[animus:verify]` keeps its own mark.
    return (message) =>
      (this.logger ?? console).error(
        /^\[animus(?::verify)?\] /.test(message)
          ? message
          : `[animus] ${message.replace(/^\[animus-extract\] /, '')}`
      );
  }

  /** A build-strictness check that failed: a build throws `message`, and
   *  development reports it at error level and takes the non-strict path. */
  strictFailure(message: string, cause?: unknown): void {
    const report = this.reportErrors();
    if (!report) {
      throw new Error(message, cause === undefined ? undefined : { cause });
    }
    report(message);
  }

  devFsUrl(absPath: string): string {
    const base = this.base.endsWith('/') ? this.base.slice(0, -1) : this.base;
    return `${base}/@fs${absPath}`;
  }

  /** A dev asset() URL: an immutable content-named copy of `absPath`, so an
   *  edit gets a new URL, or the live file where copies are not served. */
  devAssetUrl(specifier: string, absPath: string): string {
    if (this.assetCopyDir === null) return this.devFsUrl(absPath);
    const { fileName } = writeAssetCopy(absPath, this.assetCopyDir);
    const copyPath = join(this.assetCopyDir, fileName);
    if (!this.servesFile(copyPath)) {
      if (!this.unservedAssetCopies.has(specifier)) {
        this.unservedAssetCopies.add(specifier);
        this.warn(
          `[animus-extract] the copy of asset() ${specifier} is not served under server.fs; serving the live file instead, so an edit keeps its URL`
        );
      }
      return this.devFsUrl(absPath);
    }
    // Watched once its copy exists, wherever it lives: an edit makes the
    // next copy.
    if (this.assetSourceBySpecifier.get(specifier) !== absPath) {
      this.devServer?.watcher?.add(absPath);
    }
    this.assetSourceBySpecifier.set(specifier, absPath);
    this.retainAssetCopy(absPath, fileName);
    return this.devFsUrl(copyPath);
  }

  /** Keeps each source's current copy and the one before it; an asset
   *  edit reloads the page, so an older URL is never fetched again. A copy
   *  another source still keeps is never removed. */
  private retainAssetCopy(source: string, fileName: string): void {
    const history = this.assetCopyHistory.get(source) ?? [];
    if (history[history.length - 1] !== fileName) history.push(fileName);
    this.assetCopyHistory.set(source, history);
    while (history.length > 2) {
      const oldest = history.shift()!;
      const kept = [...this.assetCopyHistory.values()].some((copies) =>
        copies.includes(oldest)
      );
      if (!kept && this.assetCopyDir !== null) {
        rmSync(join(this.assetCopyDir, oldest), { force: true });
      }
    }
  }

  /** Whether `absFile` is the source of a dev asset copy. */
  isAssetSource(absFile: string): boolean {
    const keys = new Set(toWatchKeys(absFile));
    return [...this.assetSourceBySpecifier.values()].some((source) =>
      toWatchKeys(source).some((key) => keys.has(key))
    );
  }

  /** Copies an edited asset under its new content name and redelivers the
   *  stylesheet that names it. */
  refreshAssetCopies(absFile: string): void {
    const keys = new Set(toWatchKeys(absFile));
    for (const [specifier, source] of this.assetSourceBySpecifier) {
      if (!toWatchKeys(source).some((key) => keys.has(key))) continue;
      try {
        this.assetUrlBySpecifier.set(
          specifier,
          this.devAssetUrl(specifier, source)
        );
      } catch (err) {
        this.warn(
          `[animus-extract] could not copy edited asset ${source}: ${String(err)}`
        );
      }
    }
    this.invalidateSystemReloadModules(true);
  }

  assetFallback(specifier: string, message: string, cause?: unknown): void {
    if (this.options.strict) this.strictFailure(message, cause);
    else this.warn(message);
    this.assetUrlBySpecifier.set(specifier, specifier);
    this.assetResolutionFailures.add(specifier);
  }

  /** Every asset() specifier in the sheets the plugin emits. */
  sheetAssetSpecifiers(): string[] {
    return findSheetAssetSpecifiers({
      variableCss: this.system.variableCss,
      globalCss: this.analysisGlobalCss,
      componentCss: this.analysisComponentCss,
    });
  }

  /** `system.variableCss` with its asset() placeholders substituted from
   *  the current asset map. Derived on every read, so it always matches
   *  `system`, however and whenever that was assigned; `system` keeps the
   *  placeholders for the next asset pass. */
  get variableCss(): string {
    return substituteSheetAssets(
      { ...NO_SHEETS, variableCss: this.system.variableCss },
      this.assetUrlBySpecifier
    ).variableCss;
  }

  /** Resolves asset specifiers a system reload introduced. Node-side only —
   *  the plugin hook context is unavailable here, so results can differ. */
  private applyAssetSubstitutions(): void {
    if (!this.isProd && this.assetPassComplete) {
      for (const specifier of this.sheetAssetSpecifiers()) {
        if (this.assetResolutionFailures.delete(specifier)) {
          this.assetUrlBySpecifier.delete(specifier);
        }
        if (this.assetUrlBySpecifier.has(specifier)) continue;
        const resolved = resolveAssetFile(
          specifier,
          this.rootDir,
          this.pathAliasesJson
        );
        if (resolved) {
          this.assetUrlBySpecifier.set(
            specifier,
            this.devAssetUrl(specifier, resolved)
          );
        } else {
          this.assetFallback(
            specifier,
            `[animus-extract] unresolvable asset() specifier: ${specifier}`
          );
        }
      }
    }
  }

  invalidateSystemReloadModules(reloadClient: boolean): void {
    const server = this.devServer;
    if (!server) return;
    for (const moduleId of [
      RESOLVED_CSS_ID,
      RESOLVED_COMPONENTS_ID,
      RESOLVED_SYSTEM_PROPS_ID,
    ]) {
      const mod = server.moduleGraph.getModuleById(moduleId);
      if (mod) server.moduleGraph.invalidateModule(mod);
    }
    if (reloadClient) server.hot?.send({ type: 'full-reload' });
  }

  isSystemDependency(absFile: string): boolean {
    return this.session?.isSystemDependency(absFile) ?? false;
  }

  /** Watch every loader-reported dependency path, the external package
   *  roots, and the paths the load found absent that no watched directory
   *  covers (creating one reloads the system). Vite hard-ignores
   *  node_modules, so dependencies installed there produce no events. A list
   *  already registered is not added again. */
  registerSystemWatchPaths(): void {
    const watcher = this.devServer?.watcher;
    const session = this.session;
    if (!watcher || !session) return;
    for (const paths of [
      session.systemDependencyPaths,
      session.systemMissingPaths,
      session.externalPackageDirs,
    ]) {
      if (paths.length === 0 || this.watchedPathLists.has(paths)) continue;
      this.watchedPathLists.add(paths);
      const added =
        paths === session.systemMissingPaths
          ? this.uncoveredMissingPaths(paths, session.externalPackageDirs)
          : paths;
      if (added.length > 0) watcher.add(added);
    }
  }

  /** The absent paths no watched directory reports a creation for. Vite's
   *  root watch and a package root's watch already do, and a watch on an
   *  absent file inside a watched directory stops that directory's events
   *  under inotify (chokidar's non-fsevents handler). */
  private uncoveredMissingPaths(
    paths: readonly string[],
    packageDirs: readonly string[]
  ): string[] {
    const watchedDirs = this.rootDir
      ? [this.rootDir, ...packageDirs]
      : packageDirs;
    return paths.filter(
      (path) => !watchedDirs.some((dir) => isPathWithinRoot(dir, path))
    );
  }

  /** Invalidate the component CSS and system-props modules, then reload. The
   *  reload alone rescues nothing: Vite keeps serving its cached transform.
   *  `devServer.moduleGraph` is the mixed back-compat graph on purpose — it
   *  reaches client and ssr at once; per-environment graphs do not. */
  invalidateExtractedModules(): void {
    const server = this.devServer;
    if (!server) return;

    for (const moduleId of [RESOLVED_COMPONENTS_ID, RESOLVED_SYSTEM_PROPS_ID]) {
      const mod = server.moduleGraph.getModuleById(moduleId);
      if (mod) {
        server.moduleGraph.invalidateModule(mod);
      }
    }

    // Virtual-module HMR path matching is fragile for programmatic sends, so
    // a reload delivers the regenerated CSS; the window coalesces a burst.
    this.reloadWindow.note();
  }

  runSelfVerify(): void {
    const failures = runStructuralSelfCheck({
      componentCount: Object.keys(this.storedManifest?.components ?? {}).length,
      variableCss: this.variableCss,
      globalCss: this.globalCss,
      componentCss: this.resolvedComponentCss,
      layers: this.options.layers,
      externalOutcomes: this.externalPackageOutcomes,
      variableMapJson: this.system.variableMapJson,
    });

    for (const message of failures) {
      const line = `[animus:verify] ${message}`;
      if (this.options.strict) {
        this.strictFailure(line);
        continue;
      }
      if (this.logger) {
        this.logger.warn(line, { timestamp: true });
      } else {
        console.warn(line);
      }
    }

    if (failures.length === 0) {
      this.log('[animus:verify] structural self-check passed');
    }
  }
}
