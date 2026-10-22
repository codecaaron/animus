import {
  buildSystemPropsModule,
  builtInExtensionPolicy,
  builtInAssetClassification,
  contentHash,
  DEFAULT_EXTENSIONS,
  findSheetAssetSpecifiers,
  hostFinding,
  parseFilesJson,
  resolveAssetFile,
  resolveVerbosity,
  runStructuralSelfCheck,
  SELF_CHECK_FAILED,
  substituteAssetPlaceholders,
  substituteFontPreloads,
  substituteSheetAssets,
  surfaceManifestDiagnostics,
  unresolvableAssetDiagnostic,
  writeAssetCopy,
  toWatchKeys,
  withinAnyRoot,
} from '@animus-ui/extract/pipeline';
import {
  CoalescingWindow,
  createBuildId,
  EnvironmentBuilds,
  engineFactory,
  engineHandle,
  ExtractionSession,
  releaseEngineHandle,
  sessionKey,
} from '@animus-ui/extract/session';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';

import {
  RESOLVED_COMPONENTS_ID,
  RESOLVED_CSS_ID,
  RESOLVED_FONT_PRELOADS_ID,
  RESOLVED_SYSTEM_PROPS_ID,
  VIRTUAL_CSS_ID,
  VIRTUAL_SYSTEM_PROPS_ID,
} from './constants';
import { HotUpdateEvents } from './hot-update-events';

import type { HostLightning } from './css';
import type { AnimusExtractOptions } from './index';
import type {
  AssetSheets,
  ExcludeMatcher,
  FontPreload,
  HostAssetClassification,
  HostExtensionPolicy,
  HostLoadExpander,
  DiagnosticPolicy,
  EngineApi,
  ManifestDiagnostic,
  ProjectManifest,
  SystemConfig,
  sourceKitDependencies,
  systemKitDependencies,
} from '@animus-ui/extract/pipeline';
import type {
  SessionKey,
  SessionOutcome,
  SessionPublication,
  WatchChanges,
} from '@animus-ui/extract/session';
import type { Logger, ResolvedConfig } from 'vite';

/** What the kit discovery reads of the engine: its stateless lookups. */
export type KitEngine = Parameters<typeof sourceKitDependencies>[1] &
  Parameters<typeof systemKitDependencies>[2];

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

