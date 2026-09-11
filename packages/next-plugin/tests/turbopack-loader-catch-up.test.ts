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
import {
  disposeTempRoots,
  makeComponent,
  makeManifest,
  makeTempRoot,
} from '../../extract/tests/session/session-fixtures';
import animusTurbopackLoader, {
  __setTurbopackLoaderEngineApiForTests,
  __setTurbopackLoaderFsForTests,
  __resetTurbopackLoaderStateForTests,
} from '../src/turbopack-loader';

import type { AnalysisStatus } from '../../extract/session/session-paths';
import type { TurbopackLoaderOptions } from '../src/turbopack-loader';

const SESSION_ID = 'session-under-test';
const OLD_SOURCE = 'export const c = 1;\n';
const NEW_SOURCE =
  "export const C = animus.styles({ margin: 8 }).asElement('div');\n";

interface GenerationSpec {
  sessionId?: string;
  generation?: number;
  epoch?: string;
  files: Array<{ path: string; source: string }>;
  manifestJson?: string;
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

function replayedManifest(filesJson: string): string {
  return JSON.stringify(
    makeManifest({ css: `/* replayed ${contentHash(filesJson)} */` })
  );
}

function writeGeneration(root: string, spec: GenerationSpec) {
  const sessionId = spec.sessionId ?? SESSION_ID;
  const sessionDir = sessionArtifactDir(root, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const generation = spec.generation ?? 1;
  const epoch = spec.epoch ?? 'epoch-1';
  const manifestJson =
    spec.manifestJson ??
    JSON.stringify(
      makeManifest({
        files: Object.fromEntries(spec.files.map((f) => [f.path, []])),
      })
    );
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
  mocks.analyzeProject
    .mockReset()
    .mockImplementation((filesJson: string) => replayedManifest(filesJson));
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

describe('retried artifact reads (design D1 read half)', () => {
  test('a commit rewritten between reads is retried and the transform derives from one consistent generation', async () => {
    const root = makeTempRoot('animus-turbo-protocol-');
    writeGeneration(root, {
      generation: 1,
      files: [{ path: 'src/C.tsx', source: OLD_SOURCE }],
    });

    let commitReads = 0;
    let torn = false;
    // A Proxy over the real reader keeps every overload the seam declares;
    // the apply trap only stages the tear.
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
    const g2Inputs = buildInputs([{ path: 'src/C.tsx', source: NEW_SOURCE }]);
    expect(code).toContain(replayedManifest(g2Inputs.filesJson));
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

    const commitPath = analysisCommitPath(sessionDir);
    const commitBytes = readFileSync(commitPath, 'utf-8');
    writeFileSync(commitPath, commitBytes);
    const bumped = new Date(Date.now() + 5000);
    utimesSync(commitPath, bumped, bumped);
    await runLoader({ root, source: OLD_SOURCE });
    expect(mocks.analyzeProject.mock.calls.length).toBe(after1);

    const stat = statSync(commitPath);
    writeGeneration(root, {
      generation: 2,
      epoch: 'epoch-b',
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
    const foreignDir = sessionArtifactDir(root, SESSION_ID);
    mkdirSync(foreignDir, { recursive: true });
    writeGeneration(root, {
      sessionId: 'some-other-invocation',
      files: [{ path: 'src/C.tsx', source: OLD_SOURCE }],
    });
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
    writeStatus(sessionDir, { state: 'starting', deadlineAt: undefined });
    const started = Date.now();
    const err = await expectRejection(runLoader({ root, source: NEW_SOURCE }));
    expect(err.message).toContain('ANIMUS_ANALYSIS_CATCHING_UP');
    expect(Date.now() - started).toBeGreaterThanOrEqual(2000);
    expect(err.dependencies).toContain(analysisCommitPath(sessionDir));
    expect(err.dependencies).toContain(analysisStatusPath(sessionDir));
  }, 15_000);

  test('the session-published deadline is the ONLY wait ceiling: a non-default watcher debounce is not cut short by a locally assumed default', async () => {
    const { root, sessionDir } = mismatchRoot();
    const CONFIGURED_DEBOUNCE_MS = 4_000;
    const STATUS_WATCHDOG_MS = 2_000;
    writeStatus(sessionDir, {
      state: 'analyzing',
      pending: [['src/C.tsx', contentHash(NEW_SOURCE)]],
      deadlineAt: Date.now() + CONFIGURED_DEBOUNCE_MS + STATUS_WATCHDOG_MS,
    });
    // 2.6s lands past the default-debounce ceiling (~2.1s) and well inside
    // the published deadline: a healthy in-flight analysis.
    setTimeout(() => {
      writeGeneration(root, {
        generation: 2,
        epoch: 'epoch-2',
        files: [{ path: 'src/C.tsx', source: NEW_SOURCE }],
      });
    }, 2_600);

    const { code } = await runLoader({ root, source: NEW_SOURCE });
    const g2Inputs = buildInputs([{ path: 'src/C.tsx', source: NEW_SOURCE }]);
    expect(code).toContain(replayedManifest(g2Inputs.filesJson));
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
    expect(code).toContain(replayedManifest(g2Inputs.filesJson));
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

describe("the replacements-epoch artifact is the transform's only registered dependency", () => {
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
      'src/C.tsx::C': makeComponent('src/C.tsx', 'r1'),
    };
    const sessionManifest = (css: string) =>
      JSON.stringify(makeManifest({ components: plan, css }));
    mocks.analyzeProject.mockImplementation(() => sessionManifest('.c{x:1}'));

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

    mocks.analyzeProject.mockImplementation(() => sessionManifest('.c{x:2}'));
    const edited = OLD_SOURCE.replace('c = 1', 'c = 2');
    writeFileSync(join(root, 'src', 'C.tsx'), edited);
    await session.handleWatchUpdate({
      modifiedFiles: new Set([join(root, 'src', 'C.tsx')]),
      removedFiles: new Set(),
    });

    expect(readFileSync(epochPath, 'utf-8')).toBe(epochBefore);
    expect(statSync(epochPath).mtimeMs).toBe(mtimeBefore);

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
