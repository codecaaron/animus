/**
 * The seams a host adapter sets on the Session (spec §12.2, Vite onto
 * Session): each changes what the Session does only where the host sets it.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn<(...args: AnalyzeProjectArgs) => string>(),
  clearAnalysisCache: vi.fn(),
}));

import { ExtractionSession } from '../../session/extraction-session';
import {
  REPLACEMENT_EPOCH_ARTIFACT,
  sessionsRootDir,
} from '../../session/session-paths';
import {
  getManifestJson,
  getSharedCss,
  setEngineApiOverride,
} from '../../session/singleton';
import {
  emptyFacts,
  factsExtractor,
  systemImportFacts,
} from '../source-ingestion-fixtures';
import {
  buildManifest,
  createKitWorkspace,
  createProject,
  makeComponent,
  makeManifest,
  disposeTempRoots,
  lastAnalyzedPaths,
  makeSession,
  requireResolveSpecifier,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from './session-fixtures';

import type { AnalyzeProjectArgs } from '../../pipeline';

let restoreGlobals: () => void;

beforeEach(() => {
  restoreGlobals = resetAnimusGlobals();
  mocks.loadSystemModule.mockReset().mockReturnValue({ ...SYSTEM_CONFIG });
  mocks.analyzeProject.mockReset().mockImplementation(() => buildManifest({}));
  mocks.clearAnalysisCache.mockReset();
});

afterEach(() => {
  restoreGlobals();
  setEngineApiOverride(null);
  vi.restoreAllMocks();
  disposeTempRoots();
});

/** A workspace whose system extends `@kits/ui` by its package name, which
 *  nothing installs: only a host that resolves it finds it. */
function bareKitWorkspace() {
  const systemSource = `import { createSystem } from '@animus-ui/system';
import kit from '@kits/ui';
export const system = createSystem({}).extend(kit);
`;
  const { parent, app, kit } = createKitWorkspace(systemSource);
  const systemPath = join(app, 'src', 'system.ts');
  setEngineApiOverride(() => ({
    extractFacts: factsExtractor({
      [systemPath]: {
        ...emptyFacts(systemPath),
        imports: systemImportFacts(systemSource),
      },
    }),
    resolveSpecifier: requireResolveSpecifier,
    locatePackage: (name: string) => (name === '@kits/ui' ? kit : null),
    // The stand-in table: the kit's `src/`, and its index as the guessed
    // entry, which a loader-only kit needs as its source entry.
    resolveKitSourceRoot: (
      _specifier: string,
      _fromDir: string,
      _conditions?: readonly string[],
      _workspaces?: Record<string, string>,
      _extensionPolicyJson?: string,
      _hostEntry?: string,
      packageDir?: string
    ) =>
      JSON.stringify({
        rule: 'src',
        root: join(packageDir ?? '', 'src'),
        entries: [['.', join(packageDir ?? '', 'src', 'index.ts')]],
        invalid: [],
        unresolved: null,
      }),
    loadSystemModule: mocks.loadSystemModule,
    analyzeProject: mocks.analyzeProject,
    clearAnalysisCache: mocks.clearAnalysisCache,
  }));
  return { parent, app, kit };
}

describe('a host resolver answers package discovery', () => {
  test("the host's answer admits a package the loader cannot find", async () => {
    const { app, kit } = bareKitWorkspace();
    const session = makeSession(app);
    const asked: string[] = [];
    session.hostResolve = async (specifier) => {
      asked.push(specifier);
      return specifier === '@kits/ui' ? join(kit, 'src', 'index.ts') : null;
    };

    await session.runFullPipeline();

    expect(asked).toContain('@kits/ui');
    expect(lastAnalyzedPaths(mocks.analyzeProject)).toContain(
      '../kits/ui/src/Button.tsx'
    );
    session.close();
  });
});