/** The system-props module before a first publication: no props. */
const EMPTY_SYSTEM_PROPS_MODULE = buildSystemPropsModule({
  systemPropMapJson: '{}',
  groupRegistryJson: emptySystemConfig().groupRegistryJson,
  dynamicProps: {},
  admittedTransforms: {},
  typedSystemProps: [],
  runtimeTables: undefined,
});

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
  /** A build that links the stylesheet's slices from each page, in place of
   *  the one sheet the CSS module carries; the dev server keeps one sheet. */
  get splitsStylesheet(): boolean {
    return this.isProd && this.options.stylesheets === 'split';
  }
  rootDir = '';
  /** Animus's folder in Vite's cache, where system loads are kept across
   *  builds; the session's fallback before Vite resolves its config. */
  cacheDir?: string;
  logger: Logger | null = null;

  /** The targets and features Animus's Lightning CSS pass follows, from
   *  Vite's resolved config. */
  lightning: HostLightning | null = null;
  /** Whether the stylesheet this client build served kept an authored
   *  `:dir()`, which Vite's own CSS minification may still lower. */
  servedDirSelector = false;
  /** Whether this client build warned that its minification lowered one. */
  warnedLoweredDir = false;

  pathAliasesJson: string | null = null;

  /** Vite's export conditions, so the loader reads the files Vite serves. */
  resolveConditions: string[] = [];
  private viteExtensionPolicy: HostExtensionPolicy | undefined;
  /** Vite's resolved extension order; the built-in policy until
   *  `configResolved`. */
  get extensionPolicy(): HostExtensionPolicy {
    return this.viteExtensionPolicy ?? builtInExtensionPolicy();
  }
  set extensionPolicy(policy: HostExtensionPolicy) {
    this.viteExtensionPolicy = policy;
  }
  /** Vite's asset classification, captured at `configResolved`. */
  assetClassification: HostAssetClassification =
    builtInAssetClassification('noHost');
  /** How Vite's build expands computed loads, captured at
   *  `configResolved`; none where it cannot be reproduced exactly. */
  loadExpander: HostLoadExpander | undefined;

  extensionsSet: ReadonlySet<string>;

  /** Built once per buildStart, before any discovery, from the user's
   *  exclude list and the output directory. */
  excludeMatcher!: ExcludeMatcher;

  /** Where Vite writes, every environment's output directories and files,
   *  as structural exclusions; none outside the root. Set in
   *  `configResolved`. */
  outputExcludes: string[] = [];
  /** The Vite config file the build loaded, where it loaded one. */
  configFiles: string[] = [];

  /** The Session publication this context serves, adopted whole as the
   *  Session commits it; null until one commits, and a failed analysis
   *  leaves the previous one served. Every view below reads it. */
  served: SessionPublication | null = null;
  /** What a context serves before a first publication. */
  private readonly unpublishedSystem = emptySystemConfig();

  get storedManifest(): ProjectManifest | null {
    return this.served?.manifest ?? null;
  }

  get storedManifestJson(): string {
    return this.served?.manifestJson ?? '';
  }

  get system(): SystemConfig {
    return this.served?.system ?? this.unpublishedSystem;
  }

  get reverseProvenance(): Record<string, string[]> {
    return this.served?.manifest.reverse_provenance ?? {};
  }

  /** The exact source `virtual:animus/system-props` serves: the served
   *  publication's, so the served bytes and the HMR change decision cannot
   *  diverge. */
  get systemPropsModule(): string {
    return this.served?.systemPropsModule ?? EMPTY_SYSTEM_PROPS_MODULE;
  }

  get externalPackageDirs(): string[] {
    return this.served?.externalPackageDirs ?? [];
  }

  /** Whether a path lies under a published kit source directory: the
   *  directories resolved once for each publication that lists them. */
  get inKitSource(): (path: string) => boolean {
    const dirs = this.externalPackageDirs;
    if (this.kitSourceTest?.dirs !== dirs) {
      this.kitSourceTest = { dirs, test: withinAnyRoot(dirs) };
    }
    return this.kitSourceTest.test;
  }

  private kitSourceTest:
    | { dirs: readonly string[]; test: (path: string) => boolean }
    | undefined;

  /** specifier → whether its redirected source entry has side effects, from
   *  the owning package's `sideEffects`; absent leaves Vite's default. */
  get externalSourceSideEffects(): ReadonlyMap<string, boolean> {
    return this.served?.externalSourceSideEffects ?? new Map();
  }

  get externalSourceEntries(): ReadonlyMap<string, string> {
    return this.served?.externalSourceEntries ?? new Map();
  }

  /** The analysis sheets keep their asset() placeholders; these views
   *  substitute the current asset URLs, so an edited asset changes its URL
   *  without re-analysis. */
  get globalCss(): string {
    return substituteAssetPlaceholders(
      this.analysisSheets().globalCss,
      this.assetUrlBySpecifier
    );
  }

  get resolvedComponentCss(): string {
    return substituteAssetPlaceholders(
      this.analysisSheets().componentCss,
      this.assetUrlBySpecifier
    );
  }

  /** The published font preloads, each by the URL the stylesheet's own
   *  `url()` gets: what index.html preloads and the font-preloads module
   *  exports. */
  get fontPreloads(): FontPreload[] {
    return substituteFontPreloads(
      this.served?.fontPreloads,
      this.assetUrlBySpecifier
    ).map((preload) =>
      this.isProd
        ? preload
        : { ...preload, href: this.devRootRelativeUrl(preload.href) }
    );
  }

  private analysisSheets(): AssetSheets {
    return {
      ...NO_SHEETS,
      globalCss: this.served?.analysisGlobalCss ?? '',
      componentCss: this.served?.analysisComponentCss ?? '',
    };
  }

  layerDeclaration = '';

  transformOutputHashes = new Map<string, string>();

  /** Environment name → the component CSS its components module was last
   *  built from, so an analysis that leaves it as it was invalidates
   *  nothing. */
  servedComponentCss = new Map<string, string>();

  recordTransformOutput(relativePath: string, code: string): void {
    this.transformOutputHashes.set(relativePath, contentHash(code));
  }

  /** Original path → hash of bytes whose parse aborted in a rejected attempt;
   *  non-empty while that rejection holds publication. Those bytes are served
   *  raw so the host reports its own syntax error instead of receiving the
   *  previous module from the retained engine. */
  readonly abortedParseHashes = new Map<string, string>();

  readonly hotUpdateEvents = new HotUpdateEvents();

  /** Coalesces a burst of invalidations into one full reload. */
  private readonly reloadWindow = new CoalescingWindow(() => {
    this.devServer?.hot?.send({ type: 'full-reload' });
  });

  base = '/';
  renderBuiltUrl: ResolvedConfig['experimental']['renderBuiltUrl'];
  /** Vite's root and `server.origin`, which a dev asset URL is served
   *  under. */
  viteRoot = '';
  serverOrigin = '';
  /** Vite's resolved public directory; empty when it serves none. */
  publicDir = '';

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  devServer: any;

  /** The paths already registered, per watcher: a reused plugin instance
   *  whose dev server is replaced registers everything with the new one. */
  private readonly watchedPaths = new WeakMap<object, Set<string>>();

  // Per-plugin-instance engine state: two differently-configured plugins in
  // one process must not share an engine.

  /** Every native extraction call goes through this one accessor. */
  readonly engineApi: () => EngineApi;
  /** The native module's stateless lookups, before the root resolves: the
   *  shared factory, which registers no handle. */
  readonly kitEngine: () => KitEngine = engineFactory;
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
    engineApiOverride?: () => EngineApi
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
        systemExport: options.systemExport,
        exclude: options.exclude,
        extensions: options.extensions,
        strict: options.strict,
        diagnostics: options.diagnostics,
        verbose: options.verbose,
        prefix: options.prefix,
        prefixContextualVars: options.prefixContextualVars,
        targets: options.targets,
        keepDirSelector: options.keepDirSelector,
        shortClassNames: options.shortClassNames,
        propOrderFile: options.propOrderFile,
        minify: options.minify,
        staticCss: options.staticCss,
        layers: options.layers,
        engine: options.engine,
        runtimeImport: options.runtimeImport,
        closedDynamicImports: options.closedDynamicImports,
        fontPreloads: options.fontPreloads,
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
    session.hostLightning = this.lightning;
    session.driverLabel = 'animus-extract';
    session.onOutcome = (outcome) => this.observeOutcome(session, outcome);
    session.development = this.development;
    session.rootDir = this.rootDir;
    session.systemLoadCacheDir = this.cacheDir;
    session.conditions = this.resolveConditions;
    session.extensionPolicy = this.extensionPolicy;
    session.assetClassification = this.assetClassification;
    session.loadExpander = this.loadExpander;
    session.pathAliasesJson = this.pathAliasesJson;
    session.delivery = {
      cssModuleId: VIRTUAL_CSS_ID,
      systemPropsModuleId: VIRTUAL_SYSTEM_PROPS_ID,
    };
    session.structuralExclude = this.outputExcludes;
    session.buildConfigFiles = this.configFiles;
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
      const before = this.systemPropsModule;
      this.adoptPublication(session);
      systemPropsChanged = this.systemPropsModule !== before;
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

  /** Serves the Session's last publication whole (asset placeholders
   *  kept; Vite substitutes them). */
  adoptPublication(session: ExtractionSession): void {
    if (session.publication === null) return;
    this.served = session.publication;
    this.applyAssetSubstitutions();
  }

  /** The context's environment builds: a custom `buildApp` builds a shared
   *  plugin's environments in parallel, so the context's build retires with
   *  the last of them, not the first. */
  readonly builds = new EnvironmentBuilds();

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
    // Every reported line carries `[animus]`, as the warn sink's do.
    return (message) =>
      (this.logger ?? console).error(
        /^\[animus\] /.test(message)
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

  /** The URL Vite's dev server serves `absPath` at, the form its dev CSS
   *  pass writes (`fileToDevUrl`): root-relative inside its root, `/@fs/`
   *  outside, under `server.origin` and the base. Every consumer, the
   *  stylesheet that pass rewrites, component CSS it does not, and a font
   *  preload, then names one URL, and the browser fetches the file once. */
  devServedUrl(absPath: string): string {
    const base = this.base.endsWith('/') ? this.base.slice(0, -1) : this.base;
    const root = this.viteRoot.endsWith('/')
      ? this.viteRoot
      : `${this.viteRoot}/`;
    const path =
      this.viteRoot !== '' && absPath.startsWith(root)
        ? `/${absPath.slice(root.length)}`
        : `/@fs${absPath}`;
    return `${this.serverOrigin}${base}${path}`;
  }

  /** A root-relative URL a face names as written, as Vite's dev CSS pass
   *  writes it: under `server.origin` and the base where it names a public
   *  file or a file under the root, else unchanged. */
  /** Whether `href` is a root-relative URL of a file Vite serves, from its
   *  public directory or its root. */
  servesRootRelative(href: string): boolean {
    if (!href.startsWith('/') || href.startsWith('//')) return false;
    // Vite looks the file up by its decoded path; the URL keeps its escapes.
    let path: string;
    try {
      path = decodeURI(href.split(/[?#]/)[0]!);
    } catch {
      return false;
    }
    return [this.publicDir, this.viteRoot].some(
      (dir) => dir !== '' && existsSync(join(dir, path))
    );
  }

  devRootRelativeUrl(href: string): string {
    if (!this.servesRootRelative(href)) return href;
    const base = this.base.endsWith('/') ? this.base.slice(0, -1) : this.base;
    return `${this.serverOrigin}${base}${href}`;
  }

  /** A dev asset() URL: an immutable content-named copy of `absPath`, so an
   *  edit gets a new URL, or the live file where copies are not served. */
  devAssetUrl(specifier: string, absPath: string): string {
    if (this.assetCopyDir === null) return this.devServedUrl(absPath);
    const { fileName } = writeAssetCopy(absPath, this.assetCopyDir);
    const copyPath = join(this.assetCopyDir, fileName);
    if (!this.servesFile(copyPath)) {
      if (!this.unservedAssetCopies.has(specifier)) {
        this.unservedAssetCopies.add(specifier);
        this.warn(
          `[animus-extract] the copy of asset() ${specifier} is not served under server.fs; serving the live file instead, so an edit keeps its URL`
        );
      }
      return this.devServedUrl(absPath);
    }
    // Watched once its copy exists, wherever it lives: an edit makes the
    // next copy.
    if (this.assetSourceBySpecifier.get(specifier) !== absPath) {
      this.devServer?.watcher?.add(absPath);
    }
    this.assetSourceBySpecifier.set(specifier, absPath);
    this.retainAssetCopy(absPath, fileName);
    return this.devServedUrl(copyPath);
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

  /** An asset() specifier that could not be copied or emitted: `message`
   *  fails a strict build, and the URL stays as written. */
  assetFallback(specifier: string, message: string, cause?: unknown): void {
    if (this.options.strict) this.strictFailure(message, cause);
    else this.warn(message);
    this.keepAssetSpecifier(specifier);
  }

  /** An asset() specifier no file answers, reported under its code: the
   *  URL stays as written. */
  assetUnresolvable(specifier: string): void {
    this.surfaceDiagnostics([unresolvableAssetDiagnostic(specifier)]);
    this.keepAssetSpecifier(specifier);
  }

  private keepAssetSpecifier(specifier: string): void {
    this.assetUrlBySpecifier.set(specifier, specifier);
    this.assetResolutionFailures.add(specifier);
  }

  /** Reports the plugin's own findings under the `diagnostics` levels and
   *  strictness: an error-severity record fails a strict build. */
  surfaceDiagnostics(diagnostics: ManifestDiagnostic[]): void {
    surfaceManifestDiagnostics(
      { diagnostics },
      (message) => this.warn(message),
      this.diagnosticPolicy()
    );
  }

  /** The `diagnostics` levels and strictness every finding the plugin
   *  makes is reported under. */
  diagnosticPolicy(): DiagnosticPolicy {
    return {
      levels: this.options.diagnostics,
      strict: this.options.strict,
      info: (line) => this.log(line),
      reportErrors: this.reportErrors(),
    };
  }

  /** Every asset() specifier in the sheets the plugin emits. */
  sheetAssetSpecifiers(): string[] {
    return findSheetAssetSpecifiers({
      variableCss: this.system.variableCss,
      globalCss: this.analysisSheets().globalCss,
      componentCss: this.analysisSheets().componentCss,
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
          this.assetUnresolvable(specifier);
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
      RESOLVED_FONT_PRELOADS_ID,
    ]) {
      const mod = server.moduleGraph.getModuleById(moduleId);
      if (mod) server.moduleGraph.invalidateModule(mod);
    }
    if (reloadClient) server.hot?.send({ type: 'full-reload' });
  }

  isSystemDependency(absFile: string): boolean {
    return this.session?.isSystemDependency(absFile) ?? false;
  }

  /** Whether a change to `absFile` re-reads the configuration: the Session
   *  runs a full pass for it, as for a system change. */
  isConfigInput(absFile: string): boolean {
    return this.session?.isConfigInput(absFile) ?? false;
  }

  /** Registers the Session's watch plan with Vite's watcher, each path
   *  once per watcher. Vite also watches its packages' own directories beside the
   *  plan's canonical roots, and an absent path either covers (or the root
   *  does) is left to their watch: a watch on an absent file inside a
   *  watched directory stops that directory's events under inotify
   *  (chokidar's non-fsevents handler). Vite hard-ignores node_modules, so
   *  dependencies installed there produce no events. */
  registerSystemWatchPaths(): void {
    const watcher = this.devServer?.watcher;
    const session = this.session;
    if (!watcher || !session) return;
    const directories = [
      ...new Set([
        ...session.watchPlan().directories,
        ...session.externalPackageDirs,
      ]),
    ];
    const covered = this.rootDir ? [this.rootDir, ...directories] : directories;
    const plan = session.watchPlan(covered);
    let registered = this.watchedPaths.get(watcher);
    if (registered === undefined) {
      registered = new Set();
      this.watchedPaths.set(watcher, registered);
    }
    for (const paths of [plan.files, plan.missing, directories]) {
      const added = paths.filter((path) => !registered.has(path));
      for (const path of added) registered.add(path);
      if (added.length > 0) watcher.add(added);
    }
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
      // An unresolvable include is discovery's own finding, at the level
      // the diagnostics option sets: the self-check does not report it again.
      variableMapJson: this.system.variableMapJson,
    });

    this.surfaceDiagnostics(
      failures.map((message) =>
        hostFinding(SELF_CHECK_FAILED, 'stylesheet', 'self-check', message)
      )
    );

    if (failures.length === 0) {
      this.log('[animus:verify] structural self-check passed');
    }
  }
}
