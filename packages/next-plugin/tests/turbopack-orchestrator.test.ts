/**
 * Behavior pins for the Turbopack orchestration path (spec:
 * next-turbopack-integration): config resolution completes the extraction
 * and leaves the full artifact set on disk; the dev watcher feeds
 * existence-partitioned change sets into the session. Engine mocked at the
 * singleton seam, same harness as plugin-pipeline.test.ts.
 */
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
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { startTurbopackWatcher } from '../../extract/session/turbopack-orchestrator';
import { ANIMUS_TURBOPACK_RULE_GLOB } from '../src/turbopack-config';
import { bindTurbopackWatchDeathReport, withAnimus } from '../src/with-animus';
import {
  BUTTON_SOURCE,
  disposeTempRoots,
  makeManifest,
  makeTempRoot,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from './singleton-fixtures';

import type { AnalyzeProjectInputs } from '../../extract/pipeline';
import type {
  TurbopackWatcherHandle,
  TurbopackWatchOutcome,
} from '../../extract/session/turbopack-orchestrator';
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
let savedCwd: string;

/** What the engine double returns: a COMPLETE engine manifest carrying this
 *  suite's component CSS. The shared pipeline reads `manifest.sheets` /
 *  `manifest.components` directly, so a manifest that omits fields is not a
 *  manifest. */
const MANIFEST = JSON.stringify(makeManifest({ css: '.btn{margin:8;}' }));

/** The handle of a started claim — a test asserting on `close`/`settle`
 *  states which outcome it expects rather than assuming one. */
function startedHandle(outcome: TurbopackWatchOutcome): TurbopackWatcherHandle {
  if (outcome.kind !== 'started') {
    throw new Error(`expected a started watcher, got ${outcome.kind}`);
  }
  return outcome.handle;
}

function createProject(): string {
  const root = makeTempRoot('animus-turbo-orch-');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'system.ts'), 'export const system = {};\n');
  writeFileSync(join(root, 'src', 'Button.tsx'), BUTTON_SOURCE);
  return root;
}

// ── Artifact readers ───────────────────────────────────────────────────────
// The bundler only ever sees disk artifacts. Documents this suite asserts
// whole are matched as JSON; the one artifact whose value is consumed —
// the hydration corpus — is validated back into its owner's vocabulary.

/** The hydration corpus artifact, in the analyze-time input vocabulary the
 *  engine itself consumes. The corpus itself is a nested JSON string, so
 *  this read has to name its two fields rather than assert on the document
 *  as a whole. */
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

// ── Emitted Turbopack config readers ───────────────────────────────────────
// Next types a merged rule as a union of shorthands and forwards loader
// options across a process boundary as JSON; both owner contracts — the
// fragment `buildTurbopackConfig` emits and the `TurbopackLoaderOptions`
// the loader receives — are recovered by validation, never by assertion.

/** withAnimus's return union: the webpack config it builds synchronously,
 *  or the Turbopack config it resolves after the out-of-band extraction. */
type AnimusNextConfig = ReturnType<ReturnType<typeof withAnimus>>;

/** Turbopack forwards loader options as JSON; Next's loader item names that
 *  JSON value domain. */
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

/** The session identity `buildTurbopackConfig` always emits, read back out
 *  of the merged config into the loader's own option contract. */
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
    // Session identity travels via loader options (design D2).
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
      // Flat legacy paths are gone.
      expect(existsSync(join(root, '.animus', artifact)), artifact).toBe(false);
    }

    // The hydration artifact replays the exact analyze-time inputs
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
    // The disk manifest is the engine manifest plus the session envelope.
    const diskManifest = JSON.parse(
      readFileSync(join(sessionDir, 'manifest.json'), 'utf-8')
    );
    expect(diskManifest).toEqual({
      __animusSession: expect.objectContaining({
        sessionId: options.sessionId,
      }),
      ...JSON.parse(MANIFEST),
    });

    // Aliases point into the session-scoped tree.
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

    // A second config resolution in the SAME process (Next dev re-evaluates
    // the config): the new session instance adopts the process-claimed
    // identity and re-analyzes identical content over the same session dir.
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
  /** A watcher handle standing in for a registered project watch — the
   *  driver reaction under test is what happens when it DIES. */
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

    // The loss this pins: Next discarded the handle, so post-registration
    // watcher death (EMFILE/ENOSPC) had no driver reaction at all — the CLI
    // re-reports its degradation, Next reported nothing (report S10).
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
    // The orchestrator already warned for `unavailable`; a duplicate claim
    // means a live watcher for this root exists in this process.
    expect(error).not.toHaveBeenCalled();
  });
});

