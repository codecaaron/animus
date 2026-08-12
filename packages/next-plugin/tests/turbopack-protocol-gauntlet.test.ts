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
 * The engine adapter is mocked at the pipeline factory seam exactly like
 * turbopack-loader.test.ts; `contentHash` and the artifact vocabulary run
 * for real.
 */
import { contentHash } from '@animus-ui/extract/pipeline';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn(),
  clearAnalysisCache: vi.fn(),
  transformFile: vi.fn(),
}));

vi.mock('@animus-ui/extract/pipeline', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@animus-ui/extract/pipeline')>();
  return {
    ...actual,
    createV2EngineApi: () => () => ({
      loadSystemModule: mocks.loadSystemModule,
      extractFacts: () => '{"files":{},"parseCount":0}',
      analyzeProject: mocks.analyzeProject,
      clearAnalysisCache: mocks.clearAnalysisCache,
      transformFile: mocks.transformFile,
    }),
  };
});

// The module mock above reaches the loader (which imports the pipeline by
// package id); the session imports the pipeline RELATIVELY from inside the
// extract package, so its engine access is injected through the singleton's
// globalThis-keyed seam instead — same mock fns, both paths.
setEngineApiOverride(() => ({
  loadSystemModule: mocks.loadSystemModule,
  analyzeProject: mocks.analyzeProject,
  clearAnalysisCache: mocks.clearAnalysisCache,
  transformFile: mocks.transformFile,
}));

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
  __setTurbopackLoaderFsForTests,
  __resetTurbopackLoaderStateForTests,
} from '../src/turbopack-loader';

import type { AnalysisStatus } from '../../extract/session/session-paths';

const tempRoots: string[] = [];

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

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'animus-turbo-protocol-'));
  tempRoots.push(root);
  return root;
}

function buildInputs(files: GenerationSpec['files']): Record<string, unknown> {
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
function writeGeneration(
  root: string,
  spec: GenerationSpec
): { sessionDir: string } {
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

function runLoader(args: {
  root: string;
  relPath?: string;
  source: string;
  options?: Record<string, unknown>;
}): Promise<{ code: string; dependencies: string[] }> {
  const dependencies: string[] = [];
  return new Promise((resolve, reject) => {
    const ctx = {
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
    const sync = animusTurbopackLoader.call(
      ctx as ThisParameterType<typeof animusTurbopackLoader>,
      args.source
    );
    // A legacy synchronous return would bypass the callback — surface it
    // so assertions fail loudly instead of hanging.
    if (typeof sync === 'string') resolve({ code: sync, dependencies });
  });
}

async function expectRejection(
  promise: Promise<unknown>
): Promise<Error & { dependencies?: string[] }> {
  try {
    await promise;
  } catch (err) {
    return err as Error & { dependencies?: string[] };
  }
  throw new Error('expected the loader invocation to fail');
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
});

afterEach(() => {
  __setTurbopackLoaderFsForTests?.(null);
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('seqlock hydration (design D1 read half)', () => {
  test('a commit rewritten between reads is retried and the transform derives from one consistent generation', async () => {
    const root = makeRoot();
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
    __setTurbopackLoaderFsForTests!({
      existsSync: (p) => existsSync(p),
      readFileSync: ((p: string, enc: never) => {
        const bytes = readFileSync(p, enc);
        if (String(p).endsWith(ANALYSIS_COMMIT_ARTIFACT)) {
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
      }) as (typeof import('fs'))['readFileSync'],
    });

    const { code } = await runLoader({ root, source: NEW_SOURCE });
    // The served transform derives from generation 2's replayed manifest —
    // never a G1-commit/G2-payload mixture.
    const g2Inputs = buildInputs([{ path: 'src/C.tsx', source: NEW_SOURCE }]);
    expect(code).toContain(
      `{"replayed":${JSON.stringify(contentHash(g2Inputs.filesJson as string))}}`
    );
    // The seqlock actually retried: commit read at least twice.
    expect(commitReads).toBeGreaterThanOrEqual(2);
  });

  test('hydration is keyed by commit content: byte-identical rewrite reuses it, a stat-identical different commit re-hydrates', async () => {
    const root = makeRoot();
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
    const root = makeRoot();
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
  function mismatchRoot(): { root: string; sessionDir: string } {
    const root = makeRoot();
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

  test('row: commit absent + active state → wait; timeout throws ANIMUS_ANALYSIS_CATCHING_UP with dependencies', async () => {
    const root = makeRoot();
    const sessionDir = sessionArtifactDir(root, SESSION_ID);
    writeStatus(sessionDir, {
      state: 'starting',
      deadlineAt: Date.now() + 60_000,
    });
    const started = Date.now();
    const err = await expectRejection(runLoader({ root, source: NEW_SOURCE }));
    expect(err.message).toContain('ANIMUS_ANALYSIS_CATCHING_UP');
    // It genuinely waited (debounce ceiling + watchdog + margin).
    expect(Date.now() - started).toBeGreaterThanOrEqual(2000);
    expect(err.dependencies).toContain(analysisCommitPath(sessionDir));
    expect(err.dependencies).toContain(analysisStatusPath(sessionDir));
  }, 15_000);

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
      `{"replayed":${JSON.stringify(contentHash(g2Inputs.filesJson as string))}}`
    );
    // Successful paths register no commit/status dependency (D3).
    expect(dependencies).not.toContain(analysisCommitPath(sessionDir));
    expect(dependencies).not.toContain(analysisStatusPath(sessionDir));
  });

  test('missing artifacts passthrough: no commit AND no status → source unchanged', async () => {
    const root = makeRoot();
    mkdirSync(sessionArtifactDir(root, SESSION_ID), { recursive: true });
    const { code } = await runLoader({ root, source: OLD_SOURCE });
    expect(code).toBe(OLD_SOURCE);
  });

  test('an analyzed file is never passed through raw: every failure path serves a diagnostic, not the source', async () => {
    const { root, sessionDir } = mismatchRoot();
    for (const status of [
      undefined,
      { state: 'idle' as const },
      { state: 'failed' as const, diagnostic: 'boom' },
      {
        state: 'analyzing' as const,
        pending: [['src/Other.tsx', 'h']] as Array<[string, string]>,
      },
    ]) {
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
    const root = makeRoot();
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
    const root = makeRoot();
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
