import {
  BUILT_IN_EXTENSION_POLICY,
  builtInAssetClassification,
  DiagnosticFailure,
  droppedExtensionMessage,
  ENGINE_TRANSFORM_EXTENSIONS,
  esbuildAssetClassification,
  esbuildExtensionPolicy,
  isEngineTransformExtension,
  isPathWithinRoot,
  keepsKitSourceEffects,
  rollupExtensionPolicy,
  servedFiles,
  viteAssetClassification,
  viteExtensionPolicy,
  webpackExtensionPolicy,
} from '@animus-ui/extract/pipeline';
import {
  ANIMUS_CSS_MODULE_ID,
  collectSessionAssets,
  createBuildId,
  engineApi,
  ExtractionSession,
  getAnalyzedHashes,
  getManifestJson,
  getSessionArtifactDir,
  getSharedCss,
  getSharedSystemProps,
  SESSION_ASSETS_DIR,
  TURBOPACK_SYSTEM_PROPS_ID,
} from '@animus-ui/extract/session';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { resolveHostMode, resolveHostOptions } from './options';

import type { AnimusUnpluginOptions } from './options';
import type {
  AnimusMode,
  HostAssetClassification,
  HostExtensionPolicy,
  HostResolve,
  ProjectManifest,
  ServedFiles,
} from '@animus-ui/extract/pipeline';
import type { SessionKey } from '@animus-ui/extract/session';
import type {
  ExternalIdResult,
  UnpluginBuildContext,
  UnpluginContext,
  UnpluginFactory,
} from 'unplugin';

/** Extension-free: esbuild picks loaders by extension. No `\0` prefix:
 *  webpack's virtual-module bridge requires plain ids. */
export const STYLES_VIRTUAL_ID = 'animus:styles';

export const PROPS_VIRTUAL_ID = 'animus:system-props';

/** What webpack requests in place of the session's system-props id: webpack
 *  hands a scheme-shaped request such as `virtual:…` to its scheme handlers,
 *  never the resolver, so only a plain id reaches `resolveId` and the
 *  virtual-module bridge behind it. */
const WEBPACK_PROPS_REQUEST = '@animus-ui/unplugin/system-props';

export const CSS_ASSET_NAME = 'animus.css';

const TRANSFORM_INCLUDE_RE = new RegExp(
  `\\.(?:${[...ENGINE_TRANSFORM_EXTENSIONS, 'cjs'].join('|')})$`
);

const DEV_DEFINE_RE = /\b__ANIMUS_DEV__\b(?!\s*=[^=])/g;

export interface HostState {
  pipeline: Promise<void> | null;
  mode: AnimusMode | null;
  cssText: string;
  systemPropsJs: string;
  kitRedirects: Map<string, string>;
  /** Specifier → its redirect target's side effects; absent leaves the
   *  bundler's own classification. */
  kitSideEffects: Map<string, boolean>;
  redirectTargets: Set<string>;
  externalPackageDirs: string[];
  watchPaths: string[];
  transformFile:
    | ((
        source: string,
        path: string,
        manifestJson: string
      ) => { code: string; hasComponents: boolean })
    | null;
  sessionDir: string | null;
  /** The build of the root this plugin instance analyses, once a pipeline
   *  run's session joined it. */
  key: SessionKey | null;
  /** The files the run's analysis extracted components from, and the
   *  extensions it dropped over their parent. */
  served: ServedFiles;
}

export function createHostState(): HostState {
  return {
    pipeline: null,
    mode: null,
    cssText: '',
    served: { listed: new Set(), dropped: new Map() },
    systemPropsJs: '',
    kitRedirects: new Map(),
    kitSideEffects: new Map(),
    redirectTargets: new Set(),
    externalPackageDirs: [],
    watchPaths: [],
    transformFile: null,
    sessionDir: null,
    key: null,
  };
}

export function shouldClaimTransform(
  filePath: string,
  state: Pick<HostState, 'externalPackageDirs' | 'redirectTargets'>
): boolean {
  if (!filePath.includes('node_modules')) return true;
  return (
    state.redirectTargets.has(filePath) ||
    state.externalPackageDirs.some((dir) => isPathWithinRoot(dir, filePath))
  );
}