describe('startTurbopackWatcher', () => {
  test('feeds debounced, existence-partitioned change sets to the session', async () => {
    const root = createProject();
    // A real session with its analysis entry point replaced: this test owns
    // the watcher's change sets only, so the pipeline behind
    // handleWatchUpdate never runs.
    const { ExtractionSession } =
      await import('../../extract/session/extraction-session');
    const session = new ExtractionSession({ system: './src/system.ts' });
    session.rootDir = root;
    const handleWatchUpdate = vi
      .spyOn(session, 'handleWatchUpdate')
      .mockImplementation(async () => {});

    const claim = startTurbopackWatcher(session, root, 20);
    expect(claim.kind).toBe('started');
    const watcher = startedHandle(claim);
    try {
      let stamp = 0;
      await vi.waitFor(
        () => {
          // Re-arm the trigger on every poll: FSEvents registration can lag
          // under parallel suite load, and a one-shot write that lands
          // before the watcher is live would never be delivered.
          writeFileSync(
            join(root, 'src', 'New.tsx'),
            `export const N = ${stamp++};\n`
          );
          expect(
            handleWatchUpdate.mock.calls.some((c) =>
              c[0].modifiedFiles?.has(join(root, 'src', 'New.tsx'))
            )
          ).toBe(true);
        },
        { timeout: 10000, interval: 250 }
      );

      rmSync(join(root, 'src', 'New.tsx'));
      await vi.waitFor(
        () =>
          expect(
            handleWatchUpdate.mock.calls.some((c) =>
              c[0].removedFiles?.has(join(root, 'src', 'New.tsx'))
            )
          ).toBe(true),
        { timeout: 10000 }
      );
    } finally {
      watcher.close();
    }
    // FSEvents registration + delivery latency under parallel suite load.
  }, 30000);

  test('debounce-window events surface as debouncing status evidence before the flush', async () => {
    const root = createProject();
    // A REAL session (no analysis runs — the huge debounce keeps the flush
    // away): the watcher must feed its observations into the session's
    // status file so loaders ahead of the analysis can wait on evidence
    // (design D3 'debouncing').
    const { ExtractionSession } =
      await import('../../extract/session/extraction-session');
    const session = new ExtractionSession({ system: './src/system.ts' });
    session.rootDir = root;

    const watcher = startedHandle(startTurbopackWatcher(session, root, 60_000));
    try {
      // The watcher's debounce is the status deadline's ceiling.
      expect(session.debounceCeilingMs).toBe(60_000);

      const statusPath = join(session.sessionDir, 'analysis-status.json');
      let stamp = 0;
      await vi.waitFor(
        () => {
          // Re-arm per poll: FSEvents registration can lag under load.
          writeFileSync(
            join(root, 'src', 'Pending.tsx'),
            `export const P = ${stamp++};\n`
          );
          const status: JsonValue = JSON.parse(
            readFileSync(statusPath, 'utf-8')
          );
          expect(status).toMatchObject({
            state: 'debouncing',
            sessionId: session.sessionId,
            pending: expect.arrayContaining([
              ['src/Pending.tsx', expect.any(String)],
            ]),
          });
        },
        { timeout: 10000, interval: 250 }
      );
    } finally {
      watcher.close();
    }
  }, 30000);

  test('is idempotent per process and ignores .animus writes', async () => {
    const root = createProject();
    const { ExtractionSession } =
      await import('../../extract/session/extraction-session');
    const session = new ExtractionSession({ system: './src/system.ts' });
    session.rootDir = root;
    const handleWatchUpdate = vi
      .spyOn(session, 'handleWatchUpdate')
      .mockImplementation(async () => {});

    const first = startedHandle(startTurbopackWatcher(session, root, 20));
    const second = startTurbopackWatcher(session, root, 20);
    expect(second).toEqual({ kind: 'already-watched' });
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
      first.close();
    }
  });
});

describe('deferred status write containment', () => {
  test('a failing deferred status write warns instead of escaping the microtask', async () => {
    const root = createProject();
    const { ExtractionSession } =
      await import('../../extract/session/extraction-session');
    const session = new ExtractionSession({ system: './src/system.ts' });
    session.rootDir = root;
    // Occupy `.animus` with a regular FILE: the deferred microtask's
    // mkdirSync(sessionDir) then throws ENOTDIR on the session's first-ever
    // artifact write — the path that used to run OUTSIDE the watch handler's
    // try/catch and reach the process as an uncaught exception, killing the
    // dev server.
    writeFileSync(join(root, '.animus'), 'not a directory\n');
    const warned: string[] = [];
    // The session's own warn path emits one preformatted line per call.
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation((message: string) => {
        warned.push(message);
      });
    try {
      session.noteDebouncedWatchEvents([join(root, 'src', 'Button.tsx')]);
      // The status write is deferred to a microtask; let it run.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(
        warned.some((m) => m.includes('debounce status write failed'))
      ).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
