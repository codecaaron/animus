import {
  isJsonBoolean,
  isJsonObject,
  isJsonString,
} from '@animus-ui/assertions';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  BUTTON_SOURCE,
  disposeTempRoots,
  makeManifest,
  makeTempRoot,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from '../../extract/tests/session/session-fixtures';
import { ANIMUS_TURBOPACK_RULE_GLOB } from '../src/turbopack-config';
import { bindTurbopackWatchDeathReport, withAnimus } from '../src/with-animus';

import type { AnalyzeProjectInputs } from '../../extract/pipeline';
import type { TurbopackWatcherHandle } from '../../extract/session/turbopack-orchestrator';
import type { TurbopackLoaderOptions } from '../src/turbopack-loader';
import type { JsonValue } from '@animus-ui/assertions';
import type {
  TurbopackLoaderItem,
  TurbopackOptions,
  TurbopackRuleConfigItemOptions,
  TurbopackRuleConfigItemOrShortcut,
} from 'next/dist/server/config-shared';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn(),
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
let savedCwd: string;

const MANIFEST = JSON.stringify(makeManifest({ css: '.btn{margin:8;}' }));

function createProject(): string {
  const root = makeTempRoot('animus-turbo-orch-');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'system.ts'), 'export const system = {};\n');
  writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_SOURCE);
  return root;
}

function parseAnalysisInputs(
  bytes: string
): Pick<AnalyzeProjectInputs, 'devMode' | 'filesJson'> {
  const candidate: JsonValue = JSON.parse(bytes);
  if (
    !isJsonObject(candidate) ||
    !isJsonString(candidate.filesJson) ||
    !isJsonBoolean(candidate.devMode)
  ) {
    throw new TypeError('analysis-inputs.json is malformed');
  }
  return { devMode: candidate.devMode, filesJson: candidate.filesJson };
}

type AnimusNextConfig = ReturnType<ReturnType<typeof withAnimus>>;

type ForwardedLoaderOptions = Extract<
  TurbopackLoaderItem,
  { loader: string }
>['options'];

function turbopackOptions(config: Awaited<AnimusNextConfig>): TurbopackOptions {
  if (!('turbopack' in config)) {
    throw new TypeError(
      'withAnimus returned the webpack branch, not the Turbopack branch'
    );
  }
  return config.turbopack;
}

function isLoaderRule(
  rule: TurbopackRuleConfigItemOrShortcut | undefined
): rule is TurbopackRuleConfigItemOptions {
  return (
    rule !== undefined &&
    rule !== false &&
    !Array.isArray(rule) &&
    'loaders' in rule
  );
}

function isLoaderEntry(
  item: TurbopackLoaderItem
): item is Exclude<TurbopackLoaderItem, string> {
  return Object.prototype.toString.call(item) === '[object Object]';
}

function isForwardedString(
  value: ForwardedLoaderOptions[string]
): value is string {
  return Object.prototype.toString.call(value) === '[object String]';
}

function animusLoaderOptions(
  turbopack: TurbopackOptions
): Required<
  Pick<TurbopackLoaderOptions, 'rootDir' | 'sessionDir' | 'sessionId'>
> {
  const rule = turbopack.rules?.[ANIMUS_TURBOPACK_RULE_GLOB];
  if (!isLoaderRule(rule)) {
    throw new TypeError(
      `turbopack.rules['${ANIMUS_TURBOPACK_RULE_GLOB}'] carries no loader rule`
    );
  }
  const entry = rule.loaders[0];
  if (entry === undefined || !isLoaderEntry(entry)) {
    throw new TypeError('the Animus rule registers no loader options');
  }
  const read = (key: 'rootDir' | 'sessionDir' | 'sessionId'): string => {
    const value = entry.options[key];
    if (!isForwardedString(value)) {
      throw new TypeError(`loader option \`${key}\` must be a string`);
    }
    return value;
  };
  return {
    rootDir: read('rootDir'),
    sessionDir: read('sessionDir'),
    sessionId: read('sessionId'),
  };
}

beforeEach(() => {
  restoreGlobals = resetAnimusGlobals();
  savedCwd = process.cwd();
  mocks.loadSystemModule.mockReset().mockReturnValue({ ...SYSTEM_CONFIG });
  mocks.analyzeProject.mockReset().mockReturnValue(MANIFEST);
  mocks.clearAnalysisCache.mockReset();
});

afterEach(() => {
  process.chdir(savedCwd);
  restoreGlobals();
  vi.restoreAllMocks();
  disposeTempRoots();
});

