/**
 * Behavior pins for the Turbopack loader (spec: next-turbopack-integration /
 * Stateless per-file transformation + turbopack-artifact-transactions):
 * everything derives from the incoming source, serializable options
 * (carrying the session identity), and the session's COMMITTED disk
 * artifacts. The engine adapter is mocked at the pipeline factory seam;
 * hydration replays analyzeProject from the committed analysis-inputs,
 * keyed by commit CONTENT (never file stat). The loader is async
 * (webpack-loader convention: `this.async()`), required for the catch-up
 * wait.
 */
import { contentHash } from '@animus-ui/extract/pipeline';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  analyzeProject: vi.fn(),
  transformFile: vi.fn(),
}));

vi.mock('@animus-ui/extract/pipeline', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@animus-ui/extract/pipeline')>();
  return {
    ...actual,
    createV2EngineApi: () => () => ({
      analyzeProject: mocks.analyzeProject,
      transformFile: mocks.transformFile,
    }),
  };
});

import {
  analysisCommitPath,
  sessionArtifactDir,
} from '../../extract/session/session-paths';
import animusTurbopackLoader, {
  __resetTurbopackLoaderStateForTests,
} from '../src/turbopack-loader';

const tempRoots: string[] = [];
const SESSION_ID = 'loader-test-session';

/** Fabricate a committed generation covering the given files. */
function makeRoot(files: Array<{ path: string; source: string }>): string {
  const root = mkdtempSync(join(tmpdir(), 'animus-turbo-loader-'));
  tempRoots.push(root);
  if (files.length === 0) return root;
  writeCommitted(root, files);
  return root;
}

function writeCommitted(
  root: string,
  files: Array<{ path: string; source: string }>,
  manifestJson = '{"files":{}}'
): void {
  const sessionDir = sessionArtifactDir(root, SESSION_ID);
  mkdirSync(sessionDir, { recursive: true });
  const envelope = JSON.stringify({
    sessionId: SESSION_ID,
    generation: 1,
    replacementEpoch: 'e1',
    payloadHash: contentHash(manifestJson),
  });
  const manifestBytes = `{"__animusSession":${envelope},${manifestJson.slice(1)}`;
  const inputsBytes = JSON.stringify({
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
  });
  const stylesBytes = `.s{}\n/* __animusSession ${envelope} */\n`;
  writeFileSync(join(sessionDir, 'manifest.json'), manifestBytes);
  writeFileSync(join(sessionDir, 'analysis-inputs.json'), inputsBytes);
  writeFileSync(join(sessionDir, 'styles.css'), stylesBytes);
  writeFileSync(
    analysisCommitPath(sessionDir),
    JSON.stringify({
      schema: 1,
      sessionId: SESSION_ID,
      generation: 1,
      replacementEpoch: 'e1',
      manifestHash: contentHash(manifestBytes),
      inputsHash: contentHash(inputsBytes),
      stylesHash: contentHash(stylesBytes),
    })
  );
}

function runLoader(
  root: string,
  relPath: string,
  source: string,
  options: Record<string, unknown> = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const ctx = {
      resourcePath: join(root, relPath),
      rootContext: root,
      getOptions: () => ({
        rootDir: root,
        sessionId: SESSION_ID,
        sessionDir: sessionArtifactDir(root, SESSION_ID),
        ...options,
      }),
      addDependency: () => {},
      async:
        () =>
        (err: Error | null, content?: string): void => {
          if (err) reject(err);
          else resolve(content ?? '');
        },
    };
    const sync = animusTurbopackLoader.call(
      ctx as ThisParameterType<typeof animusTurbopackLoader>,
      source
    );
    if (typeof sync === 'string') resolve(sync);
  });
}

