/**
 * Behavior pins for the Turbopack loader (spec: next-turbopack-integration /
 * Stateless per-file transformation): everything derives from the incoming
 * source, serializable options, and `.animus/` disk artifacts. The engine
 * adapter is mocked at the pipeline factory seam; hydration replays
 * analyzeProject from `.animus/analysis-inputs.json`, keyed on mtime+size.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import animusTurbopackLoader from '../src/turbopack-loader';

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

const tempRoots: string[] = [];

function makeRoot(withInputs = true, withManifest = withInputs): string {
  const root = mkdtempSync(join(tmpdir(), 'animus-turbo-loader-'));
  tempRoots.push(root);
  if (withInputs || withManifest) {
    mkdirSync(join(root, '.animus'), { recursive: true });
  }
  if (withManifest) {
    // Matches the mocked analyzeProject return: the spec pins the replayed
    // manifest equal to the persisted one.
    writeFileSync(join(root, '.animus', 'manifest.json'), '{"files":{}}');
  }
  if (withInputs) {
    writeFileSync(
      join(root, '.animus', 'analysis-inputs.json'),
      JSON.stringify({
        filesJson: '[]',
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
      })
    );
  }
  return root;
}

function runLoader(
  root: string,
  relPath: string,
  source: string,
  options: Record<string, unknown> = {}
): string {
  const ctx = {
    resourcePath: join(root, relPath),
    rootContext: root,
    getOptions: () => ({ rootDir: root, ...options }),
  };
  return animusTurbopackLoader.call(ctx, source);
}

beforeEach(() => {
  mocks.analyzeProject.mockReset().mockReturnValue('{"files":{}}');
  mocks.transformFile.mockReset().mockImplementation((source: string) => ({
    code: source,
    hasComponents: false,
  }));
});

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('turbopack loader hydration', () => {
  test('passes through untouched when no analysis artifact exists', () => {
    const root = makeRoot(false);
    const before = mocks.analyzeProject.mock.calls.length;
    const out = runLoader(root, 'app/page.tsx', 'export const a = 1;\n');
    expect(out).toBe('export const a = 1;\n');
    expect(mocks.analyzeProject.mock.calls.length).toBe(before);
  });

  test('passes through when inputs exist but the manifest is missing', () => {
    const root = makeRoot(true, false);
    const before = mocks.analyzeProject.mock.calls.length;
    const out = runLoader(root, 'app/page.tsx', 'export const a = 1;\n');
    expect(out).toBe('export const a = 1;\n');
    expect(mocks.analyzeProject.mock.calls.length).toBe(before);
  });

  test('passes through when the persisted manifest does not parse', () => {
    const root = makeRoot(true, false);
    writeFileSync(join(root, '.animus', 'manifest.json'), '{"files":');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const out = runLoader(root, 'app/page.tsx', 'export const a = 1;\n');
      expect(out).toBe('export const a = 1;\n');
    } finally {
      warn.mockRestore();
    }
  });

  test('hydrates exactly once per artifact version across files', () => {
    const root = makeRoot();
    const before = mocks.analyzeProject.mock.calls.length;
    runLoader(root, 'app/a.tsx', 'export const a = 1;\n');
    runLoader(root, 'app/b.tsx', 'export const b = 2;\n');
    expect(mocks.analyzeProject.mock.calls.length).toBe(before + 1);
    // Transform receives the hydrated manifest verbatim
    expect(mocks.transformFile).toHaveBeenLastCalledWith(
      'export const b = 2;\n',
      'app/b.tsx',
      '{"files":{}}'
    );
  });

  test('re-hydrates when the artifact changes on disk', () => {
    const root = makeRoot();
    runLoader(root, 'app/a.tsx', 'export {};\n');
    const before = mocks.analyzeProject.mock.calls.length;

    const inputsPath = join(root, '.animus', 'analysis-inputs.json');
    const bumped = new Date(Date.now() + 5000);
    utimesSync(inputsPath, bumped, bumped);

    runLoader(root, 'app/a.tsx', 'export {};\n');
    expect(mocks.analyzeProject.mock.calls.length).toBe(before + 1);
  });
});

describe('turbopack loader CSS policy (shared loader-core)', () => {
  test('strips emitter CSS imports from non-root files', () => {
    const root = makeRoot();
    mocks.transformFile.mockImplementation((source: string) => ({
      code: `import '.animus/styles.css';\n${source}`,
      hasComponents: true,
    }));
    const out = runLoader(root, 'app/page.tsx', 'export const P = 1;\n');
    expect(out).toBe('export const P = 1;\n');
  });

  test('injects the single CSS import at the configured target', () => {
    const root = makeRoot();
    const out = runLoader(root, 'src/app/[locale]/layout.tsx', 'export {};\n', {
      cssImportTarget: 'src/app/[locale]/layout.tsx',
    });
    expect(out.startsWith("import '.animus/styles.css';\n")).toBe(true);
  });
});
