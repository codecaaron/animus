/**
 * Behavior pins for the Turbopack orchestration path (spec:
 * next-turbopack-integration): config resolution completes the extraction
 * and leaves the full artifact set on disk; the dev watcher feeds
 * existence-partitioned change sets into the session. Engine mocked at the
 * singleton seam, same harness as plugin-pipeline.test.ts.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { startTurbopackWatcher } from '../src/turbopack-orchestrator';
import { ANIMUS_TURBOPACK_RULE_GLOB } from '../src/turbopack-config';
import { withAnimus } from '../src/with-animus';

import type { ExtractionSession } from '../src/extraction-session';

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
  '__animus_v2_drift_warned__',
] as const;

const g = globalThis as Record<string, unknown>;
let savedGlobals: Record<string, unknown>;
const tempRoots: string[] = [];
let savedCwd: string;

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

const MANIFEST = JSON.stringify({
  css: '.btn{margin:8;}',
  sheets: { global: '' },
  system_prop_map: {},
  dynamic_props: {},
  diagnostics: [],
});

const BUTTON_SOURCE =
  "export const Button = animus.styles({ margin: 8 }).asElement('button');\n";

function createProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'animus-turbo-orch-'));
  tempRoots.push(root);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'system.ts'), 'export const system = {};\n');
  writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_SOURCE);
  return root;
}

beforeEach(() => {
  savedGlobals = {};
  for (const key of GLOBAL_KEYS) {
    savedGlobals[key] = g[key];
    g[key] = undefined;
  }
  savedCwd = process.cwd();
  mocks.loadSystemModule.mockReset().mockReturnValue({ ...SYSTEM_CONFIG });
  mocks.analyzeProject.mockReset().mockReturnValue(MANIFEST);
  mocks.clearAnalysisCache.mockReset();
});

afterEach(() => {
  process.chdir(savedCwd);
  Object.assign(g, savedGlobals);
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('withAnimus Turbopack wiring', () => {
  test('inactive mode returns synchronously with no turbopack keys', () => {
    const root = createProject();
    process.chdir(root);
    const config = withAnimus({ system: './src/system.ts' })({});
    expect(config).not.toBeInstanceOf(Promise);
    expect((config as Record<string, unknown>).turbopack).toBeUndefined();
  });

  test('active mode resolves after the artifact set exists and merges config', async () => {
    const root = createProject();
    process.chdir(root);

    const pending = withAnimus({
      system: './src/system.ts',
      unstable_turbopack: { mode: 'on' },
    })({});
    expect(pending).toBeInstanceOf(Promise);
    const config = await pending;

    for (const artifact of [
      'styles.css',
      'system-props.js',
      'manifest.json',
      'analysis-inputs.json',
    ]) {
      expect(existsSync(join(root, '.animus', artifact))).toBe(true);
    }

    // The hydration artifact replays the exact analyze-time inputs
    const inputs = JSON.parse(
      readFileSync(join(root, '.animus', 'analysis-inputs.json'), 'utf-8')
    );
    const files = JSON.parse(inputs.filesJson) as Array<{
      path: string;
      source: string;
    }>;
    expect(files.find((f) => f.path === 'src/Button.tsx')?.source).toBe(
      BUTTON_SOURCE
    );
    expect(inputs.devMode).toBe(false);
    expect(readFileSync(join(root, '.animus', 'manifest.json'), 'utf-8')).toBe(
      MANIFEST
    );

    const turbopack = (config as Record<string, unknown>).turbopack as {
      rules: Record<string, { loaders: Array<{ options: unknown }> }>;
      resolveAlias: Record<string, string>;
    };
    expect(turbopack.rules[ANIMUS_TURBOPACK_RULE_GLOB]).toBeDefined();
    // process.cwd() resolves the macOS /var → /private/var symlink
    expect(
      turbopack.rules[ANIMUS_TURBOPACK_RULE_GLOB].loaders[0].options
    ).toMatchObject({ rootDir: realpathSync(root) });
    expect(turbopack.resolveAlias['virtual:animus/system-props']).toBe(
      './.animus/system-props.js'
    );
  });

  test('a consumer rule on the Animus glob is a hard error', async () => {
    const root = createProject();
    process.chdir(root);

    await expect(
      withAnimus({
        system: './src/system.ts',
        unstable_turbopack: { mode: 'on' },
      })({
        turbopack: {
          rules: { [ANIMUS_TURBOPACK_RULE_GLOB]: { loaders: [] } },
        },
      })
    ).rejects.toThrow('already configured');
  });
});

type WatchChanges = {
  modifiedFiles: Set<string>;
  removedFiles: Set<string>;
};

describe('startTurbopackWatcher', () => {
  test('feeds debounced, existence-partitioned change sets to the session', async () => {
    const root = createProject();
    const handleWatchUpdate = vi.fn<(changes: WatchChanges) => Promise<void>>(
      async () => {}
    );
    const session = { handleWatchUpdate } as unknown as ExtractionSession;

    const watcher = startTurbopackWatcher(session, root, 20);
    expect(watcher).not.toBeNull();
    try {
      writeFileSync(join(root, 'src', 'New.tsx'), 'export const N = 1;\n');
      await vi.waitFor(
        () =>
          expect(
            handleWatchUpdate.mock.calls.some((c) =>
              c[0].modifiedFiles.has(join(root, 'src', 'New.tsx'))
            )
          ).toBe(true),
        { timeout: 5000 }
      );

      rmSync(join(root, 'src', 'New.tsx'));
      await vi.waitFor(
        () =>
          expect(
            handleWatchUpdate.mock.calls.some((c) =>
              c[0].removedFiles.has(join(root, 'src', 'New.tsx'))
            )
          ).toBe(true),
        { timeout: 5000 }
      );
    } finally {
      watcher!.close();
    }
  });

  test('is idempotent per process and ignores .animus writes', async () => {
    const root = createProject();
    const handleWatchUpdate = vi.fn<(changes: WatchChanges) => Promise<void>>(
      async () => {}
    );
    const session = { handleWatchUpdate } as unknown as ExtractionSession;

    const first = startTurbopackWatcher(session, root, 20);
    const second = startTurbopackWatcher(session, root, 20);
    expect(second).toBeNull();
    try {
      // FSEvents may replay events from just before the watcher started —
      // let those flush, then measure only the .animus write.
      await new Promise((resolve) => setTimeout(resolve, 150));
      handleWatchUpdate.mockClear();

      mkdirSync(join(root, '.animus'), { recursive: true });
      writeFileSync(join(root, '.animus', 'styles.css'), '/* generated */');
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(handleWatchUpdate).not.toHaveBeenCalled();
    } finally {
      first!.close();
    }
  });
});
