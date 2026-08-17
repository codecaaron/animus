import { isJsonObject, parseJsonObject } from '@animus-ui/assertions';
import { RETIRED_ENGINE_MESSAGE } from '@animus-ui/extract/pipeline';
/**
 * Behavior pins for AnimusWebpackPlugin (src/plugin.ts) ahead of refactor.
 *
 * The NAPI boundary (engineApi: loadSystemModule / analyzeProject /
 * clearAnalysisCache) is mocked; the pure pipeline helpers from
 * `@animus-ui/extract/pipeline` (assembleStylesheet, applyUnitFallback,
 * extractSystemFilePackages, ...) and the singleton shared-state
 * getters/setters run for real. Every assertion targets observable
 * behavior: files written, globalThis state, mock call counts and args,
 * CSS content — never internal method names.
 */
import { readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ExtractionSession } from '../../extract/session/extraction-session';
import { sessionArtifactDir } from '../../extract/session/session-paths';
import { getManifestJson, getSharedCss } from '../../extract/session/singleton';
import { AnimusWebpackPlugin } from '../src/plugin';
import {
  BUTTON_SOURCE,
  BUTTON_STYLE_EDIT as BUTTON_SOURCE_CHANGED,
  createProject as createFixtureProject,
  disposeTempRoots,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from './singleton-fixtures';

import type { AnimusNextOptions } from '../src/types';
import type { JsonObject, JsonValue } from '@animus-ui/assertions';
import type {
  AnalyzeProjectArgs,
  ManifestDiagnostic,
} from '@animus-ui/extract/pipeline';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn<(...args: AnalyzeProjectArgs) => string>(),
  clearAnalysisCache: vi.fn(),
}));

import { setEngineApiOverride } from '../../extract/session/singleton';

// Engine API injection through the singleton's globalThis-keyed test
// seam — reaches every copy of the module (source or dist), which a
// module mock cannot.
setEngineApiOverride(() => ({
  extractFacts: () => '{"files":{},"parseCount":0}',
  loadSystemModule: mocks.loadSystemModule,
  analyzeProject: mocks.analyzeProject,
  clearAnalysisCache: mocks.clearAnalysisCache,
}));

let restoreGlobals: () => void;

const SYSTEM_SOURCE = 'export const system = { space: [0, 4, 8] };\n';
const SYSTEM_SOURCE_CHANGED =
  'export const system = { space: [0, 4, 8, 16] };\n';

/** Component CSS returned by the analyzeProject mock; mutable per test. */
let nextComponentCss = '.btn{margin:8;}';

interface ManifestOverrides {
  diagnostics?: ManifestDiagnostic[];
}

function buildManifest(overrides: ManifestOverrides = {}): string {
  return JSON.stringify({
    css: nextComponentCss,
    sheets: { global: '@layer anm-global{body{margin:0}}' },
    system_prop_map: { m: 'margin' },
    // Verbatim manifest spelling: `DynamicPropMeta` serializes camelCase, with
    // absent transforms as `null` and an empty scale map as `{}`.
    dynamic_props: {
      color: {
        varName: '--anm-color',
        slotClass: 'anm-color-slot',
        property: 'color',
        transformName: 'toColor',
        transformFnSource: null,
        scaleValues: { primary: '#00f' },
      },
      p: {
        varName: '--anm-p',
        slotClass: 'anm-p-slot',
        property: 'padding',
        transformName: null,
        transformFnSource: null,
        scaleValues: {},
      },
    },
    diagnostics: [],
    ...overrides,
  });
}

beforeEach(() => {
  restoreGlobals = resetAnimusGlobals();
  nextComponentCss = '.btn{margin:8;}';
  mocks.loadSystemModule.mockReset().mockReturnValue({ ...SYSTEM_CONFIG });
  mocks.analyzeProject.mockReset().mockImplementation(() => buildManifest());
  mocks.clearAnalysisCache.mockReset();
});

afterEach(() => {
  restoreGlobals();
  vi.restoreAllMocks();
  disposeTempRoots();
});

function createProject(): string {
  return createFixtureProject('animus-next-pipeline-');
}

const OPTIONS: AnimusNextOptions = { system: './src/system.ts' };

class FakeRawSource {
  private readonly content: string;
  constructor(content: string) {
    this.content = content;
  }
  source(): string {
    return this.content;
  }
  size(): number {
    return this.content.length;
  }
}