beforeEach(() => {
  mocks.analyzeProject.mockReset().mockReturnValue('{"files":{}}');
  mocks.transformFile.mockReset().mockImplementation((source: string) => ({
    code: source,
    hasComponents: false,
  }));
  __resetTurbopackLoaderStateForTests?.();
});

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('turbopack loader hydration', () => {
  test('passes through untouched when no committed artifacts exist for the session', async () => {
    const root = makeRoot([]);
    const before = mocks.analyzeProject.mock.calls.length;
    const out = await runLoader(root, 'app/page.tsx', 'export const a = 1;\n');
    expect(out).toBe('export const a = 1;\n');
    expect(mocks.analyzeProject.mock.calls.length).toBe(before);
  });

  test('fails closed when a commit references a missing payload (torn set is never consumed)', async () => {
    const root = makeRoot([
      { path: 'app/page.tsx', source: 'export const a = 1;\n' },
    ]);
    rmSync(join(sessionArtifactDir(root, SESSION_ID), 'analysis-inputs.json'));
    await expect(
      runLoader(root, 'app/page.tsx', 'export const a = 1;\n')
    ).rejects.toThrow(/ANIMUS_ARTIFACT_READ_TORN/);
  });

  test('fails closed when the committed manifest does not parse', async () => {
    const root = makeRoot([]);
    const sessionDir = sessionArtifactDir(root, SESSION_ID);
    mkdirSync(sessionDir, { recursive: true });
    // A commit whose hashes MATCH corrupt payload bytes — committed garbage
    // must not be half-consumed or silently passed through.
    const manifestBytes = '{"files":';
    const inputsBytes = '{"filesJson":';
    const stylesBytes = '';
    writeFileSync(join(sessionDir, 'manifest.json'), manifestBytes);
    writeFileSync(join(sessionDir, 'analysis-inputs.json'), inputsBytes);
    writeFileSync(join(sessionDir, 'styles.css'), stylesBytes);
    writeFileSync(
      analysisCommitPath(sessionDir),
      JSON.stringify({
        schema: 1,
        sessionId: SESSION_ID,
        generation: 1,
        replacementEpoch: 'e1',
        manifestHash: contentHash(manifestBytes),
        inputsHash: contentHash(inputsBytes),
        stylesHash: contentHash(stylesBytes),
      })
    );
    await expect(
      runLoader(root, 'app/page.tsx', 'export const a = 1;\n')
    ).rejects.toThrow(/ANIMUS_ARTIFACT_READ_TORN/);
  });

  test('hydrates exactly once per commit across files', async () => {
    const root = makeRoot([
      { path: 'app/a.tsx', source: 'export const a = 1;\n' },
      { path: 'app/b.tsx', source: 'export const b = 2;\n' },
    ]);
    const before = mocks.analyzeProject.mock.calls.length;
    await runLoader(root, 'app/a.tsx', 'export const a = 1;\n');
    await runLoader(root, 'app/b.tsx', 'export const b = 2;\n');
    expect(mocks.analyzeProject.mock.calls.length).toBe(before + 1);
    // Transform receives the hydrated (replayed) manifest verbatim
    expect(mocks.transformFile).toHaveBeenLastCalledWith(
      'export const b = 2;\n',
      'app/b.tsx',
      '{"files":{}}'
    );
  });

  test('re-hydrates when the commit content changes', async () => {
    const root = makeRoot([{ path: 'app/a.tsx', source: 'export {};\n' }]);
    await runLoader(root, 'app/a.tsx', 'export {};\n');
    const before = mocks.analyzeProject.mock.calls.length;

    writeCommitted(
      root,
      [{ path: 'app/a.tsx', source: 'export {};\n' }],
      '{"files":{"app/a.tsx":1}}'
    );
    await runLoader(root, 'app/a.tsx', 'export {};\n');
    expect(mocks.analyzeProject.mock.calls.length).toBe(before + 1);
  });

  test('fails loudly when the loader runner cannot run it async', () => {
    const root = makeRoot([]);
    const ctx = {
      resourcePath: join(root, 'app/a.tsx'),
      rootContext: root,
      getOptions: () => ({ rootDir: root }),
      addDependency: () => {},
    };
    expect(() =>
      animusTurbopackLoader.call(
        ctx as unknown as ThisParameterType<typeof animusTurbopackLoader>,
        'export {};\n'
      )
    ).toThrow(/async/);
  });
});

describe('turbopack loader CSS policy (shared loader-core)', () => {
  test('strips emitter CSS imports from non-root files', async () => {
    const source = 'export const P = 1;\n';
    const root = makeRoot([{ path: 'app/page.tsx', source }]);
    mocks.transformFile.mockImplementation((src: string) => ({
      code: `import '.animus/styles.css';\n${src}`,
      hasComponents: true,
    }));
    const out = await runLoader(root, 'app/page.tsx', source);
    expect(out).toBe(source);
  });

  test('injects the single CSS import at the configured target', async () => {
    const source = 'export {};\n';
    const root = makeRoot([{ path: 'src/app/[locale]/layout.tsx', source }]);
    const out = await runLoader(root, 'src/app/[locale]/layout.tsx', source, {
      cssImportTarget: 'src/app/[locale]/layout.tsx',
    });
    expect(out.startsWith("import '.animus/styles.css';\n")).toBe(true);
  });
});