export function disposeSessionDir(
  state: HostState,
  removeDir: (dir: string) => void = (dir) =>
    rmSync(dir, { recursive: true, force: true })
): void {
  if (state.sessionDir) {
    removeDir(state.sessionDir);
    state.sessionDir = null;
  }
}

export async function drivePipeline(
  state: HostState,
  run: () => Promise<void>,
  removeDir?: (dir: string) => void
): Promise<void> {
  const attempt = run();
  state.pipeline = attempt;
  try {
    await attempt;
  } catch (error) {
    if (!state.sessionDir && state.key !== null) {
      state.sessionDir = getSessionArtifactDir(state.key);
    }
    disposeSessionDir(state, removeDir);
    throw error;
  }
}

export function resolveAnimusId(id: string): string | null {
  if (id === ANIMUS_CSS_MODULE_ID || id.endsWith(`/${ANIMUS_CSS_MODULE_ID}`)) {
    return STYLES_VIRTUAL_ID;
  }
  if (id === STYLES_VIRTUAL_ID || id === PROPS_VIRTUAL_ID) return id;
  if (id === TURBOPACK_SYSTEM_PROPS_ID || id === WEBPACK_PROPS_REQUEST) {
    return PROPS_VIRTUAL_ID;
  }
  return null;
}

export function substituteDevDefine(
  code: string,
  isDev: boolean
): string | null {
  if (!code.includes('__ANIMUS_DEV__')) return null;
  return code.replace(DEV_DEFINE_RE, isDev ? 'true' : 'false');
}

export function transformWithEngine(
  code: string,
  id: string,
  ctx: {
    rootDir: string;
    manifestJson: string;
    transformFile: (
      source: string,
      path: string,
      manifestJson: string
    ) => { code: string; hasComponents: boolean };
    /** The root-relative files the analysis extracted components from,
     *  which must transform, and those it dropped over their parent. */
    served?: ServedFiles;
  }
): string | null {
  const filename = relative(ctx.rootDir, resolve(id)).split('\\').join('/');
  // A dropped extension is never served raw, even beside components that
  // did extract (SA1).
  const drop = ctx.served?.dropped.get(filename);
  if (drop !== undefined) throw new Error(droppedExtensionMessage(drop));
  const result = ctx.transformFile(code, filename, ctx.manifestJson);
  if (result.hasComponents) return result.code;
  // Serving it raw would ship builder code (SA1).
  if (ctx.served?.listed.has(filename)) {
    throw new Error(
      `[animus] the analysis extracted components from ${filename}, but its ` +
        `transform found none`
    );
  }
  return null;
}

/** What a manifest's transform serves, parsed once per run. */
function manifestServedFiles(manifestJson: string | null): ServedFiles {
  if (manifestJson === null) return { listed: new Set(), dropped: new Map() };
  // SAFETY: the session's own published manifest.
  return servedFiles(JSON.parse(manifestJson) as ProjectManifest);
}

/** Whether esbuild's `external` option names `specifier`: exactly, as the
 *  package a subpath belongs to, or through a `*` wildcard. */
function isEsbuildExternal(
  specifier: string,
  external: readonly string[] | undefined
): boolean {
  return (external ?? []).some((pattern) => {
    if (!pattern.includes('*')) {
      return specifier === pattern || specifier.startsWith(`${pattern}/`);
    }
    const [prefix, suffix] = pattern.split('*', 2);
    return (
      specifier.length >= prefix.length + suffix.length &&
      specifier.startsWith(prefix) &&
      specifier.endsWith(suffix)
    );
  });
}

function moduleFilePath(id: string): string {
  const query = id.indexOf('?');
  return query === -1 ? id : id.slice(0, query);
}

/** Whether a hook context is a Rollup-family one that resolves imports. */
function canResolve(
  context: UnpluginBuildContext & UnpluginContext
): context is UnpluginBuildContext & UnpluginContext & RollupResolveContext {
  return 'resolve' in context;
}

/** Marks the esbuild resolve that `esbuild.setup` makes for itself. */
const KIT_SOURCE_RESOLVE = 'animus:kit-source-resolve';