type PluginCompiler = Parameters<AnimusWebpackPlugin['apply']>[0];
type AsyncHandler = Parameters<PluginCompiler['hooks']['run']['tapPromise']>[1];
type CompilationHandler = Parameters<
  PluginCompiler['hooks']['compilation']['tap']
>[1];
type ThisCompilationHandler = Parameters<
  PluginCompiler['hooks']['thisCompilation']['tap']
>[1];
type PluginCompilation = Parameters<CompilationHandler>[0];
type ProcessAssetsTap = PluginCompilation['hooks']['processAssets']['tap'];
type ProcessAssetsOptions = Parameters<ProcessAssetsTap>[0];
type ProcessAssetsHandler = Parameters<ProcessAssetsTap>[1];
type WebpackSource = Parameters<PluginCompilation['updateAsset']>[1];

function createCompiler(
  root: string,
  extras: { name?: string; alias?: Record<string, string> } = {}
) {
  const runHandlers: AsyncHandler[] = [];
  const watchRunHandlers: AsyncHandler[] = [];
  const compilationHandlers: CompilationHandler[] = [];
  const thisCompilationHandlers: ThisCompilationHandler[] = [];
  const compiler: PluginCompiler = {
    hooks: {
      run: {
        tapPromise: (_name: string, fn: AsyncHandler) => {
          runHandlers.push(fn);
        },
      },
      watchRun: {
        tapPromise: (_name: string, fn: AsyncHandler) => {
          watchRunHandlers.push(fn);
        },
      },
      compilation: {
        tap: (_name: string, fn: CompilationHandler) => {
          compilationHandlers.push(fn);
        },
      },
      thisCompilation: {
        tap: (_name: string, fn: ThisCompilationHandler) => {
          thisCompilationHandlers.push(fn);
        },
      },
    },
    context: root,
    options: { name: extras.name, resolve: { alias: extras.alias } },
    webpack: {
      Compilation: { PROCESS_ASSETS_STAGE_ADDITIONAL: -100 },
      sources: { RawSource: FakeRawSource },
      // Minimal model of webpack 5's NormalModule compilation hooks — the
      // plugin's runtime existence check (design D7) requires it.
      NormalModule: {
        getCompilationHooks: () => ({
          needBuild: { tapAsync: () => {} },
        }),
      },
    },
  };
  return {
    compiler,
    runHandlers,
    watchRunHandlers,
    compilationHandlers,
    thisCompilationHandlers,
  };
}

function applyPlugin(
  plugin: AnimusWebpackPlugin,
  compiler: PluginCompiler
): void {
  plugin.apply(compiler);
}

function createCompilation(assetNames: string[]) {
  const assets = new Map<string, WebpackSource>(
    assetNames.map((name) => [name, new FakeRawSource('/* stub */')])
  );
  const taps: Array<{
    options: ProcessAssetsOptions;
    fn: ProcessAssetsHandler;
  }> = [];
  const compilation: PluginCompilation = {
    hooks: {
      processAssets: {
        tap: (options, fn) => {
          taps.push({ options, fn });
        },
      },
    },
    fileDependencies: new Set<string>(),
    missingDependencies: new Set<string>(),
    contextDependencies: new Set<string>(),
    getAsset: (name: string) => {
      const source = assets.get(name);
      return source ? { source } : undefined;
    },
    updateAsset: (name: string, source: WebpackSource) => {
      assets.set(name, source);
    },
  };
  return { compilation, taps, assets };
}

/** Session-scoped artifact path for a plugin's (process-claimed) session. */
function artifactPath(
  root: string,
  plugin: AnimusWebpackPlugin,
  name: string
): string {
  return join(sessionArtifactDir(root, plugin.sessionId), name);
}

function analyzeCall(index: number): AnalyzeProjectArgs {
  const call = mocks.analyzeProject.mock.calls[index];
  if (!call) throw new Error(`Missing analyzeProject call ${index}`);
  return call;
}

interface AnalyzeFileFixture {
  path: string;
  source: string;
  hash?: string;
}

function parseRequiredJsonObject(
  json: string | null,
  label: string
): JsonObject {
  if (json === null) throw new Error(`${label} must be present`);
  return parseJsonObject(json, label);
}

