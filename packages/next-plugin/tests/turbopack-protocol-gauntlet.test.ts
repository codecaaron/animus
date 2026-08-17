/**
 * Turbopack protocol gauntlet — READER side (openspec:
 * next-turbopack-served-transform-coherence, design D1 read half + D3 + D4
 * — increment 02).
 *
 * Seqlock hydration keyed by commit CONTENT, foreign-session rejection,
 * and the full catch-up decision table, exercised at the seam level per D4:
 * fabricated commit/status artifacts (plus the REAL session writer for the
 * end-to-end style-only case), the loader's fs reads intercepted through
 * its injected filesystem seam where a torn window must be staged. No real
 * `next dev --turbopack` harness is built here (DEF-1 stays lazy).
 *
 * The engine doubles are injected through the loader's own worker-local
 * engine seam exactly like turbopack-loader.test.ts; `contentHash` and the
 * artifact vocabulary run for real.
 */
import { contentHash } from '@animus-ui/extract/pipeline';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = {
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn(),
  clearAnalysisCache: vi.fn(),
  transformFile: vi.fn(),
};

const engineDouble = () => ({
  loadSystemModule: mocks.loadSystemModule,
  extractFacts: () => '{"files":{},"parseCount":0}',
  analyzeProject: mocks.analyzeProject,
  clearAnalysisCache: mocks.clearAnalysisCache,
  transformFile: mocks.transformFile,
});

// Two injection points, one set of doubles. The loader builds its OWN
// worker-local engine (guardrail G1: the singleton module must never be
// imported from its graph), so it takes the doubles through its own seam
// (in beforeEach, reset in afterEach); the session reaches the engine through
// the singleton's globalThis-keyed override, set once for the file.
setEngineApiOverride(engineDouble);

import {
  ANALYSIS_COMMIT_ARTIFACT,
  analysisCommitPath,
  analysisInputsPath,
  analysisStatusPath,
  envelopeCssArtifact,
  envelopeJsonArtifact,
  manifestPath,
  replacementEpochPath,
  sessionArtifactDir,
  stylesPath,
} from '../../extract/session/session-paths';
import { setEngineApiOverride } from '../../extract/session/singleton';
import animusTurbopackLoader, {
  __setTurbopackLoaderEngineApiForTests,
  __setTurbopackLoaderFsForTests,
  __resetTurbopackLoaderStateForTests,
} from '../src/turbopack-loader';
import { disposeTempRoots, makeTempRoot } from './singleton-fixtures';

import type { AnalysisStatus } from '../../extract/session/session-paths';
import type { TurbopackLoaderOptions } from '../src/turbopack-loader';

const SESSION_ID = 'session-under-test';
const OLD_SOURCE = 'export const c = 1;\n';
const NEW_SOURCE =
  "export const C = animus.styles({ margin: 8 }).asElement('div');\n";

// ── Fabricated generation writer (real artifact SHAPES, scripted content) ──

interface GenerationSpec {
  sessionId?: string;
  generation?: number;
  epoch?: string;
  files: Array<{ path: string; source: string }>;
  manifestJson?: string;
  /** Pad the commit's epoch so two commits can be written byte-length-equal
   *  (the stat-masquerade case). */
  writeEpochArtifact?: boolean;
}

function buildInputs(files: GenerationSpec['files']) {
  return {
    analyzedHashes: Object.fromEntries(
      files.map((f) => [f.path, contentHash(f.source)])
    ),
    filesJson: JSON.stringify(
      files.map((f) => ({ ...f, hash: contentHash(f.source) }))
    ),
    scalesJson: '{}',
    variableMapJson: '{}',
    contextualVarsJson: null,
    propConfigJson: '{}',
    groupRegistryJson: '{}',
    packageResolutionJson: '{}',
    devMode: true,
    emitterConfigJson: '{}',
    selectorAliasesJson: null,
    globalStyleBlocksJson: null,
    pathAliasesJson: null,
    keyframesJson: null,
    staticCssJson: null,
    conditionAliasesJson: null,
    externalDirsJson: null,
  };
}

/** Write a full committed generation the way the session writer shapes it:
 *  enveloped payloads (via the shared session-paths encoding helpers) + a
 *  commit whose hashes cover the DISK bytes. */