/** The slice of a Rollup-family plugin context that resolves an import. */
interface RollupResolveContext {
  resolve(
    id: string,
    importer: string,
    options: { skipSelf: boolean }
  ): Promise<{
    id: string;
    external?: boolean | 'absolute' | 'relative';
    moduleSideEffects?: boolean | 'no-treeshake' | null;
  } | null>;
}

interface EsbuildOptionsLike {
  outdir?: string;
  outfile?: string;
  absWorkingDir?: string;
  write?: boolean;
  define?: Record<string, string>;
  conditions?: string[];
  resolveExtensions?: string[];
}

interface RspackLikeCompiler extends WebpackLikeCompiler {
  options: WebpackLikeCompiler['options'] & {
    module: {
      rules: Array<{
        test: (resource: string) => boolean;
        issuer?: (issuer: string) => boolean;
        sideEffects: boolean;
      }>;
    };
  };
}

interface WebpackLikeCompiler {
  options: {
    mode?: string;
    resolve?: {
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
  };
  /** Set once `watch()` starts, before the first compilation. */
  watchMode?: boolean;
  webpack?: {
    version?: string;
    DefinePlugin?: new (defs: Record<string, string>) => WebpackLikeApplied;
  };
  rspack?: {
    rspackVersion?: string;
    DefinePlugin?: new (defs: Record<string, string>) => WebpackLikeApplied;
  };
  hooks: {
    done: { tap: (name: string, fn: () => void) => void };
    failed?: { tap: (name: string, fn: () => void) => void };
    /** `close()` of a watch, which webpack fires in place of `done` when it
     *  closes mid-compile. */
    watchClose?: { tap: (name: string, fn: () => void) => void };
    normalModuleFactory: {
      tap: (
        name: string,
        fn: (nmf: {
          hooks: {
            afterResolve: {
              tap: (
                name: string,
                fn: (resolveData: KitResolveData) => void
              ) => void;
            };
          };
        }) => void
      ) => void;
    };
  };
}
/** The part of webpack's resolve data the kit classification reads and
 *  writes. */
interface KitResolveData {
  request: string;
  createData?: {
    resource?: string;
    settings?: { sideEffects?: boolean };
  };
}
interface WebpackLikeApplied {
  apply: (compiler: WebpackLikeCompiler) => void;
}

/** A Rollup-family plugin context, which resolves through the bundler's
 *  own plugin pipeline. */
interface ResolvingContext {
  resolve(
    source: string,
    importer?: string,
    options?: { skipSelf?: boolean }
  ): Promise<{ id: string } | null>;
}

function hasPluginResolve(
  context: UnpluginBuildContext | ResolvingContext
): context is ResolvingContext {
  return 'resolve' in context;
}

/** The bundler's resolution through a Rollup-family plugin context (Rollup,
 *  Rolldown, Vite); none where the context cannot resolve. */
function pluginResolver(
  context: UnpluginBuildContext | ResolvingContext
): HostResolve | null {
  if (!hasPluginResolve(context)) return null;
  return async (specifier, importer) =>
    (await context.resolve(specifier, importer, { skipSelf: true }))?.id ??
    null;
}

const PLUGIN_NAME = 'animus-host';

const ESBUILD_WATCH_HINT =
  'If this is an esbuild watch or serve context, pass watch: true to the Animus esbuild plugin.';

export const unpluginFactory: UnpluginFactory<
  AnimusUnpluginOptions | undefined
> = (rawOptions, meta) => {
  const { root, options, watch } = resolveHostOptions(rawOptions);
  const state = createHostState();
  // One build per plugin instance: each pipeline run's session joins it.
  const buildId = createBuildId();
  let activeSession: ExtractionSession | null = null;
  let modeOracle: AnimusMode | null = null;
  /** Whether the host is watching, where an error-level diagnostic reports
   *  and the pipeline still publishes. Only a build fails on one. Rollup's
   *  oracle is its watch mode; webpack's is its `mode`, so it reads
   *  `watchMode` instead, and Vite reads its command. esbuild gives neither,
   *  so its author says so with the `watch` option. */
  let watching = (): boolean => modeOracle === 'development';
  let esbuildOptions: EsbuildOptionsLike | null = null;
  /** The bundler's export conditions, in its order, for the system loader;
   *  Rollup exposes none. */
  let hostConditions: readonly string[] = [];
  /** The bundler's extension order, as its resolved configuration holds
   *  it; the built-in policy for a host none is read from (Rolldown). */
  let hostExtensions: HostExtensionPolicy = BUILT_IN_EXTENSION_POLICY;
  let hostAssets: HostAssetClassification =
    builtInAssetClassification('noHost');
  /** The bundler's own resolution, which package discovery asks first
   *  (spec §2.2 A4); none where the host exposes no resolver. */
  let hostResolver: HostResolve | null = null;
  /** Hooks can fire before buildStart (webpack's make taps run
   *  concurrently), so joiners await this before awaiting the pipeline. */
  let signalPipelineStarted!: () => void;
  const pipelineStarted = new Promise<void>((res) => {
    signalPipelineStarted = res;
  });

  const effectiveMode = (): AnimusMode =>
    resolveHostMode(options.mode, modeOracle);

  /** Hosts whose `resolveId` result carries `moduleSideEffects`. */
  const rollupLike =
    meta.framework === 'rollup' ||
    meta.framework === 'rolldown' ||
    meta.framework === 'vite';

  const needsInlineDefine =
    meta.framework !== 'esbuild' &&
    meta.framework !== 'webpack' &&
    meta.framework !== 'rspack';

  // Rollup, Rolldown, esbuild and Vite leave an `import(expr)` they cannot
  // read unbundled; webpack and Rspack bundle it as a directory context.
  const unbundledComputedImports =
    meta.framework === 'rollup' ||
    meta.framework === 'rolldown' ||
    meta.framework === 'esbuild' ||
    meta.framework === 'vite';

  async function startPipeline(): Promise<void> {
    signalPipelineStarted();
    // A webpack compile that ended without done or failed (it restarts one
    // an edit invalidated, and skips both) left its Session joined and its
    // claim held: retire it before this run claims the build again. A
    // webpack compiler runs one compile at a time; the Rollup family can
    // start environments in parallel, so they keep theirs.
    if (
      activeSession !== null &&
      (meta.framework === 'webpack' || meta.framework === 'rspack')
    ) {
      disposeSessionDir(state);
      releaseClaim();
    }
    try {
      await runClaimedPipeline();
    } catch (error) {
      releaseClaim();
      // esbuild cannot tell a watch from a build: the author who meant a
      // watch learns the option from the failure.
      if (
        meta.framework === 'esbuild' &&
        !watch &&
        error instanceof DiagnosticFailure
      ) {
        throw new Error(`${String(error)}\n${ESBUILD_WATCH_HINT}`, {
          cause: error,
        });
      }
      throw error;
    }
  }

  function releaseClaim(): void {
    activeSession?.close();
    activeSession = null;
  }

  async function runClaimedPipeline(): Promise<void> {
    await drivePipeline(state, async () => {
      const mode = effectiveMode();
      state.mode = mode;
      const session = new ExtractionSession(
        { ...options, mode },
        { unbundledComputedImports, build: buildId }
      );
      activeSession = session;
      session.development = watching();
      session.driverLabel = 'animus-unplugin';
      session.rootDir = root;
      session.conditions = hostConditions;
      session.extensionPolicy = hostExtensions;
      session.assetClassification = hostAssets;
      session.hostResolve = hostResolver;
      session.systemPropsModuleId = TURBOPACK_SYSTEM_PROPS_ID;
      // Each full pass re-reads the tsconfig aliases.
      session.aliasesFromTsconfig = true;
      state.key = session.key;
      try {
        await session.runFullPipeline();
      } catch (error) {
        // A failed load still names what to watch for the retry: the files
        // it read and the paths it found absent.
        state.watchPaths = [
          resolve(root, options.system),
          ...session.systemDependencyPaths,
          ...session.systemMissingPaths,
          join(root, 'tsconfig.json'),
        ];
        throw error;
      }
      state.sessionDir = getSessionArtifactDir(session.key);
      const analyzed = getAnalyzedHashes(session.key);
      if (!analyzed || analyzed.size === 0) {
        throw new Error(
          `[animus] discovery found zero source files under ${root} — ` +
            `check the plugin's \`root\` and \`exclude\` options`
        );
      }
      state.cssText = getSharedCss(session.key);
      state.served = manifestServedFiles(getManifestJson(session.key));
      state.systemPropsJs = getSharedSystemProps(session.key);
      state.kitRedirects = new Map(session.externalSourceEntries);
      state.kitSideEffects = new Map(session.externalSourceSideEffects);
      state.redirectTargets = new Set(state.kitRedirects.values());
      state.externalPackageDirs = [...session.externalPackageDirs];
      const watchPaths = new Set<string>();
      for (const key of getAnalyzedHashes(session.key)?.keys() ?? []) {
        watchPaths.add(resolve(root, key));
      }
      for (const dep of session.systemDependencyPaths) watchPaths.add(dep);
      // Absent now; creating one rebuilds against a system that loads it.
      for (const path of session.systemMissingPaths) watchPaths.add(path);
      for (const dep of session.assetDependencyPaths) watchPaths.add(dep);
      watchPaths.add(join(root, 'tsconfig.json'));
      state.watchPaths = [...watchPaths];
      state.transformFile = engineApi(session.key).transformFile;
    });
  }

  async function joinPipeline(): Promise<void> {
    await pipelineStarted;
    await state.pipeline;
  }

  function emitCssAsset(context: UnpluginBuildContext): void {
    if (!state.cssText) return;
    const assets = collectSessionAssets(state.sessionDir);
    if (meta.framework === 'esbuild') {
      // unplugin's esbuild emitFile silently no-ops without `outdir`, so
      // the host writes the stylesheet itself.
      const outDir =
        esbuildOptions?.outdir ??
        (esbuildOptions?.outfile ? dirname(esbuildOptions.outfile) : null);
      if (outDir === null) {
        console.warn(
          `[animus] esbuild build has no outdir/outfile — the extracted ` +
            `stylesheet (${CSS_ASSET_NAME}) was not written`
        );
        return;
      }
      if (esbuildOptions?.write === false) {
        console.warn(
          `[animus] esbuild \`write: false\` build — the extracted ` +
            `stylesheet (${CSS_ASSET_NAME}) and its asset files were NOT ` +
            `produced (no in-memory output seam); use \`write: true\` or ` +
            `the standalone \`animus build\` CLI for in-memory pipelines`
        );
        return;
      }
      const base = esbuildOptions?.absWorkingDir ?? process.cwd();
      const absOut = resolve(base, outDir);
      mkdirSync(absOut, { recursive: true });
      writeFileSync(join(absOut, CSS_ASSET_NAME), state.cssText);
      if (assets.length > 0) {
        mkdirSync(join(absOut, SESSION_ASSETS_DIR), { recursive: true });
        for (const { name, bytes } of assets) {
          writeFileSync(join(absOut, SESSION_ASSETS_DIR, name), bytes);
        }
      }
      return;
    }
    context.emitFile({
      type: 'asset',
      fileName: CSS_ASSET_NAME,
      source: state.cssText,
    });
    for (const { name, bytes } of assets) {
      context.emitFile({
        type: 'asset',
        fileName: `${SESSION_ASSETS_DIR}/${name}`,
        source: bytes,
      });
    }
  }

  /** Analysis is a filesystem walk, so watch mode misses edits to
   *  analyzed-but-unimported files. esbuild has no watch-file seam. */
  function registerWatchTargets(context: UnpluginBuildContext): void {
    if (meta.framework === 'esbuild') return;
    for (const path of state.watchPaths) {
      try {
        context.addWatchFile(path);
      } catch {}
    }
  }

  return {
    name: PLUGIN_NAME,
    enforce: 'pre',

    async buildStart() {
      if (rollupLike) hostResolver = pluginResolver(this);
      try {
        await startPipeline();
      } finally {
        registerWatchTargets(this);
      }
    },

    async resolveId(id, importer) {
      const virtual = resolveAnimusId(id);
      if (virtual !== null) return virtual;
      if (id.startsWith('.') && importer !== undefined && rollupLike) {
        await joinPipeline();
      }
      if (
        id.startsWith('.') &&
        importer !== undefined &&
        rollupLike &&
        state.externalPackageDirs.some((dir) =>
          isPathWithinRoot(dir, moduleFilePath(importer))
        )
      ) {
        // A kit module's import, which the package's list may misclassify.
        // Under Rollup, Rolldown and Vite, unplugin calls `resolveId` with
        // the bundler's own plugin context, which resolves.
        if (!canResolve(this)) return null;
        const resolved = await this.resolve(id, importer, { skipSelf: true });
        // An external resolution stays as another resolver leaves it.
        if (
          resolved === null ||
          resolved.external ||
          !keepsKitSourceEffects(
            moduleFilePath(resolved.id),
            state.externalPackageDirs
          )
        ) {
          return null;
        }
        const kept: ExternalIdResult & { moduleSideEffects: boolean } = {
          id: resolved.id,
          moduleSideEffects: true,
        };
        return kept;
      }
      if (
        id.startsWith('.') ||
        id.startsWith('/') ||
        id.startsWith('\0') ||
        id.startsWith('animus:')
      ) {
        return null;
      }
      // esbuild redirects in `esbuild.setup`, where the classification holds.
      if (meta.framework === 'esbuild') return null;
      await joinPipeline();
      const target = state.kitRedirects.get(id);
      if (target === undefined) return null;
      // A plain path would lose the package's `sideEffects` for the target.
      // Rollup reads `moduleSideEffects`; webpack is classified in
      // `wireWebpackLike`.
      const moduleSideEffects = state.kitSideEffects.get(id);
      if (moduleSideEffects === undefined) return target;
      const redirect: ExternalIdResult & { moduleSideEffects: boolean } = {
        id: target,
        moduleSideEffects,
      };
      return redirect;
    },

    loadInclude(id) {
      return (
        id === STYLES_VIRTUAL_ID ||
        id === PROPS_VIRTUAL_ID ||
        state.redirectTargets.has(moduleFilePath(id))
      );
    },

    async load(id) {
      if (id === STYLES_VIRTUAL_ID) {
        await joinPipeline();
        return { code: 'export {};\n', map: null };
      }
      if (id === PROPS_VIRTUAL_ID) {
        await joinPipeline();
        return { code: state.systemPropsJs, map: null };
      }
      const filePath = moduleFilePath(id);
      if (state.redirectTargets.has(filePath)) {
        // esbuild scopes plugin-resolved paths to the plugin namespace,
        // where no default filesystem loader exists.
        return { code: readFileSync(filePath, 'utf-8'), map: null };
      }
      return null;
    },

    transformInclude(id) {
      const filePath = moduleFilePath(id);
      return (
        !id.startsWith('\0') &&
        !id.startsWith('animus:') &&
        TRANSFORM_INCLUDE_RE.test(filePath) &&
        shouldClaimTransform(filePath, state)
      );
    },

    async transform(code, id) {
      await joinPipeline();
      const filePath = moduleFilePath(id);
      let output = code;
      // The key is the build a pipeline run joined; before one, there is
      // no analysis to read.
      const key = state.key;
      if (key !== null && isEngineTransformExtension(filePath)) {
        // Captured once per pipeline run: a per-module engineApi() call
        // pays a require for every module in the graph.
        const transformFile =
          state.transformFile ?? engineApi(key).transformFile;
        const transformed = transformWithEngine(output, filePath, {
          rootDir: root,
          manifestJson: getManifestJson(key) ?? '',
          transformFile,
          served: state.served,
        });
        if (transformed !== null) output = transformed;
      }
      if (needsInlineDefine) {
        const substituted = substituteDevDefine(
          output,
          state.mode === 'development'
        );
        if (substituted !== null) output = substituted;
      }
      return output === code ? null : { code: output, map: null };
    },

    buildEnd() {
      try {
        emitCssAsset(this);
      } finally {
        disposeSessionDir(state);
        releaseClaim();
      }
    },

    vite: {
      // Vite runs the normalized buildStart, so its own signals decide:
      // serving or `build.watch` runs another turn.
      configResolved(config: {
        command: string;
        build: { watch?: unknown };
        resolve: { extensions: string[] };
        assetsInclude: (file: string) => boolean;
      }) {
        hostExtensions = viteExtensionPolicy(config.resolve.extensions);
        hostAssets = viteAssetClassification(config.assetsInclude);
        const serving =
          config.command === 'serve' || Boolean(config.build.watch);
        watching = () => serving;
      },
    },

    rollup: {
      // unplugin runs this instead of the normalized buildStart.
      async buildStart(inputOptions: { plugins?: Array<{ name?: string }> }) {
        hostExtensions = rollupExtensionPolicy(
          (inputOptions?.plugins ?? []).some(
            (plugin) => plugin?.name === 'node-resolve'
          )
        );
        hostAssets = builtInAssetClassification(
          'hostOptionUnreadable',
          'rollup'
        );
        modeOracle = this.meta?.watchMode ? 'development' : 'production';
        hostResolver = pluginResolver(this);
        try {
          await startPipeline();
        } finally {
          registerWatchTargets(this);
        }
      },
    },

    webpack(compiler) {
      wireWebpackLike(compiler);
      classifyWebpackRedirects(compiler);
      compiler.hooks.normalModuleFactory.tap(PLUGIN_NAME, (nmf) => {
        nmf.hooks.beforeResolve.tap(PLUGIN_NAME, (resolveData) => {
          if (resolveData.request === TURBOPACK_SYSTEM_PROPS_ID) {
            resolveData.request = WEBPACK_PROPS_REQUEST;
          }
        });
      });
    },

    rspack(compiler) {
      wireWebpackLike(compiler);
      classifyRspackRedirects(compiler);
    },

    esbuild: {
      /** unplugin's esbuild resolve drops `moduleSideEffects` and puts the
       *  target in its own namespace, where no package classifies it. A
       *  redirect resolved here stays in the `file` namespace and carries the
       *  replaced entry's classification. */
      setup(build) {
        // A kit module's relative import, which the package's list may
        // misclassify; `pluginData` marks this hook's own resolve.
        build.onResolve({ filter: /^\./ }, async (args) => {
          if (args.pluginData === KIT_SOURCE_RESOLVE) return undefined;
          await joinPipeline();
          if (
            !state.externalPackageDirs.some((dir) =>
              isPathWithinRoot(dir, args.importer)
            )
          ) {
            return undefined;
          }
          const resolved = await build.resolve(args.path, {
            importer: args.importer,
            resolveDir: args.resolveDir,
            kind: args.kind,
            pluginData: KIT_SOURCE_RESOLVE,
          });
          // An external resolution stays as another resolver leaves it.
          if (
            resolved.errors.length > 0 ||
            resolved.external ||
            !keepsKitSourceEffects(resolved.path, state.externalPackageDirs)
          ) {
            return undefined;
          }
          return {
            path: resolved.path,
            namespace: resolved.namespace,
            suffix: resolved.suffix,
            sideEffects: true,
          };
        });
        build.onResolve({ filter: /^[^./\0]/ }, async (args) => {
          if (args.path.startsWith('animus:')) return undefined;
          // The host's `external` keeps a kit out of the bundle, redirect
          // or not, as unplugin's own esbuild resolve honours it.
          if (isEsbuildExternal(args.path, build.initialOptions.external)) {
            return undefined;
          }
          await joinPipeline();
          const target = state.kitRedirects.get(args.path);
          if (target === undefined) return undefined;
          const sideEffects = state.kitSideEffects.get(args.path);
          return sideEffects === undefined
            ? { path: target }
            : { path: target, sideEffects };
        });
      },
      config(buildOptions) {
        esbuildOptions = buildOptions;
        hostConditions = buildOptions.conditions ?? [];
        hostExtensions = esbuildExtensionPolicy(buildOptions.resolveExtensions);
        hostAssets = esbuildAssetClassification(buildOptions.loader);
        watching = () => watch;
        buildOptions.define = {
          ...buildOptions.define,
          __ANIMUS_DEV__: JSON.stringify(effectiveMode() === 'development'),
        };
      },
    },
  };

  /** Rspack's resolve data carries no rule settings, so a module rule per
   *  classification marks each redirect target, read when it resolves. */
  function classifyRspackRedirects(compiler: RspackLikeCompiler): void {
    // A source that any specifier reaches with side effects keeps them: an
    // unused pure alias of it must not drop an effect another import needs.
    const classification = (resource: string): boolean | undefined => {
      let pure = false;
      for (const [specifier, target] of state.kitRedirects) {
        if (target !== resource) continue;
        const sideEffects = state.kitSideEffects.get(specifier);
        if (sideEffects === true) return true;
        if (sideEffects === false) pure = true;
      }
      return pure ? false : undefined;
    };
    compiler.options.module.rules.push(
      {
        test: (resource: string) => classification(resource) === true,
        sideEffects: true,
      },
      {
        test: (resource: string) => classification(resource) === false,
        sideEffects: false,
      },
      // Last, so it wins: a kit module's own import of a source module the
      // package's list may misread keeps its effects, even where a pure
      // redirect reaches the same file from the application.
      {
        test: (resource: string) =>
          keepsKitSourceEffects(resource, state.externalPackageDirs),
        issuer: (issuer: string) =>
          state.externalPackageDirs.some((dir) =>
            isPathWithinRoot(dir, issuer)
          ),
        sideEffects: true,
      }
    );
  }

  /** Webpack would classify a redirect target by its own path against the
   *  package's `sideEffects`, so the replaced entry's classification is set
   *  as a rule's would be. Rspack's resolve data is not known to carry
   *  rule settings, so rspack keeps its own classification. */
  function classifyWebpackRedirects(compiler: WebpackLikeCompiler): void {
    compiler.hooks.normalModuleFactory.tap(PLUGIN_NAME, (nmf) => {
      nmf.hooks.afterResolve.tap(PLUGIN_NAME, (resolveData) => {
        const { createData } = resolveData;
        if (!createData?.settings || createData.resource === undefined) return;
        const sideEffects = state.kitSideEffects.get(resolveData.request);
        if (
          sideEffects !== undefined &&
          createData.resource === state.kitRedirects.get(resolveData.request)
        ) {
          createData.settings.sideEffects = sideEffects;
        } else if (
          keepsKitSourceEffects(
            moduleFilePath(createData.resource),
            state.externalPackageDirs
          )
        ) {
          createData.settings.sideEffects = true;
        }
      });
    });
  }

  function wireWebpackLike(compiler: WebpackLikeCompiler): void {
    modeOracle =
      compiler.options.mode === 'development' ? 'development' : 'production';
    // `...`, the bundler's own defaults, names no condition.
    hostConditions = (compiler.options.resolve?.conditionNames ?? []).filter(
      (name) => name !== '...'
    );
    hostExtensions = webpackExtensionPolicy(
      meta.framework,
      compiler.options.resolve ?? {},
      compiler.webpack?.version ?? compiler.rspack?.rspackVersion
    );
    // webpack's rules are not modelled: a conditional rule may never apply,
    // so the built-in list answers (spec §2.2 A8).
    hostAssets = builtInAssetClassification(
      'hostOptionUnreadable',
      `${meta.framework === 'rspack' ? 'rspack' : 'webpack'} rules not modelled`
    );
    watching = () => compiler.watchMode === true;
    const DefinePlugin =
      compiler.webpack?.DefinePlugin ?? compiler.rspack?.DefinePlugin;
    if (!DefinePlugin) {
      throw new Error(
        '[animus] compiler exposes no DefinePlugin — cannot supply the ' +
          '__ANIMUS_DEV__ dev-signal define'
      );
    }
    new DefinePlugin({
      __ANIMUS_DEV__: JSON.stringify(effectiveMode() === 'development'),
    }).apply(compiler);
    // buildEnd maps to the emit hook here, which a failed compilation
    // never reaches.
    compiler.hooks.done.tap(PLUGIN_NAME, () => {
      disposeSessionDir(state);
      releaseClaim();
    });
    compiler.hooks.failed?.tap(PLUGIN_NAME, () => {
      disposeSessionDir(state);
      releaseClaim();
    });
    // A watch closed mid-compile fires neither: the build retires here.
    compiler.hooks.watchClose?.tap(PLUGIN_NAME, () => {
      disposeSessionDir(state);
      releaseClaim();
    });
  }
};