function readJsonString(
  object: JsonObject,
  key: string,
  label: string
): string {
  const value = object[key];
  if (String(value) !== value) {
    throw new Error(`${label}.${key} must be a string`);
  }
  return String(value);
}

function parseFiles(args: AnalyzeProjectArgs): AnalyzeFileFixture[] {
  const parsed: JsonValue = JSON.parse(args[0]);
  if (!Array.isArray(parsed)) {
    throw new Error('analyzeProject files must be a JSON array');
  }
  return parsed.map((entry, index) => {
    if (!isJsonObject(entry)) {
      throw new Error(`analyzeProject files[${index}] must be an object`);
    }
    const file: AnalyzeFileFixture = {
      path: readJsonString(entry, 'path', `analyzeProject files[${index}]`),
      source: readJsonString(entry, 'source', `analyzeProject files[${index}]`),
    };
    if (entry.hash !== undefined) {
      file.hash = readJsonString(
        entry,
        'hash',
        `analyzeProject files[${index}]`
      );
    }
    return file;
  });
}

function analyzeResult(index: number): string {
  const result = mocks.analyzeProject.mock.results[index];
  if (!result || result.type !== 'return') {
    throw new Error(`analyzeProject call ${index} did not return`);
  }
  return result.value;
}

function readEpoch(path: string): string {
  return readJsonString(
    parseJsonObject(readFileSync(path, 'utf-8'), 'replacement epoch'),
    'epoch',
    'replacement epoch'
  );
}

describe('AnimusWebpackPlugin.apply', () => {
  test('skips the edge-server compiler entirely', () => {
    const root = createProject();
    const { compiler, runHandlers, watchRunHandlers, compilationHandlers } =
      createCompiler(root, { name: 'edge-server' });

    applyPlugin(new AnimusWebpackPlugin(OPTIONS), compiler);

    expect(runHandlers).toHaveLength(0);
    expect(watchRunHandlers).toHaveLength(0);
    expect(compilationHandlers).toHaveLength(0);
  });

  test('registers compilation, run, and watchRun hooks on other compilers', () => {
    const root = createProject();
    const { compiler, runHandlers, watchRunHandlers, compilationHandlers } =
      createCompiler(root, { name: 'server' });

    applyPlugin(new AnimusWebpackPlugin(OPTIONS), compiler);

    expect(runHandlers).toHaveLength(1);
    expect(watchRunHandlers).toHaveLength(1);
    expect(compilationHandlers).toHaveLength(1);
  });
});