describe('withAnimus Turbopack wiring', () => {
  test('inactive mode returns synchronously with no turbopack keys', () => {
    const root = createProject();
    process.chdir(root);
    const config = withAnimus({ system: './src/system.ts' })({});
    expect(config).not.toBeInstanceOf(Promise);
    expect('turbopack' in config).toBe(false);
  });

  test('active mode resolves after the session artifact set exists and merges config', async () => {
    const root = createProject();
    process.chdir(root);

    const pending = withAnimus({
      system: './src/system.ts',
      unstable_turbopack: { mode: 'on' },
    })({});
    expect(pending).toBeInstanceOf(Promise);
    const config = await pending;

    const turbopack = turbopackOptions(config);
    expect(turbopack.rules?.[ANIMUS_TURBOPACK_RULE_GLOB]).toBeDefined();
    const options = animusLoaderOptions(turbopack);
    // process.cwd() resolves the macOS /var → /private/var symlink
    expect(options).toMatchObject({ rootDir: realpathSync(root) });
    expect(options.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    const sessionDir = options.sessionDir;
    expect(sessionDir).toBe(
      join(realpathSync(root), '.animus', 'sessions', options.sessionId)
    );

    for (const artifact of [
      'styles.css',
      'system-props.js',
      'manifest.json',
      'analysis-inputs.json',
      'analysis-commit',
      'analysis-status.json',
    ]) {
      expect(existsSync(join(sessionDir, artifact)), artifact).toBe(true);
      expect(existsSync(join(root, '.animus', artifact)), artifact).toBe(false);
    }

    const inputs = parseAnalysisInputs(
      readFileSync(join(sessionDir, 'analysis-inputs.json'), 'utf-8')
    );
    const corpus: JsonValue = JSON.parse(inputs.filesJson);
    expect(corpus).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'src/Button.tsx',
          source: BUTTON_SOURCE,
        }),
      ])
    );
    expect(inputs.devMode).toBe(false);
    const diskManifest = JSON.parse(
      readFileSync(join(sessionDir, 'manifest.json'), 'utf-8')
    );
    expect(diskManifest).toEqual({
      __animusSession: expect.objectContaining({
        sessionId: options.sessionId,
      }),
      ...JSON.parse(MANIFEST),
    });

    expect(turbopack.resolveAlias?.['virtual:animus/system-props']).toBe(
      `./.animus/sessions/${options.sessionId}/system-props.js`
    );
    expect(turbopack.resolveAlias?.['.animus/styles.css']).toBe(
      `./.animus/sessions/${options.sessionId}/styles.css`
    );
  });

  test('a same-session re-analysis never rewrites byte-identical artifacts', async () => {
    const root = createProject();
    process.chdir(root);

    const first = await withAnimus({
      system: './src/system.ts',
      unstable_turbopack: { mode: 'on' },
    })({});
    const { sessionDir } = animusLoaderOptions(turbopackOptions(first));

    // bigint stat: write-then-rename gives a rewritten artifact a new inode,
    // so ino+mtimeNs equality proves the file was left untouched.
    const statOf = (name: string) => {
      const s = statSync(join(sessionDir, name), { bigint: true });
      return { ino: s.ino, mtimeNs: s.mtimeNs };
    };
    const before = {
      manifest: statOf('manifest.json'),
      inputs: statOf('analysis-inputs.json'),
      commit: statOf('analysis-commit'),
    };

    await withAnimus({
      system: './src/system.ts',
      unstable_turbopack: { mode: 'on' },
    })({});

    expect(statOf('manifest.json')).toEqual(before.manifest);
    expect(statOf('analysis-inputs.json')).toEqual(before.inputs);
    expect(statOf('analysis-commit')).toEqual(before.commit);
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

describe('Turbopack watcher death reporting (Next driver)', () => {
  function fakeHandle(): TurbopackWatcherHandle {
    return {
      close: () => {},
      died: false,
      onDied: null,
      settle: async () => {},
    };
  }

  test('a started watcher gets a death report on the plugin diagnostic surface', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handle = fakeHandle();

    bindTurbopackWatchDeathReport({ kind: 'started', handle }, '/proj');

    expect(handle.onDied).toBeTypeOf('function');
    handle.onDied?.();
    const line = String(error.mock.calls[0]?.[0]);
    expect(line).toContain('[animus-extract]');
    expect(line).toContain('/proj');
    expect(line).toMatch(/restart/);
  });

  test('a claim that started no watcher has nothing to observe', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    bindTurbopackWatchDeathReport({ kind: 'already-watched' }, '/proj');
    bindTurbopackWatchDeathReport({ kind: 'unavailable' }, '/proj');
    expect(error).not.toHaveBeenCalled();
  });
});
