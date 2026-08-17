/**
 * The Animus transform host core (openspec: standalone-extraction-cli,
 * D4 under D10): an unplugin factory that drives the ONE
 * `ExtractionSession` at buildStart inside the consumer's bundler process
 * and serves per-file transforms from retained engine state. No artifacts,
 * no lock, no staleness protocol — analysis failure IS build failure,
 * never a passthrough (the session's strict/policy seams carry this).
 *
 * Ported from the winning DEF-1 prototype arm
 * (e2e/rollup-app/prototype/animus-t0-plugin.mjs), productized per the
 * inc 05 packet: the emitted CSS reaches the consumer as a real asset
 * (NS3 — the prototype's CSS-as-string module was measurement
 * scaffolding), `__ANIMUS_DEV__` goes through each adapter's define
 * mechanism, kit-specifier redirects come from the session's discovery
 * output (the Turbopack alias assembly generalized), and the session
 * directory is cleaned on success AND failure (inc 04 rider F6).
 *
 * ORDERING CONTRACT: the host transform must run before any TS/JSX
 * transpilation — the engine parses raw TSX. `enforce: 'pre'` covers
 * webpack/rspack; rollup consumers must list this plugin before their
 * transpiler (see the e2e/rollup-app lane config).
 */

import {
  buildPathAliasesJson,
  ENGINE_TRANSFORM_EXTENSIONS,
  isEngineTransformExtension,
  isPathWithinRoot,
  readTsconfigAliasPairs,
} from '@animus-ui/extract/pipeline';
import {
  ANIMUS_CSS_MODULE_ID,
  collectSessionAssets,
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
import type { AnimusMode } from '@animus-ui/extract/pipeline';
import type { UnpluginBuildContext, UnpluginFactory } from 'unplugin';

/** Resolved virtual id of the stylesheet import. Deliberately
 *  extension-free: esbuild guesses loaders from extensions, and this
 *  module is a JS stub in every bundler — the CSS itself is delivered as
 *  an emitted asset, never as a module (NS3). No `\0` prefix: webpack's
 *  virtual-module bridge requires plain ids. */
export const STYLES_VIRTUAL_ID = 'animus:styles';

/** Resolved virtual id of the emitted system-props runtime module. */
export const PROPS_VIRTUAL_ID = 'animus:system-props';

/** File name of the emitted stylesheet asset. */
export const CSS_ASSET_NAME = 'animus.css';

/** Files the transform hook claims at all — the ONE shared engine-transform
 *  file class (tested through `isEngineTransformExtension` below) WIDENED by
 *  `.cjs` for define substitution alone: a `.cjs` module carries no builder
 *  chains for the engine to rewrite but may read the dev-signal token. */
const TRANSFORM_INCLUDE_RE = new RegExp(
  `\\.(?:${[...ENGINE_TRANSFORM_EXTENSIONS, 'cjs'].join('|')})$`
);

/** Bare dev-signal token, assignment-guarded like @rollup/plugin-replace's
 *  `preventAssignment` — `__ANIMUS_DEV__ = x` is left alone. */
const DEV_DEFINE_RE = /\b__ANIMUS_DEV__\b(?!\s*=[^=])/g;

/** Mutable per-build host state (one per factory invocation). */
export interface HostState {
  /** The in-flight (or settled) analysis; transforms and loads await it. */
  pipeline: Promise<void> | null;
  /** Resolved emission mode of the current build. */
  mode: AnimusMode | null;
  /** Assembled stylesheet of the published analysis ('' until published). */
  cssText: string;
  /** Emitted system-props runtime module source. */
  systemPropsJs: string;
  /** Kit specifier → absolute analyzed source entry (discovery output). */
  kitRedirects: Map<string, string>;
  /** Absolute analyzed entries (values of kitRedirects) — load allowlist. */
  redirectTargets: Set<string>;
  /** Admitted external package dirs (discovery output) — the ONLY
   *  node_modules subtrees the transform claims. */
  externalPackageDirs: string[];
  /** Absolute paths of the ANALYSIS UNIVERSE — every analyzed source file
   *  plus the system module's evaluated dependencies, asset() files, and
   *  the tsconfig alias source. Registered with the bundler's watcher: the
   *  session analyzes a filesystem walk, not the module graph, so an edit
   *  to an analyzed-but-unimported file must still trigger a rebuild. */
  watchPaths: string[];
  /** The engine adapter's transformFile, resolved once per pipeline run —
   *  never per module. */
  transformFile:
    | ((
        source: string,
        path: string,
        manifestJson: string
      ) => { code: string; hasComponents: boolean })
    | null;
  /** Session artifact directory awaiting cleanup, or null. */
  sessionDir: string | null;
}

export function createHostState(): HostState {
  return {
    pipeline: null,
    mode: null,
    cssText: '',
    systemPropsJs: '',
    kitRedirects: new Map(),
    redirectTargets: new Set(),
    externalPackageDirs: [],
    watchPaths: [],
    transformFile: null,
    sessionDir: null,
  };
}

/**
 * The transform-claim predicate over module paths. The analysis universe
 * deliberately excludes node_modules (external kits ride their own
 * collection path), so the transform must too — the Next webpack rule's
 * exclude, ported: without it every dependency module in the graph is
 * routed through the engine, scaling build time with dependency-graph size
 * instead of source-file count. node_modules paths are claimed only when
 * they belong to an ADMITTED external package (or are a kit redirect
 * target) — those carry builder chains the engine must rewrite. Such files
 * only enter the module graph after discovery published (their specifiers
 * resolve through the pipeline-gated kitRedirects), so consulting captured
 * state here is race-free.
 */
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

/** Remove the one-shot session tree; idempotent, runs on success AND
 *  failure paths (inc 04 rider F6). */
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

/**
 * Run one pipeline attempt through the shared drive loop, recording it as
 * `state.pipeline` for hook joiners. A failed attempt disposes the session
 * directory before rethrowing — the consumer's build fails; nothing leaks.
 */
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
    // The session publishes its artifact dir at pipeline START (before
    // analysis), while the success path records it only AFTER the await —
    // so on failure the recorded dir is still null and cleanup would
    // no-op, leaking a session tree per failed build (inc 05 review B1).
    // Recover it from the singleton before disposing.
    if (!state.sessionDir) {
      state.sessionDir = getSessionArtifactDir();
    }
    disposeSessionDir(state, removeDir);
    throw error;
  }
}