describe('production run (full pipeline)', () => {
  test('loads the system once, analyzes with devMode=false, and forwards system/alias config', async () => {
    const root = createProject();
    const alias = {
      '@components': join(root, 'src', 'components'),
      '@sys': join(root, 'src', 'system.ts'),
      '.animus/styles.css': join(root, '.animus', 'styles.css'),
    };
    const { compiler, runHandlers } = createCompiler(root, { alias });
    const plugin = new AnimusWebpackPlugin(OPTIONS);
    applyPlugin(plugin, compiler);

    await runHandlers[0](compiler);

    expect(mocks.clearAnalysisCache).toHaveBeenCalledTimes(1);
    expect(mocks.loadSystemModule).toHaveBeenCalledTimes(1);
    expect(mocks.loadSystemModule).toHaveBeenCalledWith(
      join(root, 'src', 'system.ts'),
      root
    );
    expect(mocks.analyzeProject).toHaveBeenCalledTimes(1);

    const args = analyzeCall(0);
    // Positional NAPI contract (buildAnalyzeProjectArgs, @animus-ui/extract/pipeline)
    expect(args[1]).toBe(SYSTEM_CONFIG.scalesJson);
    expect(args[2]).toBe(SYSTEM_CONFIG.variableMapJson);
    expect(args[3]).toBeNull();
    expect(args[4]).toBe(SYSTEM_CONFIG.propConfig);
    expect(args[5]).toBe(SYSTEM_CONFIG.groupRegistry);
    expect(args[6]).toBe('{}'); // no external packages resolved
    expect(args[7]).toBe(false); // production devMode
    expect(parseRequiredJsonObject(args[8], 'emitter config')).toEqual({
      runtime_import: '@animus-ui/system/runtime',
      css_module_id: '.animus/styles.css',
      system_props_module_id: artifactPath(root, plugin, 'system-props.js'),
    });
    expect(args[9]).toBeNull();
    expect(args[10]).toBeNull();
    expect(args[11]).toBeNull();
    // Webpack resolve.alias translated to path aliases (own .animus alias skipped,
    // longest pattern first, prefix aliases get trailing slashes)
    expect(parseRequiredJsonObject(args[12], 'path aliases')).toEqual({
      aliases: [
        {
          pattern: '@components/',
          replacement: 'src/components/',
          type: 'prefix',
        },
        { pattern: '@sys', replacement: 'src/system.ts', type: 'exact' },
      ],
    });
    expect(args[13]).toBeNull();

    // Discovered files ride along with full source + md5 hash
    const files = parseFiles(args);
    expect(files.map((f) => f.path).sort()).toEqual([
      'src/Button.tsx',
      'src/system.ts',
    ]);
    const button = files.find((f) => f.path === 'src/Button.tsx');
    expect(button?.source).toBe(BUTTON_SOURCE);
    expect(button?.hash).toMatch(/^[0-9a-f]{32}$/);
  });

  test('an offline system-props change moves the replacement epoch', async () => {
    // The epoch is webpack's persistent-cache witness: restored modules
    // import the building session's system-props.js. A group-registry
    // change while the server is down alters that module's content WITHOUT
    // touching any replacement, so the epoch must still move — an equal
    // epoch would keep restored modules bound to the dead session's stale
    // artifact.
    const root = createProject();
    const session = new ExtractionSession(OPTIONS);
    session.rootDir = root;
    await session.runFullPipeline();
    const epochPath = join(
      sessionArtifactDir(root, session.sessionId),
      'replacements-epoch'
    );
    const before = readEpoch(epochPath);

    mocks.loadSystemModule.mockReturnValue({
      ...SYSTEM_CONFIG,
      groupRegistry: '{"typography":{"props":["fontSize"]}}',
    });
    await session.runFullPipeline();
    expect(readEpoch(epochPath)).not.toBe(before);
  });

  test('writes styles.css and system-props.js and publishes shared state', async () => {
    const root = createProject();
    const { compiler, runHandlers } = createCompiler(root);
    const plugin = new AnimusWebpackPlugin(OPTIONS);
    applyPlugin(plugin, compiler);

    await runHandlers[0](compiler);

    const css = readFileSync(artifactPath(root, plugin, 'styles.css'), 'utf-8');
    // Canonical assembly: layer declaration, then variables, then the
    // Lightning-processed body (dev mode: autoprefix-only reprint).
    expect(css).toContain(
      '@layer anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom;'
    );
    // Variables segment is never processed — byte-identical.
    expect(css).toContain(':root{--anm-space-1: 4px}');
    expect(css).toMatch(/@layer anm-global\s*\{\s*body\s*\{\s*margin:\s*0/);
    // Unit fallback appended px to the bare numeric margin
    expect(css).toMatch(/\.btn\s*\{\s*margin:\s*8px/);
    expect(css.indexOf('@layer anm-global,')).toBe(0);
    expect(css.indexOf(':root')).toBeLessThan(
      css.search(/@layer anm-global\s*\{/)
    );

    // Shared CSS is the authoritative copy of what hit disk (the disk
    // artifact additionally carries the trailing session envelope comment).
    expect(css.startsWith(getSharedCss())).toBe(true);
    expect(css).toContain('__animusSession');
    // Manifest is stored verbatim for the loader
    expect(getManifestJson()).toBe(analyzeResult(0));

    // system-props module: null transforms and empty scale maps are omitted,
    // systemPropGroups is the raw groupRegistry JSON string
    const sysProps = readFileSync(
      artifactPath(root, plugin, 'system-props.js'),
      'utf-8'
    );
    expect(sysProps).toBe(
      'export const systemPropMap = {"m":"margin"};\n' +
        'export const systemPropGroups = {"groups":{}};\n' +
        'export const dynamicPropConfig = {"color":{"varName":"--anm-color","slotClass":"anm-color-slot","property":"color","transformName":"toColor","scaleValues":{"primary":"#00f"}},"p":{"varName":"--anm-p","slotClass":"anm-p-slot","property":"padding"}};\n' +
        'export const transforms = {};\n'
    );
  });

  test('writes the session-enveloped manifest disk artifact and hash-guards rewrites', async () => {
    const root = createProject();
    const { compiler, watchRunHandlers } = createCompiler(root);
    const plugin = new AnimusWebpackPlugin(OPTIONS);
    applyPlugin(plugin, compiler);

    await watchRunHandlers[0](compiler);

    const manifestPath = artifactPath(root, plugin, 'manifest.json');
    const written = readFileSync(manifestPath, 'utf-8');
    // The disk artifact is the engine manifest plus the leading
    // __animusSession envelope field; the payload fields are verbatim.
    expect(JSON.parse(written)).toEqual({
      __animusSession: expect.objectContaining({
        sessionId: plugin.sessionId,
        generation: 1,
      }),
      ...parseJsonObject(analyzeResult(0), 'analyzeProject manifest'),
    });
    expect(JSON.parse(written).system_prop_map).toEqual({ m: 'margin' });
    const mtimeAfterFull = statSync(manifestPath).mtimeMs;

    // A source change whose re-analysis yields a byte-identical manifest
    // must not rewrite the artifact.
    writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_SOURCE_CHANGED);
    await watchRunHandlers[0](compiler);
    expect(mocks.analyzeProject).toHaveBeenCalledTimes(2);
    expect(statSync(manifestPath).mtimeMs).toBe(mtimeAfterFull);
  });

  test('post-processing: minify collapses the body; declaration and variables stay verbatim', async () => {
    const root = createProject();
    const { compiler, runHandlers } = createCompiler(root);
    const plugin = new AnimusWebpackPlugin({ ...OPTIONS, minify: true });
    applyPlugin(plugin, compiler);

    await runHandlers[0](compiler);

    const css = readFileSync(artifactPath(root, plugin, 'styles.css'), 'utf-8');
    // Untouched segments survive byte-for-byte
    expect(css.indexOf('@layer anm-global,')).toBe(0);
    expect(css).toContain(':root{--anm-space-1: 4px}');
    // Minified body: no trailing semicolon before the brace, no indentation
    expect(css).toContain('.btn{margin:8px}');
    expect(css).toContain('@layer anm-global{body{margin:0}}');
  });

  test('post-processing: autoprefixes the body for configured targets', async () => {
    nextComponentCss = '.card{backdrop-filter:blur(8px);}';
    const root = createProject();
    const { compiler, runHandlers } = createCompiler(root);
    const plugin = new AnimusWebpackPlugin({
      ...OPTIONS,
      targets: 'safari 15',
    });
    applyPlugin(plugin, compiler);

    await runHandlers[0](compiler);

    const css = readFileSync(artifactPath(root, plugin, 'styles.css'), 'utf-8');
    expect(css).toContain('-webkit-backdrop-filter');
  });

  test('post-processing: degrades to the unprocessed body on Lightning failure', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    nextComponentCss = '.broken { color: ; @}}';
    const root = createProject();
    const { compiler, runHandlers } = createCompiler(root);
    const plugin = new AnimusWebpackPlugin(OPTIONS);
    applyPlugin(plugin, compiler);

    await runHandlers[0](compiler);

    const css = readFileSync(artifactPath(root, plugin, 'styles.css'), 'utf-8');
    expect(css).toContain('.broken { color: ; @}}');
    expect(
      warnSpy.mock.calls.some((c) =>
        String(c[0]).includes('Lightning CSS post-processing failed')
      )
    ).toBe(true);
  });

  test('processAssets injects shared CSS into absolute- and relative-named assets', async () => {
    const root = createProject();
    const { compiler, runHandlers, compilationHandlers } = createCompiler(root);
    const plugin = new AnimusWebpackPlugin(OPTIONS);
    applyPlugin(plugin, compiler);
    const absName = artifactPath(root, plugin, 'styles.css');

    // Before any pipeline run there is no shared CSS — asset stays untouched
    const pre = createCompilation([absName]);
    compilationHandlers[0](pre.compilation);
    expect(pre.taps).toHaveLength(1);
    expect(pre.taps[0].options.stage).toBe(-100); // PROCESS_ASSETS_STAGE_ADDITIONAL
    pre.taps[0].fn({});
    expect(pre.assets.get(absName)?.source()).toBe('/* stub */');

    await runHandlers[0](compiler);

    const abs = createCompilation([absName]);
    compilationHandlers[0](abs.compilation);
    abs.taps[0].fn({});
    expect(abs.assets.get(absName)?.source()).toBe(getSharedCss());

    const rel = createCompilation(['.animus/styles.css']);
    compilationHandlers[0](rel.compilation);
    rel.taps[0].fn({});
    expect(rel.assets.get('.animus/styles.css')?.source()).toBe(getSharedCss());
  });

  test('client and server compilers dedupe into a single analysis; both inject CSS', async () => {
    const root = createProject();
    const client = createCompiler(root);
    const server = createCompiler(root, { name: 'server' });
    const clientPlugin = new AnimusWebpackPlugin(OPTIONS);
    const serverPlugin = new AnimusWebpackPlugin(OPTIONS);
    applyPlugin(clientPlugin, client.compiler);
    applyPlugin(serverPlugin, server.compiler);

    await client.runHandlers[0](client.compiler);
    await server.runHandlers[0](server.compiler);

    expect(mocks.loadSystemModule).toHaveBeenCalledTimes(1);
    expect(mocks.analyzeProject).toHaveBeenCalledTimes(1);

    // The non-owning server instance still serves the shared CSS. Both
    // plugin instances adopt the process-claimed session identity, so the
    // server's aliased asset path IS the owner's session-scoped stylesheet.
    expect(serverPlugin.sessionId).toBe(clientPlugin.sessionId);
    const absName = artifactPath(root, serverPlugin, 'styles.css');
    const comp = createCompilation([absName]);
    server.compilationHandlers[0](comp.compilation);
    comp.taps[0].fn({});
    expect(comp.assets.get(absName)?.source()).toBe(getSharedCss());
    expect(getSharedCss()).not.toBe('');
  });

  test('warn-kind manifest diagnostics surface via console.warn; unknown kinds stay silent', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.analyzeProject.mockImplementation(() =>
      buildManifest({
        diagnostics: [
          {
            file: 'src/Button.tsx',
            component: 'Button',
            kind: 'warn',
            message: 'margin dropped',
          },
          {
            file: 'src/Button.tsx',
            component: 'Button',
            kind: 'info',
            message: 'not surfaced',
          },
        ],
      })
    );
    const root = createProject();
    const { compiler, runHandlers } = createCompiler(root);
    applyPlugin(new AnimusWebpackPlugin(OPTIONS), compiler);

    await runHandlers[0](compiler);

    expect(warnSpy).toHaveBeenCalledWith(
      '[animus] ⚠ src/Button.tsx: Button: margin dropped'
    );
    const surfaced = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes('not surfaced')
    );
    expect(surfaced).toHaveLength(0);
  });
});

