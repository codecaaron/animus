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
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { AnimusWebpackPlugin } from '../src/plugin';
import { getManifestJson, getSharedCss } from '../src/singleton';

import type { AnimusNextOptions } from '../src/types';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn(),
  clearAnalysisCache: vi.fn(),
}));

vi.mock('../src/singleton', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/singleton')>();
  return {
    ...actual,
    engineApi: () => ({
      loadSystemModule: mocks.loadSystemModule,
      analyzeProject: mocks.analyzeProject,
      clearAnalysisCache: mocks.clearAnalysisCache,
    }),
  };
});

/** globalThis keys owned by src/singleton.ts — saved/cleared per test. */
const GLOBAL_KEYS = [
  '__animus_manifest_json__',
  '__animus_analysis_promise__',
  '__animus_shared_css__',
  '__animus_shared_system_props__',
  '__animus_external_pkg_dirs__',
  '__animus_external_source_entries__',
  '__animus_engine__',
  '__animus_v2_engine__',
  '__animus_v2_sent_sources__',
] as const;

const g = globalThis as Record<string, unknown>;
let savedGlobals: Record<string, unknown>;
const tempRoots: string[] = [];

const SYSTEM_SOURCE = 'export const system = { space: [0, 4, 8] };\n';
const SYSTEM_SOURCE_CHANGED =
  'export const system = { space: [0, 4, 8, 16] };\n';
const BUTTON_SOURCE =
  "export const Button = animus.styles({ margin: 8 }).asElement('button');\n";
const BUTTON_SOURCE_CHANGED =
  "export const Button = animus.styles({ margin: 16 }).asElement('button');\n";

const SYSTEM_CONFIG = {
  propConfig: '{"props":{}}',
  groupRegistry: '{"groups":{}}',
  scalesJson: '{"space":{}}',
  variableMapJson: '{"map":{}}',
  variableCss: ':root{--anm-space-1: 4px}',
  contextualVarsJson: null,
  selectorAliases: null,
  globalStyleBlocks: null,
  keyframesBlocks: null,
};

/** Component CSS returned by the analyzeProject mock; mutable per test. */
let nextComponentCss = '.btn{margin:8;}';

function buildManifest(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    css: nextComponentCss,
    sheets: { global: '@layer anm-global{body{margin:0}}' },
    system_prop_map: { m: 'margin' },
    dynamic_props: {
      color: {
        var_name: '--anm-color',
        slot_class: 'anm-color-slot',
        transform_name: 'toColor',
        scale_values: { primary: '#00f' },
      },
      p: { var_name: '--anm-p', slot_class: 'anm-p-slot', scale_values: {} },
    },
    diagnostics: [],
    ...overrides,
  });
}

beforeEach(() => {
  savedGlobals = {};
  for (const key of GLOBAL_KEYS) {
    savedGlobals[key] = g[key];
    g[key] = undefined;
  }
  nextComponentCss = '.btn{margin:8;}';
  mocks.loadSystemModule.mockReset().mockReturnValue({ ...SYSTEM_CONFIG });
  mocks.analyzeProject.mockReset().mockImplementation(() => buildManifest());
  mocks.clearAnalysisCache.mockReset();
});

afterEach(() => {
  Object.assign(g, savedGlobals);
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'animus-next-pipeline-'));
  tempRoots.push(root);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'system.ts'), SYSTEM_SOURCE);
  writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_SOURCE);
  return root;
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

type AsyncHandler = (compiler: unknown) => Promise<void>;
type CompilationHandler = (compilation: unknown) => void;

function createCompiler(
  root: string,
  extras: { name?: string; alias?: Record<string, string> } = {}
) {
  const runHandlers: AsyncHandler[] = [];
  const watchRunHandlers: AsyncHandler[] = [];
  const compilationHandlers: CompilationHandler[] = [];
  const compiler = {
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
    },
    context: root,
    options: { name: extras.name, resolve: { alias: extras.alias } },
    webpack: {
      Compilation: { PROCESS_ASSETS_STAGE_ADDITIONAL: -100 },
      sources: { RawSource: FakeRawSource },
    },
  };
  return { compiler, runHandlers, watchRunHandlers, compilationHandlers };
}

function applyPlugin(
  plugin: AnimusWebpackPlugin,
  compiler: ReturnType<typeof createCompiler>['compiler']
): void {
  plugin.apply(
    compiler as unknown as Parameters<AnimusWebpackPlugin['apply']>[0]
  );
}