/**
 * Map an import id onto the host's CONSTANT resolution family: the
 * stylesheet id and the system-props id — the mappings that answer without
 * the pipeline. Kit-specifier redirects are the caller's second step (they
 * exist only after discovery published, behind the pipeline join).
 */
export function resolveAnimusId(id: string): string | null {
  if (id === ANIMUS_CSS_MODULE_ID || id.endsWith(`/${ANIMUS_CSS_MODULE_ID}`)) {
    return STYLES_VIRTUAL_ID;
  }
  if (id === STYLES_VIRTUAL_ID || id === PROPS_VIRTUAL_ID) return id;
  if (id === TURBOPACK_SYSTEM_PROPS_ID) return PROPS_VIRTUAL_ID;
  return null;
}

/**
 * Substitute the bare `__ANIMUS_DEV__` token with its boolean literal —
 * the define mechanism for bundlers without a native one (rollup). The
 * token-as-initializer-conditional shape in the system runtime's is-dev
 * module folds under the bundler's own dead-branch elimination once the
 * literal lands. Returns null when the code carries no token.
 */
export function substituteDevDefine(
  code: string,
  isDev: boolean
): string | null {
  if (!code.includes('__ANIMUS_DEV__')) return null;
  return code.replace(DEV_DEFINE_RE, isDev ? 'true' : 'false');
}

/**
 * Per-file engine transform from retained state. The path handed to the
 * engine is the rootDir-relative posix key the analysis used — external
 * kit sources ride the same derivation (`../…` keys). Files outside the
 * analysis universe come back unchanged (`hasComponents: false`); a
 * transform before analysis fails loud inside the engine adapter.
 */
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
  }
): string | null {
  const filename = relative(ctx.rootDir, resolve(id)).split('\\').join('/');
  const result = ctx.transformFile(code, filename, ctx.manifestJson);
  return result.hasComponents ? result.code : null;
}