describe('host-first discovery', () => {
  /** Rollup and webpack resolve an importer-less specifier from their own
   *  working directory or context, which can install another copy. */
  test('asks the host from the root, never from its working directory', async () => {
    const { parent, app, kit } = bareKitWorkspace();
    const outerKit = join(parent, 'outer', 'ui');
    mkdirSync(join(outerKit, 'src'), { recursive: true });
    writeFileSync(join(outerKit, 'package.json'), '{"name":"@kits/ui"}');
    writeFileSync(join(outerKit, 'src', 'index.ts'), 'export const x = 1;\n');
    writeFileSync(
      join(outerKit, 'src', 'Outer.tsx'),
      'export const Outer = 1;\n'
    );
    const session = makeSession(app);
    session.hostResolve = async (specifier, importer) =>
      specifier !== '@kits/ui'
        ? null
        : importer !== undefined && dirname(importer) === app
          ? join(kit, 'src', 'index.ts')
          : join(outerKit, 'src', 'index.ts');

    await session.runFullPipeline();

    const analyzed = lastAnalyzedPaths(mocks.analyzeProject);
    expect(analyzed).toContain('../kits/ui/src/Button.tsx');
    expect(analyzed).not.toContain('../outer/ui/src/Outer.tsx');
    session.close();
  });

  /** A declared workspace the host throws on still reaches the loader. */
  for (const [label, fail] of [
    ['rejects', async () => Promise.reject(new Error('no resolver'))],
    [
      'throws synchronously',
      () => {
        throw new Error('no resolver');
      },
    ],
  ] as const) {
    test(`a host resolver that ${label} falls back as one that finds nothing`, async () => {
      const { app } = bareKitWorkspace();
      writeFileSync(
        join(app, 'package.json'),
        '{"name":"app","workspaces":["../kits/ui"]}'
      );
      const session = makeSession(app);
      session.hostResolve = (specifier) =>
        specifier === '@kits/ui' ? fail() : Promise.resolve(null);

      await session.runFullPipeline();

      expect(lastAnalyzedPaths(mocks.analyzeProject)).toContain(
        '../kits/ui/src/Button.tsx'
      );
      session.close();
    });
  }
});

describe('a host runtime import', () => {
  test('reaches the emitter, and an override that cannot supply a terminal fails', async () => {
    setEngineApiOverride(() => ({
      extractFacts: () => '{"files":{},"parseCount":0}',
      loadSystemModule: mocks.loadSystemModule,
      analyzeProject: mocks.analyzeProject,
      clearAnalysisCache: mocks.clearAnalysisCache,
    }));
    mocks.analyzeProject.mockImplementation(() =>
      buildManifest({
        'src/Button.tsx::Button': makeComponent(
          'src/Button.tsx',
          "createComponent('button', 'a')"
        ),
      })
    );
    const session = makeSession(createProject('animus-runtime-import-'), {
      runtimeImport: '@acme/runtime',
    });

    await expect(session.runFullPipeline()).rejects.toThrow(
      /runtimeImport '@acme\/runtime' is valid only when every extracted terminal is \.asClass\(\)/
    );
    const emitterJson = mocks.analyzeProject.mock.calls[0][8];
    expect(JSON.parse(emitterJson ?? '{}').runtime_import).toBe(
      '@acme/runtime'
    );
    session.close();
  });
});

describe('a session that keeps its artifacts in memory', () => {
  test('publishes every result and writes no session directory', async () => {
    setEngineApiOverride(() => ({
      extractFacts: () => '{"files":{},"parseCount":0}',
      loadSystemModule: mocks.loadSystemModule,
      analyzeProject: mocks.analyzeProject,
      clearAnalysisCache: mocks.clearAnalysisCache,
    }));
    const session = makeSession(createProject('animus-in-memory-'));
    session.persistArtifacts = false;

    await session.runFullPipeline();

    expect(getManifestJson(session.key)).not.toBeNull();
    expect(getSharedCss(session.key)).toContain('@layer');
    expect(existsSync(session.sessionDir)).toBe(false);
    session.close();
  });
});

