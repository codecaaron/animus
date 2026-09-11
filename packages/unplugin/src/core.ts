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

/** Extension-free: esbuild picks loaders by extension. No `\0` prefix:
 *  webpack's virtual-module bridge requires plain ids. */
export const STYLES_VIRTUAL_ID = 'animus:styles';

export const PROPS_VIRTUAL_ID = 'animus:system-props';

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
    if (!state.sessionDir) {
      state.sessionDir = getSessionArtifactDir();
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
  if (id === TURBOPACK_SYSTEM_PROPS_ID) return PROPS_VIRTUAL_ID;
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
  }
): string | null {
  const filename = relative(ctx.rootDir, resolve(id)).split('\\').join('/');
  const result = ctx.transformFile(code, filename, ctx.manifestJson);
  return result.hasComponents ? result.code : null;
}

function moduleFilePath(id: string): string {
  const query = id.indexOf('?');
  return query === -1 ? id : id.slice(0, query);
}

interface EsbuildOptionsLike {
  outdir?: string;
  outfile?: string;
  absWorkingDir?: string;
  write?: boolean;
  define?: Record<string, string>;
}

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

export const unpluginFactory: UnpluginFactory<
  AnimusUnpluginOptions | undefined
> = (rawOptions, meta) => {
  const { root, options } = resolveHostOptions(rawOptions);
  const state = createHostState();
  let activeSession: ExtractionSession | null = null;
  let modeOracle: AnimusMode | null = null;
  let esbuildOptions: EsbuildOptionsLike | null = null;
  /** Hooks can fire before buildStart (webpack's make taps run
   *  concurrently), so joiners await this before awaiting the pipeline. */
  let signalPipelineStarted!: () => void;
  const pipelineStarted = new Promise<void>((res) => {
    signalPipelineStarted = res;
  });

  const effectiveMode = (): AnimusMode =>
    resolveHostMode(options.mode, modeOracle);

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

  function releaseClaim(): void {
    activeSession?.close();
    activeSession = null;
  }

  async function runClaimedPipeline(): Promise<void> {
    await drivePipeline(state, async () => {
      const mode = effectiveMode();
      state.mode = mode;
      const session = new ExtractionSession({ ...options, mode });
      activeSession = session;
      session.driverLabel = 'animus-unplugin';
      session.rootDir = root;
      session.systemPropsModuleId = TURBOPACK_SYSTEM_PROPS_ID;
      const aliasPairs = readTsconfigAliasPairs(root);
      const builtAliases = buildPathAliasesJson(aliasPairs, root);
      if (builtAliases) {
        session.pathAliasesJson = builtAliases.json;
      }
      await session.runFullPipeline();
      state.sessionDir = getSessionArtifactDir();
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
      await startPipeline();
      registerWatchTargets(this);
    },

    async resolveId(id) {
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
      if (isEngineTransformExtension(filePath)) {
        // Captured once per pipeline run: a per-module engineApi() call
        // pays a require for every module in the graph.
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
      try {
        emitCssAsset(this);
      } finally {
        disposeSessionDir(state);
        releaseClaim();
      }
    },

    rollup: {
      // unplugin runs this instead of the normalized buildStart.
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
        buildOptions.define = {
          ...buildOptions.define,
          __ANIMUS_DEV__: JSON.stringify(effectiveMode() === 'development'),
        };
      },
    },
  };

  function wireWebpackLike(compiler: WebpackLikeCompiler): void {
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
  }
};