/** Strip a bundler query suffix (`?worker`, webpack resource queries). */
function moduleFilePath(id: string): string {
  const query = id.indexOf('?');
  return query === -1 ? id : id.slice(0, query);
}

/** Structural view of the esbuild options the host reads/writes. */
interface EsbuildOptionsLike {
  outdir?: string;
  outfile?: string;
  absWorkingDir?: string;
  write?: boolean;
  define?: Record<string, string>;
}

/** Structural view of a webpack/rspack compiler — enough for the define
 *  plugin and the failure-path cleanup taps, without a bundler type dep. */
interface WebpackLikeCompiler {
  options: { mode?: string };
  webpack?: {
    DefinePlugin?: new (defs: Record<string, string>) => WebpackLikeApplied;
  };
  rspack?: {
    DefinePlugin?: new (defs: Record<string, string>) => WebpackLikeApplied;
  };
  hooks: {
    done: { tap: (name: string, fn: () => void) => void };
    failed?: { tap: (name: string, fn: () => void) => void };
  };
}
interface WebpackLikeApplied {
  apply: (compiler: WebpackLikeCompiler) => void;
}

const PLUGIN_NAME = 'animus-host';

/**
 * The unplugin factory. One factory invocation = one host = one session
 * per build; the singleton drive loop stays exactly-one (guardrail G1 —
 * the host defines no session class and no drive loop of its own).
 */
export const unpluginFactory: UnpluginFactory<
  AnimusUnpluginOptions | undefined