describe('a session that keeps its artifacts in memory', () => {
  test('leaves asset placeholders to its host and a sibling epoch alone', async () => {
    setEngineApiOverride(() => ({
      extractFacts: () => '{"files":{},"parseCount":0}',
      loadSystemModule: mocks.loadSystemModule,
      analyzeProject: mocks.analyzeProject,
      clearAnalysisCache: mocks.clearAnalysisCache,
    }));
    const root = createProject('animus-in-memory-assets-');
    const logo = join(root, 'logo.svg');
    writeFileSync(logo, '<svg/>');
    mocks.analyzeProject.mockImplementation(() => {
      const manifest = makeManifest();
      manifest.sheets.global = `@layer anm-global{body{background:url('animus-asset:${logo}')}}`;
      return JSON.stringify(manifest);
    });
    const sibling = join(sessionsRootDir(root), 'a-stale-sibling');
    mkdirSync(sibling, { recursive: true });
    const siblingEpoch = join(sibling, REPLACEMENT_EPOCH_ARTIFACT);
    writeFileSync(
      siblingEpoch,
      JSON.stringify({
        schema: 1,
        sessionId: 'a-stale-sibling',
        epoch: 'other',
      })
    );
    const session = makeSession(root);
    session.persistArtifacts = false;
    session.hostSubstitutesAssets = true;

    await session.runFullPipeline();

    expect(readdirSync(sessionsRootDir(root))).toEqual(['a-stale-sibling']);
    expect(existsSync(siblingEpoch)).toBe(true);
    expect(getSharedCss(session.key)).toContain(`animus-asset:${logo}`);
    session.close();
  });
});

describe("a host's engine and logger", () => {
  test('the session analyses through the host engine and reports to the host logger', async () => {
    const hostAnalyze = vi.fn<(...args: AnalyzeProjectArgs) => string>(() =>
      buildManifest({})
    );
    setEngineApiOverride(null);
    const lines: string[] = [];
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const session = new ExtractionSession(
      { system: './src/system.ts', exclude: ['nothing-matches-this'] },
      {
        engine: () => ({
          extractFacts: () => '{"files":{},"parseCount":0}',
          loadSystemModule: mocks.loadSystemModule,
          analyzeProject: hostAnalyze,
          clearAnalysisCache: mocks.clearAnalysisCache,
          transformFile: () => ({ code: '', hasComponents: false }),
        }),
        logger: {
          info: (line) => lines.push(line),
          warn: (line) => lines.push(line),
          error: (line) => lines.push(line),
        },
      }
    );
    session.rootDir = createProject('animus-host-engine-');

    await session.runFullPipeline();

    expect(hostAnalyze).toHaveBeenCalledTimes(1);
    expect(mocks.analyzeProject).not.toHaveBeenCalled();
    expect(lines).toContain(
      "[animus] exclude pattern 'nothing-matches-this' matched nothing"
    );
    expect(consoleWarn).not.toHaveBeenCalled();
    session.close();
  });
});

describe('a host that substitutes asset URLs itself', () => {
  async function publishWithAsset(hostSubstitutesAssets: boolean) {
    setEngineApiOverride(() => ({
      extractFacts: () => '{"files":{},"parseCount":0}',
      loadSystemModule: mocks.loadSystemModule,
      analyzeProject: mocks.analyzeProject,
      clearAnalysisCache: mocks.clearAnalysisCache,
    }));
    const root = createProject('animus-host-assets-');
    const logo = join(root, 'logo.svg');
    writeFileSync(logo, '<svg/>');
    const placeholder = `url('animus-asset:${logo}')`;
    mocks.loadSystemModule.mockReturnValue({
      ...SYSTEM_CONFIG,
      variableCss: `:root{--anm-logo:${placeholder}}`,
    });
    mocks.analyzeProject.mockImplementation(() => {
      const manifest = makeManifest();
      manifest.sheets.global = `@layer anm-global{body{background:${placeholder}}}`;
      return JSON.stringify(manifest);
    });
    const session = makeSession(root);
    session.hostSubstitutesAssets = hostSubstitutesAssets;
    await session.runFullPipeline();
    return { session, placeholder };
  }

  test('keeps the placeholders in the analysis sheets and the variable CSS', async () => {
    const { session, placeholder } = await publishWithAsset(true);

    expect(session.publication?.analysisGlobalCss).toContain(placeholder);
    expect(session.publication?.system.variableCss).toContain(placeholder);
    expect(existsSync(join(session.sessionDir, 'assets'))).toBe(false);
    session.close();
  });

  test('a persisting host without it still serves its copies', async () => {
    const { session, placeholder } = await publishWithAsset(false);

    expect(session.publication?.styles).toContain('./assets/logo.');
    expect(session.publication?.styles).not.toContain(placeholder);
    expect(readdirSync(join(session.sessionDir, 'assets'))).toHaveLength(1);
    session.close();
  });
});
