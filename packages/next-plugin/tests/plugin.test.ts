import { isJsonObject, parseJsonObject } from '@animus-ui/assertions';
import { RETIRED_ENGINE_MESSAGE } from '@animus-ui/extract/pipeline';
import { readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ExtractionSession } from '../../extract/session/extraction-session';
import { sessionArtifactDir } from '../../extract/session/session-paths';
import { getManifestJson, getSharedCss } from '../../extract/session/singleton';
import {
  BUTTON_SOURCE,
  BUTTON_STYLE_EDIT as BUTTON_SOURCE_CHANGED,
  createProject as createFixtureProject,
  disposeTempRoots,
  makeManifest,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from '../../extract/tests/session/session-fixtures';
import { AnimusWebpackPlugin } from '../src/plugin';

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

let nextComponentCss = '.btn{margin:8;}';

interface ManifestOverrides {
  diagnostics?: ManifestDiagnostic[];
}

function buildManifest(overrides: ManifestOverrides = {}): string {
  const manifest = makeManifest({
    css: nextComponentCss,
    // Nesting is prop name → value → utility class: `resolveClasses`
    // indexes it as `systemPropMap[prop][value]`.
    system_prop_map: { m: { '8': 'anm-m-8' } },
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
    ...overrides,
  });
  manifest.sheets.global = '@layer anm-global{body{margin:0}}';
  return JSON.stringify(manifest);
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

type PluginAliasMap = NonNullable<
  NonNullable<NonNullable<PluginCompiler['options']>['resolve']>['alias']
>;

function createCompiler(
  root: string,
  extras: { name?: string; alias?: PluginAliasMap } = {}
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
    expect(args[1]).toBe(SYSTEM_CONFIG.scalesJson);
    expect(args[2]).toBe(SYSTEM_CONFIG.variableMapJson);
    expect(args[3]).toBeNull();
    expect(args[4]).toBe(SYSTEM_CONFIG.propConfig);
    expect(args[5]).toBe(SYSTEM_CONFIG.groupRegistry);
    expect(args[6]).toBe('{}');
    expect(args[7]).toBe(false);
    expect(parseRequiredJsonObject(args[8], 'emitter config')).toEqual({
      runtime_import: '@animus-ui/system/runtime',
      css_module_id: '.animus/styles.css',
      system_props_module_id: artifactPath(root, plugin, 'system-props.js'),
    });
    expect(args[9]).toBeNull();
    expect(args[10]).toBeNull();
    expect(args[11]).toBeNull();
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

    const files = parseFiles(args);
    expect(files.map((f) => f.path).sort()).toEqual([
      'src/Button.tsx',
      'src/system.ts',
    ]);
    const button = files.find((f) => f.path === 'src/Button.tsx');
    expect(button?.source).toBe(BUTTON_SOURCE);
    expect(button?.hash).toMatch(/^[0-9a-f]{32}$/);
  });

  test('harvests the first candidate of a list alias and skips the ones that name no target', async () => {
    const root = createProject();
    const { compiler, runHandlers } = createCompiler(root, {
      alias: {
        '@first': [join(root, 'src', 'components'), join(root, 'src')],
        // `false` disables an alias and an empty list names no candidate, so
        // neither yields a pattern→target pair to report.
        '@disabled': false,
        '@empty': [],
      },
    });
    const plugin = new AnimusWebpackPlugin(OPTIONS);
    applyPlugin(plugin, compiler);

    await runHandlers[0](compiler);

    expect(parseRequiredJsonObject(analyzeCall(0)[12], 'path aliases')).toEqual(
      {
        aliases: [
          {
            pattern: '@first/',
            replacement: 'src/components/',
            type: 'prefix',
          },
        ],
      }
    );
  });

  test('an offline system-props change moves the replacement epoch', async () => {
    // Restored modules import the building session's system-props.js, so an
    // unmoved epoch would keep them bound to a dead session's stale artifact.
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
    expect(css).toContain(
      '@layer anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom;'
    );
    expect(css).toContain(':root{--anm-space-1: 4px}');
    expect(css).toMatch(/@layer anm-global\s*\{\s*body\s*\{\s*margin:\s*0/);
    expect(css).toMatch(/\.btn\s*\{\s*margin:\s*8px/);
    expect(css.indexOf('@layer anm-global,')).toBe(0);
    expect(css.indexOf(':root')).toBeLessThan(
      css.search(/@layer anm-global\s*\{/)
    );

    expect(css.startsWith(getSharedCss())).toBe(true);
    expect(css).toContain('__animusSession');
    expect(getManifestJson()).toBe(analyzeResult(0));

    const sysProps = readFileSync(
      artifactPath(root, plugin, 'system-props.js'),
      'utf-8'
    );
    expect(sysProps).toBe(
      'export const systemPropMap = {"m":{"8":"anm-m-8"}};\n' +
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
    expect(JSON.parse(written)).toEqual({
      __animusSession: expect.objectContaining({
        sessionId: plugin.sessionId,
        generation: 1,
      }),
      ...parseJsonObject(analyzeResult(0), 'analyzeProject manifest'),
    });
    expect(JSON.parse(written).system_prop_map).toEqual({
      m: { '8': 'anm-m-8' },
    });
    const mtimeAfterFull = statSync(manifestPath).mtimeMs;

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
    expect(css.indexOf('@layer anm-global,')).toBe(0);
    expect(css).toContain(':root{--anm-space-1: 4px}');
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

    const pre = createCompilation([absName]);
    compilationHandlers[0](pre.compilation);
    expect(pre.taps).toHaveLength(1);
    expect(pre.taps[0].options.stage).toBe(-100);
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
    expect(analyzeCall(0)[7]).toBe(false);
    const clearsAfterFull = mocks.clearAnalysisCache.mock.calls.length;

    nextComponentCss = '.btn{margin:16;}';
    writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_SOURCE_CHANGED);
    await watchRunHandlers[0](compiler);

    expect(mocks.loadSystemModule).toHaveBeenCalledTimes(1);
    expect(mocks.analyzeProject).toHaveBeenCalledTimes(2);
    expect(mocks.clearAnalysisCache.mock.calls.length).toBe(clearsAfterFull);

    const args = analyzeCall(1);
    expect(args[7]).toBe(true);
    expect(args[6]).toBe('{}');
    const files = parseFiles(args);
    const button = files.find((f) => f.path === 'src/Button.tsx');
    expect(button?.source).toBe(BUTTON_SOURCE_CHANGED);
    const system = files.find((f) => f.path === 'src/system.ts');
    expect(system?.source).toBe(SYSTEM_SOURCE);
    expect(system?.hash).toMatch(/^[0-9a-f]{32}$/);

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

  test('a system file change reloads the system: cache cleared, system reloaded, full pipeline re-run', async () => {
    const root = createProject();
    const { compiler, watchRunHandlers } = createCompiler(root);
    applyPlugin(new AnimusWebpackPlugin(OPTIONS), compiler);

    await watchRunHandlers[0](compiler);
    const clearsBefore = mocks.clearAnalysisCache.mock.calls.length;

    writeFileSync(join(root, 'src', 'system.ts'), SYSTEM_SOURCE_CHANGED);
    await watchRunHandlers[0](compiler);

    expect(mocks.loadSystemModule).toHaveBeenCalledTimes(2);
    expect(mocks.analyzeProject).toHaveBeenCalledTimes(2);
    expect(analyzeCall(1)[7]).toBe(false);
    expect(mocks.clearAnalysisCache.mock.calls.length).toBeGreaterThan(
      clearsBefore
    );

    await watchRunHandlers[0](compiler);
    expect(mocks.analyzeProject).toHaveBeenCalledTimes(2);
  });

  test('with modifiedFiles present, only listed files are re-read; others replay from cache', async () => {
    const root = createProject();
    const { compiler, watchRunHandlers } = createCompiler(root);
    applyPlugin(new AnimusWebpackPlugin(OPTIONS), compiler);

    await watchRunHandlers[0](compiler);

    writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_SOURCE_CHANGED);
    writeFileSync(join(root, 'src', 'Other.tsx'), 'export const Other = 1;\n');
    await watchRunHandlers[0]({
      ...compiler,
      modifiedFiles: new Set([join(root, 'src', 'Button.tsx')]),
      removedFiles: new Set<string>(),
    });

    expect(mocks.analyzeProject).toHaveBeenCalledTimes(2);
    const files = parseFiles(analyzeCall(1));
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
    const root = createProject();
    const owner = createCompiler(root);
    const follower = createCompiler(root, { name: 'server' });
    applyPlugin(new AnimusWebpackPlugin(OPTIONS), owner.compiler);
    applyPlugin(new AnimusWebpackPlugin(OPTIONS), follower.compiler);

    await owner.watchRunHandlers[0](owner.compiler);
    await follower.watchRunHandlers[0](follower.compiler); // awaits shared promise
    expect(mocks.analyzeProject).toHaveBeenCalledTimes(1);

    writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_SOURCE_CHANGED);

    await follower.watchRunHandlers[0](follower.compiler);
    expect(mocks.analyzeProject).toHaveBeenCalledTimes(1);
    expect(mocks.loadSystemModule).toHaveBeenCalledTimes(1);

    await owner.watchRunHandlers[0](owner.compiler);
    expect(mocks.analyzeProject).toHaveBeenCalledTimes(2);
    expect(analyzeCall(1)[7]).toBe(true);
  });

  test('a non-owning instance forwards its real modified set to the owner', async () => {
    // Each MultiCompiler child has its own watcher and modified set:
    // dropping the server's batch strands the file in permanent catch-up.
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
      // SAFETY: Crosses the typed option boundary to prove the constructor
      // rejects a stale JavaScript config's retired engine.
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