function writeGeneration(root: string, spec: GenerationSpec) {
  const sessionId = spec.sessionId ?? SESSION_ID;
  const sessionDir = sessionArtifactDir(root, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const generation = spec.generation ?? 1;
  const epoch = spec.epoch ?? 'epoch-1';
  const manifestJson = spec.manifestJson ?? `{"generation":${generation}}`;
  const envelope = {
    sessionId,
    generation,
    replacementEpoch: epoch,
    payloadHash: contentHash(manifestJson),
  };
  const envelopeJson = JSON.stringify(envelope);
  const manifestBytes = envelopeJsonArtifact(manifestJson, envelopeJson);
  const inputsBytes = envelopeJsonArtifact(
    JSON.stringify(buildInputs(spec.files)),
    envelopeJson
  );
  const stylesBytes = envelopeCssArtifact(`.g${generation}{}`, envelopeJson);
  writeFileSync(manifestPath(sessionDir), manifestBytes);
  writeFileSync(analysisInputsPath(sessionDir), inputsBytes);
  writeFileSync(stylesPath(sessionDir), stylesBytes);
  writeFileSync(
    analysisCommitPath(sessionDir),
    JSON.stringify({
      schema: 1,
      sessionId,
      generation,
      replacementEpoch: epoch,
      manifestHash: contentHash(manifestBytes),
      inputsHash: contentHash(inputsBytes),
      stylesHash: contentHash(stylesBytes),
    })
  );
  if (spec.writeEpochArtifact) {
    writeFileSync(
      replacementEpochPath(sessionDir),
      JSON.stringify({ schema: 1, sessionId, epoch })
    );
  }
  return { sessionDir };
}

function writeStatus(
  sessionDir: string,
  status: Partial<AnalysisStatus> & { state: AnalysisStatus['state'] }
): void {
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(
    analysisStatusPath(sessionDir),
    JSON.stringify({
      schema: 1,
      sessionId: SESSION_ID,
      attemptId: 1,
      pending: [],
      deadlineAt: Date.now() + 10_000,
      ...status,
    })
  );
}

// ── Async loader driver ────────────────────────────────────────────────────

/** Every loader failure carries the dependencies registered before it was
 *  thrown (design D3) — the driver below attaches them to the rejection. */
interface LoaderRejection extends Error {
  dependencies?: string[];
}

function runLoader(args: {
  root: string;
  relPath?: string;
  source: string;
  options?: TurbopackLoaderOptions;
}): Promise<{ code: string; dependencies: string[] }> {
  const dependencies: string[] = [];
  return new Promise((resolve, reject) => {
    const ctx: ThisParameterType<typeof animusTurbopackLoader> = {
      resourcePath: join(args.root, args.relPath ?? 'src/C.tsx'),
      rootContext: args.root,
      getOptions: () => ({
        rootDir: args.root,
        sessionId: SESSION_ID,
        sessionDir: sessionArtifactDir(args.root, SESSION_ID),
        ...args.options,
      }),
      addDependency: (file: string) => {
        dependencies.push(file);
      },
      async:
        () =>
        (err: Error | null, content?: string): void => {
          if (err) reject(Object.assign(err, { dependencies }));
          else resolve({ code: content ?? '', dependencies });
        },
    };
    const sync = animusTurbopackLoader.call(ctx, args.source);
    // A legacy synchronous return would bypass the callback — surface it
    // so assertions fail loudly instead of hanging.
    if (sync !== undefined) resolve({ code: String(sync), dependencies });
  });
}

async function expectRejection(
  promise: Promise<{ code: string; dependencies: string[] }>
): Promise<LoaderRejection> {
  const rejection = await promise.then(
    () => null,
    (err: LoaderRejection) => err
  );
  if (rejection === null) {
    throw new Error('expected the loader invocation to fail');
  }
  return rejection;
}

beforeEach(() => {
  mocks.loadSystemModule.mockReset();
  mocks.analyzeProject.mockReset().mockImplementation(
    // Replay marker: the manifest the engine returns embeds the inputs'
    // filesJson hash so tests can tell WHICH generation was hydrated.
    (filesJson: string) =>
      `{"replayed":${JSON.stringify(contentHash(filesJson))}}`
  );
  mocks.clearAnalysisCache.mockReset();
  mocks.transformFile
    .mockReset()
    .mockImplementation(
      (source: string, filename: string, manifestJson: string) => ({
        code: `${source}/* via ${manifestJson} */`,
        hasComponents: true,
      })
    );
  __resetTurbopackLoaderStateForTests?.();
  __setTurbopackLoaderEngineApiForTests?.(engineDouble);
});

afterEach(() => {
  __setTurbopackLoaderEngineApiForTests?.(null);
  __setTurbopackLoaderFsForTests?.(null);
  disposeTempRoots();
});

describe('seqlock hydration (design D1 read half)', () => {
  test('a commit rewritten between reads is retried and the transform derives from one consistent generation', async () => {
    const root = makeTempRoot('animus-turbo-protocol-');
    writeGeneration(root, {
      generation: 1,
      files: [{ path: 'src/C.tsx', source: OLD_SOURCE }],
    });

    // Stage the tear through the loader's fs seam: after the FIRST commit
    // read returns generation 1, generation 2 lands on disk — the payload
    // reads then hash-mismatch commit 1 and the loader must retry against
    // the settled generation 2.
    let commitReads = 0;
    let torn = false;
    // The double IS `fs.readFileSync`: an apply trap observes each commit
    // read and stages the tear, then the real reader answers the call — so
    // the seam keeps every overload of the owner's declared reader instead
    // of restating one of them.
    const tearingReadFileSync = new Proxy(readFileSync, {
      apply: (target, thisArg, callArgs) => {
        const bytes = target.apply(thisArg, callArgs);
        if (String(callArgs[0]).endsWith(ANALYSIS_COMMIT_ARTIFACT)) {
          commitReads += 1;
          if (!torn) {
            torn = true;
            writeGeneration(root, {
              generation: 2,
              epoch: 'epoch-2',
              files: [{ path: 'src/C.tsx', source: NEW_SOURCE }],
            });
          }
        }
        return bytes;
      },
    });
    __setTurbopackLoaderFsForTests!({
      existsSync: (p) => existsSync(p),
      readFileSync: tearingReadFileSync,
    });

    const { code } = await runLoader({ root, source: NEW_SOURCE });
    // The served transform derives from generation 2's replayed manifest —
    // never a G1-commit/G2-payload mixture.
    const g2Inputs = buildInputs([{ path: 'src/C.tsx', source: NEW_SOURCE }]);
    expect(code).toContain(
      `{"replayed":${JSON.stringify(contentHash(g2Inputs.filesJson))}}`
    );
    // The seqlock actually retried: commit read at least twice.
    expect(commitReads).toBeGreaterThanOrEqual(2);
  });

  test('hydration is keyed by commit content: byte-identical rewrite reuses it, a stat-identical different commit re-hydrates', async () => {
    const root = makeTempRoot('animus-turbo-protocol-');
    const { sessionDir } = writeGeneration(root, {
      generation: 1,
      epoch: 'epoch-a',
      files: [{ path: 'src/C.tsx', source: OLD_SOURCE }],
    });
    await runLoader({ root, source: OLD_SOURCE });
    const after1 = mocks.analyzeProject.mock.calls.length;
    expect(after1).toBe(1);

    // Byte-identical commit rewrite with a bumped mtime: NO re-hydration.
    const commitPath = analysisCommitPath(sessionDir);
    const commitBytes = readFileSync(commitPath, 'utf-8');
    writeFileSync(commitPath, commitBytes);
    const bumped = new Date(Date.now() + 5000);
    utimesSync(commitPath, bumped, bumped);
    await runLoader({ root, source: OLD_SOURCE });
    expect(mocks.analyzeProject.mock.calls.length).toBe(after1);

    // A DIFFERENT generation whose commit has the same byte length and a
    // restored mtime (stat-identical) still re-hydrates: identity is the
    // commit CONTENT, never file stat.
    const stat = statSync(commitPath);
    writeGeneration(root, {
      generation: 2,
      epoch: 'epoch-b', // same length as 'epoch-a'
      files: [{ path: 'src/C.tsx', source: NEW_SOURCE }],
    });
    const rewritten = readFileSync(commitPath, 'utf-8');
    expect(rewritten.length).toBe(commitBytes.length);
    utimesSync(commitPath, stat.atime, stat.mtime);
    await runLoader({ root, source: NEW_SOURCE });
    expect(mocks.analyzeProject.mock.calls.length).toBe(after1 + 1);
  });
});

describe('session isolation (design D2)', () => {
  test('foreign-session artifacts are rejected with a stable diagnostic and registered dependencies', async () => {
    const root = makeTempRoot('animus-turbo-protocol-');
    // Artifacts embedding ANOTHER session's id sit where this loader's
    // options point (stale/foreign directory reuse).
    const foreignDir = sessionArtifactDir(root, SESSION_ID);
    mkdirSync(foreignDir, { recursive: true });
    writeGeneration(root, {
      sessionId: 'some-other-invocation',
      files: [{ path: 'src/C.tsx', source: OLD_SOURCE }],
    });
    // Point the loader's sessionDir at the foreign artifacts.
    const err = await expectRejection(
      runLoader({
        root,
        source: OLD_SOURCE,
        options: {
          sessionDir: sessionArtifactDir(root, 'some-other-invocation'),
        },
      })
    );
    expect(err.message).toContain('ANIMUS_FOREIGN_SESSION');
    const foreignSessionDir = sessionArtifactDir(root, 'some-other-invocation');
    expect(err.dependencies).toContain(analysisCommitPath(foreignSessionDir));
    expect(err.dependencies).toContain(analysisStatusPath(foreignSessionDir));
  });
});

describe('catch-up decision table (design D3 — verbatim)', () => {
  /** One committed generation covering src/C.tsx at OLD_SOURCE; the loader
   *  then observes NEW_SOURCE — the mismatch that enters the table. */
  function mismatchRoot() {
    const root = makeTempRoot('animus-turbo-protocol-');
    const { sessionDir } = writeGeneration(root, {
      files: [{ path: 'src/C.tsx', source: OLD_SOURCE }],
    });
    return { root, sessionDir };
  }

  test('row: status absent (commit present) → fail immediately — protocol/setup failure', async () => {
    const { root } = mismatchRoot();
    const started = Date.now();
    const err = await expectRejection(runLoader({ root, source: NEW_SOURCE }));
    expect(err.message).toContain('ANIMUS_ANALYSIS_CATCHING_UP');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test('row: foreign-session status → fail', async () => {
    const { root, sessionDir } = mismatchRoot();
    writeStatus(sessionDir, {
      state: 'analyzing',
      sessionId: 'someone-else',
    });
    const err = await expectRejection(runLoader({ root, source: NEW_SOURCE }));
    expect(err.message).toContain('ANIMUS_FOREIGN_SESSION');
  });

  test('row: idle status → ANIMUS_ANALYSIS_NOT_SCHEDULED immediately, naming the file (watcher miss is surfaced, not waited on)', async () => {
    const { root, sessionDir } = mismatchRoot();
    writeStatus(sessionDir, { state: 'idle' });
    const started = Date.now();
    const err = await expectRejection(runLoader({ root, source: NEW_SOURCE }));
    expect(err.message).toContain('ANIMUS_ANALYSIS_NOT_SCHEDULED');
    expect(err.message).toContain('src/C.tsx');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test('row: failed status → the underlying analysis diagnostic is surfaced', async () => {
    const { root, sessionDir } = mismatchRoot();
    writeStatus(sessionDir, {
      state: 'failed',
      diagnostic: 'Error: unresolved token space.9000',
    });
    const err = await expectRejection(runLoader({ root, source: NEW_SOURCE }));
    expect(err.message).toContain('unresolved token space.9000');
  });

  test('row: active attempt that has NOT observed this hash → ANIMUS_ANALYSIS_NOT_SCHEDULED immediately', async () => {
    const { root, sessionDir } = mismatchRoot();
    writeStatus(sessionDir, {
      state: 'analyzing',
      pending: [['src/Other.tsx', 'someotherhash']],
    });
    const started = Date.now();
    const err = await expectRejection(runLoader({ root, source: NEW_SOURCE }));
    expect(err.message).toContain('ANIMUS_ANALYSIS_NOT_SCHEDULED');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test('row: active attempt past deadlineAt → ANIMUS_ANALYSIS_STALLED', async () => {
    const { root, sessionDir } = mismatchRoot();
    writeStatus(sessionDir, {
      state: 'analyzing',
      pending: [['src/C.tsx', contentHash(NEW_SOURCE)]],
      deadlineAt: Date.now() - 1,
    });
    const err = await expectRejection(runLoader({ root, source: NEW_SOURCE }));
    expect(err.message).toContain('ANIMUS_ANALYSIS_STALLED');
  });

  test('row: commit absent + active state carrying NO deadline (legacy/torn status shape) → wait to the absolute cap; ANIMUS_ANALYSIS_CATCHING_UP with dependencies', async () => {
    const root = makeTempRoot('animus-turbo-protocol-');
    const sessionDir = sessionArtifactDir(root, SESSION_ID);
    // The schema-2 writer always publishes `deadlineAt`; a status without it
    // is the only shape whose wait the loader still has to bound itself.
    writeStatus(sessionDir, { state: 'starting', deadlineAt: undefined });
    const started = Date.now();
    const err = await expectRejection(runLoader({ root, source: NEW_SOURCE }));
    expect(err.message).toContain('ANIMUS_ANALYSIS_CATCHING_UP');
    // It genuinely waited (watchdog + margin).
    expect(Date.now() - started).toBeGreaterThanOrEqual(2000);
    expect(err.dependencies).toContain(analysisCommitPath(sessionDir));
    expect(err.dependencies).toContain(analysisStatusPath(sessionDir));
  }, 15_000);

  test('the session-published deadline is the ONLY wait ceiling: a non-default watcher debounce is not cut short by a locally assumed default', async () => {
    const { root, sessionDir } = mismatchRoot();
    // What `startTurbopackWatcher(session, root, 4000)` publishes: the
    // session derives `deadlineAt` from its configured debounce ceiling plus
    // the status watchdog, so a project that widened the watcher debounce
    // has a deadline far beyond the default one.
    const CONFIGURED_DEBOUNCE_MS = 4_000;
    const STATUS_WATCHDOG_MS = 2_000;
    writeStatus(sessionDir, {
      state: 'analyzing',
      pending: [['src/C.tsx', contentHash(NEW_SOURCE)]],
      deadlineAt: Date.now() + CONFIGURED_DEBOUNCE_MS + STATUS_WATCHDOG_MS,
    });
    // The covering commit lands after the ceiling the loader used to compute
    // from the DEFAULT debounce (75 + watchdog 2000 + margin 50 ≈ 2.1s) and
    // well inside the published deadline: a healthy in-flight analysis.
    setTimeout(() => {
      writeGeneration(root, {
        generation: 2,
        epoch: 'epoch-2',
        files: [{ path: 'src/C.tsx', source: NEW_SOURCE }],
      });
    }, 2_600);

    const { code } = await runLoader({ root, source: NEW_SOURCE });
    const g2Inputs = buildInputs([{ path: 'src/C.tsx', source: NEW_SOURCE }]);
    expect(code).toContain(
      `{"replayed":${JSON.stringify(contentHash(g2Inputs.filesJson))}}`
    );
  }, 15_000);

  test('the published deadline also BOUNDS the wait: an attempt that misses it ends in ANIMUS_ANALYSIS_STALLED', async () => {
    const { root, sessionDir } = mismatchRoot();
    writeStatus(sessionDir, {
      state: 'analyzing',
      pending: [['src/C.tsx', contentHash(NEW_SOURCE)]],
      deadlineAt: Date.now() + 300,
    });
    const started = Date.now();
    const err = await expectRejection(runLoader({ root, source: NEW_SOURCE }));
    expect(err.message).toContain('ANIMUS_ANALYSIS_STALLED');
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
  });

  test('row: commit old + pending contains this file@hash → wait; the advancing commit is hydrated and transformed with NO diagnostic and NO commit/status dependencies', async () => {
    const { root, sessionDir } = mismatchRoot();
    writeStatus(sessionDir, {
      state: 'analyzing',
      pending: [['src/C.tsx', contentHash(NEW_SOURCE)]],
      deadlineAt: Date.now() + 60_000,
    });
    // The orchestrator commits the covering generation mid-wait.
    setTimeout(() => {
      writeGeneration(root, {
        generation: 2,
        epoch: 'epoch-2',
        files: [{ path: 'src/C.tsx', source: NEW_SOURCE }],
      });
    }, 100);

    const { code, dependencies } = await runLoader({
      root,
      source: NEW_SOURCE,
    });
    const g2Inputs = buildInputs([{ path: 'src/C.tsx', source: NEW_SOURCE }]);
    expect(code).toContain(
      `{"replayed":${JSON.stringify(contentHash(g2Inputs.filesJson))}}`
    );
    // Successful paths register no commit/status dependency (D3).
    expect(dependencies).not.toContain(analysisCommitPath(sessionDir));
    expect(dependencies).not.toContain(analysisStatusPath(sessionDir));
  });

  test('missing artifacts passthrough: no commit AND no status → source unchanged', async () => {
    const root = makeTempRoot('animus-turbo-protocol-');
    mkdirSync(sessionArtifactDir(root, SESSION_ID), { recursive: true });
    const { code } = await runLoader({ root, source: OLD_SOURCE });
    expect(code).toBe(OLD_SOURCE);
  });

  test('an analyzed file is never passed through raw: every failure path serves a diagnostic, not the source', async () => {
    const { root, sessionDir } = mismatchRoot();
    // The writer's own parameter contract types every row, so the pending
    // entries stay the status artifact's [sourceKey, hash] pairs.
    const statuses: Array<Parameters<typeof writeStatus>[1] | undefined> = [
      undefined,
      { state: 'idle' },
      { state: 'failed', diagnostic: 'boom' },
      {
        state: 'analyzing',
        pending: [['src/Other.tsx', 'h']],
      },
    ];
    for (const status of statuses) {
      if (status) writeStatus(sessionDir, status);
      const err = await expectRejection(
        runLoader({ root, source: NEW_SOURCE })
      );
      expect(err).toBeInstanceOf(Error);
    }
  });
});

describe('epoch fan-out dependency (T attachment)', () => {
  test('a successful transform registers the session epoch artifact — and ONLY it — as its artifact dependency', async () => {
    const root = makeTempRoot('animus-turbo-protocol-');
    const { sessionDir } = writeGeneration(root, {
      files: [{ path: 'src/C.tsx', source: OLD_SOURCE }],
      writeEpochArtifact: true,
    });
    const { dependencies } = await runLoader({ root, source: OLD_SOURCE });
    expect(dependencies).toContain(replacementEpochPath(sessionDir));
    expect(dependencies).not.toContain(analysisCommitPath(sessionDir));
    expect(dependencies).not.toContain(analysisStatusPath(sessionDir));
  });
});

describe('style-only end-to-end through the real session writer', () => {
  test('a style-only re-analysis keeps the epoch byte-identical while the loader keeps transforming from the new commit', async () => {
    const root = makeTempRoot('animus-turbo-protocol-');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'system.ts'), 'export const s = {};\n');
    writeFileSync(join(root, 'src', 'C.tsx'), OLD_SOURCE);

    mocks.loadSystemModule.mockReturnValue({
      propConfig: '{"props":{}}',
      groupRegistry: '{"groups":{}}',
      scalesJson: '{"space":{}}',
      variableMapJson: '{"map":{}}',
      variableCss: ':root{}',
      contextualVarsJson: null,
      selectorAliases: null,
      globalStyleBlocks: null,
      keyframesBlocks: null,
    });
    const plan = {
      'src/C.tsx::C': { file: 'src/C.tsx', replacement: 'r1' },
    };
    const sessionManifest = (css: string) =>
      JSON.stringify({
        components: plan,
        css,
        sheets: { global: '' },
        system_prop_map: {},
        dynamic_props: {},
        diagnostics: [],
      });
    mocks.analyzeProject.mockImplementation(() => sessionManifest('.c{x:1}'));

    // Real writer: full pipeline, then a style-only watch analysis. The
    // loader hydrates from the inputs corpus, so this session models
    // Turbopack orchestration (which persists it).
    const { ExtractionSession } =
      await import('../../extract/session/extraction-session');
    const session = new ExtractionSession({ system: './src/system.ts' });
    session.rootDir = root;
    session.persistAnalysisInputs = true;
    await session.runFullPipeline();

    const epochPath = replacementEpochPath(session.sessionDir);
    const epochBefore = readFileSync(epochPath, 'utf-8');
    const mtimeBefore = statSync(epochPath).mtimeMs;

    const run = () =>
      runLoader({
        root,
        source: OLD_SOURCE,
        options: {
          sessionId: session.sessionId,
          sessionDir: session.sessionDir,
        },
      });
    const first = await run();
    expect(first.dependencies).toContain(epochPath);

    // Style-only: same plans, new css → epoch bytes untouched.
    mocks.analyzeProject.mockImplementation(() => sessionManifest('.c{x:2}'));
    const edited = OLD_SOURCE.replace('c = 1', 'c = 2');
    writeFileSync(join(root, 'src', 'C.tsx'), edited);
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(root, 'src', 'C.tsx')]),
      removedFiles: new Set(),
    });

    expect(readFileSync(epochPath, 'utf-8')).toBe(epochBefore);
    expect(statSync(epochPath).mtimeMs).toBe(mtimeBefore);

    // The loader hydrates the advanced commit and serves the new source.
    const second = await runLoader({
      root,
      source: edited,
      options: {
        sessionId: session.sessionId,
        sessionDir: session.sessionDir,
      },
    });
    expect(second.code).toContain('/* via ');
  });
});