describe('watch mode (dev/HMR)', () => {
  test('first watchRun is a full pipeline; a content change triggers incremental analysis without reloading the system', async () => {
    const root = createProject();
    const { compiler, watchRunHandlers } = createCompiler(root);
    const plugin = new AnimusWebpackPlugin(OPTIONS);
    applyPlugin(plugin, compiler);

    await watchRunHandlers[0](compiler);
    expect(mocks.loadSystemModule).toHaveBeenCalledTimes(1);
    expect(mocks.analyzeProject).toHaveBeenCalledTimes(1);
    expect(analyzeCall(0)[7]).toBe(false); // first build is the full pipeline
    const clearsAfterFull = mocks.clearAnalysisCache.mock.calls.length;

    nextComponentCss = '.btn{margin:16;}';
    writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_SOURCE_CHANGED);
    await watchRunHandlers[0](compiler);

    // Incremental: re-analyzed, but the system was NOT reloaded and the
    // Rust analysis cache was NOT cleared
    expect(mocks.loadSystemModule).toHaveBeenCalledTimes(1);
    expect(mocks.analyzeProject).toHaveBeenCalledTimes(2);
    expect(mocks.clearAnalysisCache.mock.calls.length).toBe(clearsAfterFull);

    const args = analyzeCall(1);
    expect(args[7]).toBe(true); // HMR devMode
    expect(args[6]).toBe('{}'); // package map replayed from (empty) cache
    // v2 engine contract: every cached file rides with FULL source + hash,
    // changed or not (v2 has no Rust-side cache)
    const files = parseFiles(args);
    const button = files.find((f) => f.path === 'src/Button.tsx');
    expect(button?.source).toBe(BUTTON_SOURCE_CHANGED);
    const system = files.find((f) => f.path === 'src/system.ts');
    expect(system?.source).toBe(SYSTEM_SOURCE);
    expect(system?.hash).toMatch(/^[0-9a-f]{32}$/);

    // CSS output updated on disk and in shared state
    const css = readFileSync(artifactPath(root, plugin, 'styles.css'), 'utf-8');
    expect(css).toMatch(/\.btn\s*\{\s*margin:\s*16px/);
    expect(css.startsWith(getSharedCss())).toBe(true);
  });

  test('unchanged files trigger no re-analysis on subsequent watchRuns', async () => {
    const root = createProject();
    const { compiler, watchRunHandlers } = createCompiler(root);
    const plugin = new AnimusWebpackPlugin(OPTIONS);
    applyPlugin(plugin, compiler);

    await watchRunHandlers[0](compiler);
    const cssAfterFull = readFileSync(
      artifactPath(root, plugin, 'styles.css'),
      'utf-8'
    );

    await watchRunHandlers[0](compiler);
    await watchRunHandlers[0](compiler);

    expect(mocks.loadSystemModule).toHaveBeenCalledTimes(1);
    expect(mocks.analyzeProject).toHaveBeenCalledTimes(1);
    expect(
      readFileSync(artifactPath(root, plugin, 'styles.css'), 'utf-8')
    ).toBe(cssAfterFull);
  });

  test('a system file change triggers a geological reset: cache cleared, system reloaded, full pipeline re-run', async () => {
    const root = createProject();
    const { compiler, watchRunHandlers } = createCompiler(root);
    applyPlugin(new AnimusWebpackPlugin(OPTIONS), compiler);

    await watchRunHandlers[0](compiler);
    const clearsBefore = mocks.clearAnalysisCache.mock.calls.length;

    writeFileSync(join(root, 'src', 'system.ts'), SYSTEM_SOURCE_CHANGED);
    await watchRunHandlers[0](compiler);

    expect(mocks.loadSystemModule).toHaveBeenCalledTimes(2); // system reloaded
    expect(mocks.analyzeProject).toHaveBeenCalledTimes(2);
    expect(analyzeCall(1)[7]).toBe(false); // full pipeline, not HMR
    expect(mocks.clearAnalysisCache.mock.calls.length).toBeGreaterThan(
      clearsBefore
    );

    // Watch state recovered: a further unchanged watchRun stays quiet
    await watchRunHandlers[0](compiler);
    expect(mocks.analyzeProject).toHaveBeenCalledTimes(2);
  });

  test('with modifiedFiles present, only listed files are re-read; others replay from cache', async () => {
    const root = createProject();
    const { compiler, watchRunHandlers } = createCompiler(root);
    applyPlugin(new AnimusWebpackPlugin(OPTIONS), compiler);

    await watchRunHandlers[0](compiler);

    // Both files change on disk, but webpack only reports Button.tsx
    writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_SOURCE_CHANGED);
    writeFileSync(join(root, 'src', 'Other.tsx'), 'export const Other = 1;\n');
    await watchRunHandlers[0]({
      ...compiler,
      modifiedFiles: new Set([join(root, 'src', 'Button.tsx')]),
      removedFiles: new Set<string>(),
    });

    expect(mocks.analyzeProject).toHaveBeenCalledTimes(2);
    const files = parseFiles(analyzeCall(1));
    // The listed file was re-read; the unlisted new file was never scanned
    expect(files.find((f) => f.path === 'src/Button.tsx')?.source).toBe(
      BUTTON_SOURCE_CHANGED
    );
    expect(files.find((f) => f.path === 'src/Other.tsx')).toBeUndefined();
  });

  test('removedFiles prunes cache entries and triggers re-analysis without ghosts', async () => {
    const root = createProject();
    const { compiler, watchRunHandlers } = createCompiler(root);
    applyPlugin(new AnimusWebpackPlugin(OPTIONS), compiler);

    await watchRunHandlers[0](compiler);
    rmSync(join(root, 'src', 'Button.tsx'));
    await watchRunHandlers[0]({
      ...compiler,
      modifiedFiles: new Set<string>(),
      removedFiles: new Set([join(root, 'src', 'Button.tsx')]),
    });

    expect(mocks.analyzeProject).toHaveBeenCalledTimes(2);
    const files = parseFiles(analyzeCall(1));
    expect(files.find((f) => f.path === 'src/Button.tsx')).toBeUndefined();
    expect(files.find((f) => f.path === 'src/system.ts')).toBeDefined();
  });

  test('a non-owning instance with no reported set stays a no-op', async () => {
    // Real webpack passes real (possibly empty) sets on incremental turns;
    // an absent set on a NON-OWNING instance (initial replay, bare
    // harnesses) must not trigger the owner's full-discovery fallback.
    const root = createProject();
    const owner = createCompiler(root);
    const follower = createCompiler(root, { name: 'server' });
    applyPlugin(new AnimusWebpackPlugin(OPTIONS), owner.compiler);
    applyPlugin(new AnimusWebpackPlugin(OPTIONS), follower.compiler);

    await owner.watchRunHandlers[0](owner.compiler);
    await follower.watchRunHandlers[0](follower.compiler); // awaits shared promise
    expect(mocks.analyzeProject).toHaveBeenCalledTimes(1);

    writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_SOURCE_CHANGED);

    // No modified set on the follower → nothing to forward.
    await follower.watchRunHandlers[0](follower.compiler);
    expect(mocks.analyzeProject).toHaveBeenCalledTimes(1);
    expect(mocks.loadSystemModule).toHaveBeenCalledTimes(1);

    // The owner picks the change up
    await owner.watchRunHandlers[0](owner.compiler);
    expect(mocks.analyzeProject).toHaveBeenCalledTimes(2);
    expect(analyzeCall(1)[7]).toBe(true);
  });

  test('a non-owning instance forwards its real modified set to the owner', async () => {
    // Each MultiCompiler child has its own watcher and its own modified
    // set: a server-graph-only edit arrives ONLY on the server compiler,
    // whose session lost the init race and never loaded system state.
    // Dropping that batch strands the file at its pre-edit hash and the
    // loader throws ANIMUS_ANALYSIS_CATCHING_UP on every rebuild forever.
    const root = createProject();
    const owner = createCompiler(root);
    const follower = createCompiler(root, { name: 'server' });
    applyPlugin(new AnimusWebpackPlugin(OPTIONS), owner.compiler);
    applyPlugin(new AnimusWebpackPlugin(OPTIONS), follower.compiler);

    await owner.watchRunHandlers[0](owner.compiler);
    await follower.watchRunHandlers[0](follower.compiler);
    expect(mocks.analyzeProject).toHaveBeenCalledTimes(1);

    writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_SOURCE_CHANGED);
    await follower.watchRunHandlers[0]({
      ...follower.compiler,
      modifiedFiles: new Set([join(root, 'src', 'Button.tsx')]),
      removedFiles: new Set<string>(),
    });

    // The batch reached the owner's analysis instead of being dropped —
    // with the edited bytes, and without a second system load (ownership
    // did not move).
    expect(mocks.analyzeProject).toHaveBeenCalledTimes(2);
    const files = parseFiles(analyzeCall(1));
    expect(files.find((f) => f.path === 'src/Button.tsx')?.source).toBe(
      BUTTON_SOURCE_CHANGED
    );
    expect(mocks.loadSystemModule).toHaveBeenCalledTimes(1);
  });
});

describe('engine retirement (retire-extract-v1)', () => {
  test('constructing the plugin with engine:v1 throws the canonical message', () => {
    const retiredEngineOptions = { ...OPTIONS, engine: 'v1' };
    expect(
      // SAFETY: This deliberately crosses the typed option boundary to prove
      // the constructor rejects a stale JavaScript config's retired engine.
      () => new AnimusWebpackPlugin(retiredEngineOptions as AnimusNextOptions)
    ).toThrow(RETIRED_ENGINE_MESSAGE);
  });

  test('ANIMUS_ENGINE=v1 throws even without an engine option', () => {
    const saved = process.env.ANIMUS_ENGINE;
    process.env.ANIMUS_ENGINE = 'v1';
    try {
      expect(() => new AnimusWebpackPlugin(OPTIONS)).toThrow(
        RETIRED_ENGINE_MESSAGE
      );
    } finally {
      if (saved === undefined) delete process.env.ANIMUS_ENGINE;
      else process.env.ANIMUS_ENGINE = saved;
    }
  });
});