> = (rawOptions, meta) => {
  const { root, options } = resolveHostOptions(rawOptions);
  const state = createHostState();
  /** The session this build publishes through, or null outside a build.
   *  One live host per process is the SESSION's own claim (taken by its
   *  first pipeline); closing it here is what makes the host's sequential
   *  rebuilds legal. */
  let activeSession: ExtractionSession | null = null;
  /** Adapter-supplied command oracle (null = no bundler signal). */
  let modeOracle: AnimusMode | null = null;
  let esbuildOptions: EsbuildOptionsLike | null = null;
  /** Resolves once buildStart has begun — hooks that can fire before the
   *  bundler-parallel buildStart (webpack's make taps run concurrently)
   *  wait on this, then join the pipeline itself. */
  let signalPipelineStarted!: () => void;
  const pipelineStarted = new Promise<void>((res) => {
    signalPipelineStarted = res;
  });

  const effectiveMode = (): AnimusMode =>
    resolveHostMode(options.mode, modeOracle);

  /** The define is supplied natively where the bundler has a mechanism
   *  (esbuild define, webpack/rspack DefinePlugin); everywhere else the
   *  transform substitutes the token itself. */
  const needsInlineDefine =
    meta.framework !== 'esbuild' &&
    meta.framework !== 'webpack' &&
    meta.framework !== 'rspack';

  async function startPipeline(): Promise<void> {
    signalPipelineStarted();
    try {
      await runClaimedPipeline();
    } catch (error) {
      releaseClaim();
      throw error;
    }
  }

  /** Close the build's session wherever its directory is disposed —
   *  including the failure path above, where drivePipeline disposes before
   *  rethrowing. The next build (a watch rebuild) then claims cleanly. */
  function releaseClaim(): void {
    activeSession?.close();
    activeSession = null;
  }

  async function runClaimedPipeline(): Promise<void> {
    await drivePipeline(state, async () => {
      const mode = effectiveMode();
      state.mode = mode;
      // Emission inputs plumbed explicitly (D10 / the inc 04 pinned-mode
      // parity lesson): the session receives the resolved mode — it never
      // sniffs the environment on this driver's behalf.
      const session = new ExtractionSession({ ...options, mode });
      // Recorded BEFORE the pipeline: a failed run must still close the
      // session that already claimed publication ownership.
      activeSession = session;
      session.driverLabel = 'animus-unplugin';
      session.rootDir = root;
      // Emit the virtual system-props id (the session vocabulary) instead
      // of the default absolute session path, so emitted imports resolve
      // in-process through this host's resolveId.
      session.systemPropsModuleId = TURBOPACK_SYSTEM_PROPS_ID;
      // No live bundler alias surface to harvest across four bundlers —
      // tsconfig `paths` are this driver's alias source (CLI parity).
      const aliasPairs = readTsconfigAliasPairs(root);
      const builtAliases = buildPathAliasesJson(aliasPairs, root);
      if (builtAliases) {
        session.pathAliasesJson = builtAliases.json;
      }
      await session.runFullPipeline();
      state.sessionDir = getSessionArtifactDir();
      // Silent-empty success is impossible on any driver (NS2): a build
      // over zero discovered files would bundle a fully unstyled app with
      // green exit — fail it, naming the effective root.
      const analyzed = getAnalyzedHashes();
      if (!analyzed || analyzed.size === 0) {
        throw new Error(
          `[animus] discovery found zero source files under ${root} — ` +
            `check the plugin's \`root\` and \`exclude\` options`
        );
      }
      state.cssText = getSharedCss();
      state.systemPropsJs = getSharedSystemProps();
      state.kitRedirects = new Map(session.externalSourceEntries);
      state.redirectTargets = new Set(state.kitRedirects.values());
      state.externalPackageDirs = [...session.externalPackageDirs];
      // The rebuild-trigger set for watch mode: analyzed sources (keyed
      // root-relative by the session), the system module's evaluated
      // dependency closure, asset() source files, and the tsconfig the
      // alias pairs were harvested from.
      const watchPaths = new Set<string>();
      for (const key of getAnalyzedHashes()?.keys() ?? []) {
        watchPaths.add(resolve(root, key));
      }
      for (const dep of session.systemDependencyPaths) watchPaths.add(dep);
      for (const dep of session.assetDependencyPaths) watchPaths.add(dep);
      watchPaths.add(join(root, 'tsconfig.json'));
      state.watchPaths = [...watchPaths];
      state.transformFile = engineApi().transformFile;
    });
  }

  /** Join the analysis: every serving hook waits for buildStart to have
   *  begun, then for the pipeline to have published. A rejected pipeline
   *  rejects every joiner — analysis failure is build failure, never a
   *  passthrough. */
  async function joinPipeline(): Promise<void> {
    await pipelineStarted;
    await state.pipeline;
  }

  function emitCssAsset(context: UnpluginBuildContext): void {
    if (!state.cssText) return;
    // Snapshot before disposal — buildEnd's finally removes the session
    // tree these bytes live in.
    const assets = collectSessionAssets(state.sessionDir);
    if (meta.framework === 'esbuild') {
      // unplugin's esbuild emitFile silently no-ops without `outdir`; the
      // stylesheet is the product, so the host writes it itself: outdir,
      // else beside outfile, else a loud skip (nothing to write against).
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
        // The caller asked esbuild for NO file writes; a plugin-side disk
        // write would violate that, and esbuild gives buildEnd no seam to
        // append to `result.outputFiles`. Fail loud instead of shipping a
        // silently unstyled in-memory bundle.
        console.warn(
          `[animus] esbuild \`write: false\` build — the extracted ` +
            `stylesheet (${CSS_ASSET_NAME}) and its asset files were NOT ` +
            `produced (no in-memory output seam); use \`write: true\` or ` +
            `the standalone \`animus build\` CLI for in-memory pipelines`
        );
        return;
      }
      // esbuild resolves a relative outdir against absWorkingDir (its own
      // default: cwd) — mirror that, and create the tree: under a plugin
      // the directory may not exist yet at buildEnd.
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

  /** Register the analysis universe with the bundler's watcher — the
   *  session analyzes a filesystem WALK, so watch mode misses edits to
   *  analyzed-but-unimported files (and tsconfig/system deps) without
   *  this. esbuild has no per-plugin watch-file seam; its rebuilds rely on
   *  the module graph alone. */
  function registerWatchTargets(context: UnpluginBuildContext): void {
    if (meta.framework === 'esbuild') return;
    for (const path of state.watchPaths) {
      try {
        context.addWatchFile(path);
      } catch {
        // Non-watch build or an adapter without the seam — nothing to arm.
      }
    }
  }

  return {
    name: PLUGIN_NAME,
    // The engine parses raw TSX: this transform precedes transpilation.
    // enforce:pre orders webpack/rspack loader chains; rollup consumers
    // order plugins in config (host first).
    enforce: 'pre',

    async buildStart() {
      await startPipeline();
      registerWatchTargets(this);
    },

    async resolveId(id) {
      // The virtual ids answer without the pipeline (constant mapping);
      // kit redirects exist only after discovery published.
      const virtual = resolveAnimusId(id);
      if (virtual !== null) return virtual;
      if (
        id.startsWith('.') ||
        id.startsWith('/') ||
        id.startsWith('\0') ||
        id.startsWith('animus:')
      ) {
        return null;
      }
      // Bare specifier: it may be an admitted kit — those must resolve to
      // the exact entry extraction analyzed, not the published dist.
      await joinPipeline();
      return state.kitRedirects.get(id) ?? null;
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
        // JS stub: the import resolves in-process; the stylesheet itself
        // is delivered as an emitted asset, not a module (NS3).
        await joinPipeline();
        return { code: 'export {};\n', map: null };
      }
      if (id === PROPS_VIRTUAL_ID) {
        await joinPipeline();
        return { code: state.systemPropsJs, map: null };
      }
      const filePath = moduleFilePath(id);
      if (state.redirectTargets.has(filePath)) {
        // Serve redirected kit entries from disk ourselves: esbuild scopes
        // plugin-resolved paths to the plugin's namespace, where no default
        // filesystem loader exists. Bytes are identical to an fs load.
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
      if (isEngineTransformExtension(filePath)) {
        // The engine adapter is resolved ONCE per pipeline run (captured in
        // startPipeline) — a per-module engineApi() call paid a require +
        // six closure allocations for every module in the graph. The
        // fallback keeps the fail-loud contract for any path that reaches
        // here without a capture.
        const transformFile = state.transformFile ?? engineApi().transformFile;
        const transformed = transformWithEngine(output, filePath, {
          rootDir: root,
          manifestJson: getManifestJson() ?? '',
          transformFile,
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
      // Runs on success and failure alike in every adapter that reaches
      // it; emission is gated on a published stylesheet, cleanup is
      // unconditional (rider F6 — the buildStart catch and the
      // webpack/rspack done/failed taps cover the paths that skip this).
      try {
        emitCssAsset(this);
      } finally {
        disposeSessionDir(state);
        releaseClaim();
      }
    },

    rollup: {
      // Replaces the normalized buildStart for rollup only: rollup's
      // command oracle (watch mode) lives on its own plugin context meta.
      async buildStart() {
        modeOracle = this.meta?.watchMode ? 'development' : 'production';
        await startPipeline();
        registerWatchTargets(this);
      },
    },

    webpack(compiler) {
      wireWebpackLike(compiler);
    },

    rspack(compiler) {
      wireWebpackLike(compiler);
    },

    esbuild: {
      config(buildOptions) {
        esbuildOptions = buildOptions;
        // esbuild exposes no dev/serve signal to plugins: the documented
        // default (production) stands unless `mode` is explicit.
        buildOptions.define = {
          ...buildOptions.define,
          __ANIMUS_DEV__: JSON.stringify(effectiveMode() === 'development'),
        };
      },
    },
  };

  function wireWebpackLike(compiler: WebpackLikeCompiler): void {
    // The bundler's own command oracle (the Vite plugin's config.command
    // pattern): explicit `mode` still wins inside effectiveMode().
    modeOracle =
      compiler.options.mode === 'development' ? 'development' : 'production';
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
    // Failure-path cleanup (rider F6): the normalized buildEnd maps to the
    // emit hook here, which a failed compilation never reaches.
    compiler.hooks.done.tap(PLUGIN_NAME, () => {
      disposeSessionDir(state);
      releaseClaim();
    });
    compiler.hooks.failed?.tap(PLUGIN_NAME, () => {
      disposeSessionDir(state);
      releaseClaim();
    });
  }
};