function createCompilation(assetNames: string[]) {
  const assets = new Map<string, FakeRawSource>(
    assetNames.map((name) => [name, new FakeRawSource('/* stub */')])
  );
  const taps: Array<{
    options: { name: string; stage: number };
    fn: (assets: Record<string, unknown>) => void;
  }> = [];
  const compilation = {
    hooks: {
      processAssets: {
        tap: (
          options: { name: string; stage: number },
          fn: (assets: Record<string, unknown>) => void
        ) => {
          taps.push({ options, fn });
        },
      },
    },
    getAsset: (name: string) =>
      assets.has(name) ? { source: assets.get(name) } : undefined,
    updateAsset: (name: string, source: FakeRawSource) => {
      assets.set(name, source);
    },
  };
  return { compilation, taps, assets };
}

function analyzeCall(index: number): unknown[] {
  return mocks.analyzeProject.mock.calls[index] as unknown[];
}

function parseFiles(
  args: unknown[]
): Array<{ path: string; source: string; hash?: string }> {
  return JSON.parse(args[0] as string);
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
    applyPlugin(new AnimusWebpackPlugin(OPTIONS), compiler);

    await runHandlers[0](compiler);

    expect(mocks.clearAnalysisCache).toHaveBeenCalledTimes(1);
    expect(mocks.loadSystemModule).toHaveBeenCalledTimes(1);
    expect(mocks.loadSystemModule).toHaveBeenCalledWith(
      join(root, 'src', 'system.ts'),
      root
    );
    expect(mocks.analyzeProject).toHaveBeenCalledTimes(1);

    const args = analyzeCall(0);
    // Positional NAPI contract (analyze-project-args.ts)
    expect(args[1]).toBe(SYSTEM_CONFIG.scalesJson);
    expect(args[2]).toBe(SYSTEM_CONFIG.variableMapJson);
    expect(args[3]).toBeNull();
    expect(args[4]).toBe(SYSTEM_CONFIG.propConfig);
    expect(args[5]).toBe(SYSTEM_CONFIG.groupRegistry);
    expect(args[6]).toBe('{}'); // no external packages resolved
    expect(args[7]).toBe(false); // production devMode
    expect(JSON.parse(args[8] as string)).toEqual({
      runtime_import: '@animus-ui/system/runtime',
      css_module_id: '.animus/styles.css',
      system_props_module_id: join(root, '.animus', 'system-props.js'),
    });
    expect(args[9]).toBeNull();
    expect(args[10]).toBeNull();
    expect(args[11]).toBeNull();
    // Webpack resolve.alias translated to path aliases (own .animus alias skipped,
    // longest pattern first, prefix aliases get trailing slashes)
    expect(JSON.parse(args[12] as string)).toEqual({
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

  test('writes styles.css and system-props.js and publishes shared state', async () => {
    const root = createProject();
    const { compiler, runHandlers } = createCompiler(root);
    applyPlugin(new AnimusWebpackPlugin(OPTIONS), compiler);

    await runHandlers[0](compiler);

    const css = readFileSync(join(root, '.animus', 'styles.css'), 'utf-8');
    // Canonical assembly: layer declaration, then variables, then global + component CSS
    expect(css).toContain(
      '@layer anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom;'
    );
    expect(css).toContain(':root{--anm-space-1: 4px}');
    expect(css).toContain('@layer anm-global{body{margin:0}}');
    // Unit fallback appended px to the bare numeric margin
    expect(css).toContain('.btn{margin:8px;}');
    expect(css.indexOf('@layer anm-global,')).toBe(0);
    expect(css.indexOf(':root')).toBeLessThan(css.indexOf('body{margin:0}'));

    // Shared CSS is the authoritative copy of what hit disk
    expect(getSharedCss()).toBe(css);
    // Manifest is stored verbatim for the loader
    expect(getManifestJson()).toBe(
      mocks.analyzeProject.mock.results[0].value as string
    );

    // system-props module: snake_case manifest fields become camelCase,
    // empty scale_values and missing transform_name are omitted,
    // systemPropGroups is the raw groupRegistry JSON string
    const sysProps = readFileSync(
      join(root, '.animus', 'system-props.js'),
      'utf-8'
    );
    expect(sysProps).toBe(
      'export const systemPropMap = {"m":"margin"};\n' +
        'export const systemPropGroups = {"groups":{}};\n' +
        'export const dynamicPropConfig = {"color":{"varName":"--anm-color","slotClass":"anm-color-slot","transformName":"toColor","scaleValues":{"primary":"#00f"}},"p":{"varName":"--anm-p","slotClass":"anm-p-slot"}};\n' +
        'export const transforms = {};\n'
    );
  });

  test('processAssets injects shared CSS into absolute- and relative-named assets', async () => {
    const root = createProject();
    const { compiler, runHandlers, compilationHandlers } = createCompiler(root);
    applyPlugin(new AnimusWebpackPlugin(OPTIONS), compiler);
    const absName = join(root, '.animus', 'styles.css');

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
    applyPlugin(new AnimusWebpackPlugin(OPTIONS), client.compiler);
    applyPlugin(new AnimusWebpackPlugin(OPTIONS), server.compiler);

    await client.runHandlers[0](client.compiler);
    await server.runHandlers[0](server.compiler);

    expect(mocks.loadSystemModule).toHaveBeenCalledTimes(1);
    expect(mocks.analyzeProject).toHaveBeenCalledTimes(1);

    // The non-owning server instance still serves the shared CSS
    const absName = join(root, '.animus', 'styles.css');
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
    applyPlugin(new AnimusWebpackPlugin(OPTIONS), compiler);

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
    const css = readFileSync(join(root, '.animus', 'styles.css'), 'utf-8');
    expect(css).toContain('.btn{margin:16px;}');
    expect(getSharedCss()).toBe(css);
  });

  test('unchanged files trigger no re-analysis on subsequent watchRuns', async () => {
    const root = createProject();
    const { compiler, watchRunHandlers } = createCompiler(root);
    applyPlugin(new AnimusWebpackPlugin(OPTIONS), compiler);

    await watchRunHandlers[0](compiler);
    const cssAfterFull = readFileSync(
      join(root, '.animus', 'styles.css'),
      'utf-8'
    );

    await watchRunHandlers[0](compiler);
    await watchRunHandlers[0](compiler);

    expect(mocks.loadSystemModule).toHaveBeenCalledTimes(1);
    expect(mocks.analyzeProject).toHaveBeenCalledTimes(1);
    expect(readFileSync(join(root, '.animus', 'styles.css'), 'utf-8')).toBe(
      cssAfterFull
    );
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

  test('v1 engine sends empty source + hash for unchanged files (Rust cache-hit contract)', async () => {
    const root = createProject();
    const { compiler, watchRunHandlers } = createCompiler(root);
    applyPlugin(
      new AnimusWebpackPlugin({ ...OPTIONS, engine: 'v1' }),
      compiler
    );

    await watchRunHandlers[0](compiler);
    writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_SOURCE_CHANGED);
    await watchRunHandlers[0](compiler);

    const files = parseFiles(analyzeCall(1));
    const button = files.find((f) => f.path === 'src/Button.tsx');
    expect(button?.source).toBe(BUTTON_SOURCE_CHANGED);
    const system = files.find((f) => f.path === 'src/system.ts');
    expect(system?.source).toBe(''); // unchanged → empty source
    expect(system?.hash).toMatch(/^[0-9a-f]{32}$/); // but hash still rides
  });

  test('a non-owning watch instance never re-analyzes, even after file changes', async () => {
    const root = createProject();
    const owner = createCompiler(root);
    const follower = createCompiler(root, { name: 'server' });
    applyPlugin(new AnimusWebpackPlugin(OPTIONS), owner.compiler);
    applyPlugin(new AnimusWebpackPlugin(OPTIONS), follower.compiler);

    await owner.watchRunHandlers[0](owner.compiler);
    await follower.watchRunHandlers[0](follower.compiler); // awaits shared promise
    expect(mocks.analyzeProject).toHaveBeenCalledTimes(1);

    writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_SOURCE_CHANGED);

    // The follower never loaded system config → guard skips re-analysis
    await follower.watchRunHandlers[0](follower.compiler);
    expect(mocks.analyzeProject).toHaveBeenCalledTimes(1);
    expect(mocks.loadSystemModule).toHaveBeenCalledTimes(1);

    // The owner picks the change up
    await owner.watchRunHandlers[0](owner.compiler);
    expect(mocks.analyzeProject).toHaveBeenCalledTimes(2);
    expect(analyzeCall(1)[7]).toBe(true);
  });
});
