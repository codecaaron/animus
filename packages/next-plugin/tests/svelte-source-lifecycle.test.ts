import { contentHash } from '@animus-ui/extract/pipeline';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  extractFacts: vi.fn(),
  extractFactsEnabled: true,
  analyzeProject: vi.fn(),
  transformFile: vi.fn(),
  clearAnalysisCache: vi.fn(),
  scanKeyframesExports: vi.fn(),
}));

vi.mock('../src/singleton', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/singleton')>();
  return {
    ...actual,
    engineApi: () => {
      const api = {
        loadSystemModule: mocks.loadSystemModule,
        analyzeProject: mocks.analyzeProject,
        transformFile: mocks.transformFile,
        clearAnalysisCache: mocks.clearAnalysisCache,
        scanKeyframesExports: mocks.scanKeyframesExports,
      };
      return mocks.extractFactsEnabled
        ? { ...api, extractFacts: mocks.extractFacts }
        : api;
    },
  };
});

import { ExtractionSession } from '../../extract/session/extraction-session';
import { engineApi } from '../src/singleton';
import { resetAnimusGlobals, SYSTEM_CONFIG } from './singleton-fixtures';

interface FileEntry {
  path: string;
  source: string;
  hash?: string;
}

interface SessionSources {
  fileCache: Map<string, { hash: string; source: string }>;
  analysisEntryCache: Map<string, { hash: string; source: string }>;
  sourceOwnership: Record<
    string,
    { originalPath: string; originalHash: string; analysisPaths: string[] }
  >;
}

const MANIFEST = JSON.stringify({
  css: '',
  sheets: { global: '' },
  system_prop_map: {},
  dynamic_props: {},
  diagnostics: [],
});

function factsFor(filesJson: string): string {
  const entries = JSON.parse(filesJson) as FileEntry[];
  return JSON.stringify({
    files: Object.fromEntries(
      entries.map((entry) => {
        const match =
          /export\s+const\s+([A-Za-z_$][\w$]*)\s*=.*?\.asClass\(\)/s.exec(
            entry.source
          );
        const binding = match?.[1];
        return [
          entry.path,
          {
            path: entry.path,
            chains: binding
              ? [
                  {
                    descriptor: {
                      binding,
                      terminal: 'asClass',
                      extractable: true,
                    },
                    fatalError: null,
                  },
                ]
              : [],
            imports: [],
            exports: binding
              ? [
                  {
                    exported: binding,
                    local: binding,
                    source: null,
                    original: null,
                  },
                ]
              : [],
            parseDiagnostics: [],
          },
        ];
      })
    ),
    parseCount: entries.length,
  });
}

interface Workspace {
  root: string;
  app: string;
  systemFile: string;
  localUsage: string;
  externalUsage: string;
}

function createWorkspace(): Workspace {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'animus-next-svelte-')));
  const app = join(root, 'app');
  const appSrc = join(app, 'src');
  const kit = join(root, 'kit');
  const kitSrc = join(kit, 'src');
  mkdirSync(appSrc, { recursive: true });
  mkdirSync(kitSrc, { recursive: true });
  writeFileSync(join(app, 'package.json'), '{"name":"app"}\n');
  writeFileSync(join(kit, 'package.json'), '{"name":"@test/kit"}\n');
  writeFileSync(join(kitSrc, 'index.ts'), 'export const kit = {};\n');

  const systemFile = join(appSrc, 'system.ts');
  writeFileSync(
    systemFile,
    `import kit from '../../kit/src/index.ts';\nexport const system = createSystem({}).extend(kit);\n`
  );
  writeFileSync(
    join(appSrc, 'definition.ts'),
    'export const badge = ds.styles({}).asClass();\n'
  );
  writeFileSync(
    join(kitSrc, 'definition.ts'),
    'export const kitBadge = ds.styles({}).asClass();\n'
  );

  const localUsage = join(appSrc, 'Usage.svelte');
  const externalUsage = join(kitSrc, 'Usage.svelte');
  writeFileSync(
    localUsage,
    `<script>\nimport { badge } from './definition';\nconst attrs = badge.attrs({ tone: 'quiet' });\n</script>\n`
  );
  writeFileSync(
    externalUsage,
    `<script>\nimport { kitBadge } from './definition';\nconst attrs = kitBadge.attrs({ tone: 'quiet' });\n</script>\n`
  );
  return { root, app, systemFile, localUsage, externalUsage };
}

function makeSession(app: string, strict = false): ExtractionSession {
  const session = new ExtractionSession({
    system: './src/system.ts',
    extensions: ['.ts', '.svelte'],
    strict,
  });
  session.rootDir = app;
  return session;
}

function sources(session: ExtractionSession): SessionSources {
  return session as unknown as SessionSources;
}

function analyzedEntries(): FileEntry[] {
  const call = mocks.analyzeProject.mock.calls.at(-1);
  expect(call).toBeDefined();
  return JSON.parse(call![0] as string) as FileEntry[];
}

function analyzedSource(path: string): string | undefined {
  return analyzedEntries().find((entry) => entry.path === path)?.source;
}

let restoreGlobals: () => void;
const workspaces: Workspace[] = [];
let activeTransformSources = new Map<string, string>();

beforeEach(() => {
  restoreGlobals = resetAnimusGlobals();
  activeTransformSources = new Map();
  mocks.loadSystemModule.mockReset().mockReturnValue({ ...SYSTEM_CONFIG });
  mocks.extractFactsEnabled = true;
  mocks.extractFacts.mockReset().mockImplementation(factsFor);
  mocks.analyzeProject.mockReset().mockImplementation((filesJson: string) => {
    activeTransformSources = new Map(
      (JSON.parse(filesJson) as FileEntry[]).map((entry) => [
        entry.path,
        entry.source,
      ])
    );
    return MANIFEST;
  });
  mocks.transformFile.mockReset().mockImplementation((source, path) => {
    if (activeTransformSources.get(path) !== source) {
      throw new Error(`transform engine inactive for ${path}`);
    }
    return { code: source, hasComponents: true };
  });
  mocks.clearAnalysisCache.mockReset().mockImplementation(() => {
    activeTransformSources.clear();
  });
  mocks.scanKeyframesExports.mockReset().mockReturnValue(null);
});

afterEach(() => {
  restoreGlobals();
  vi.restoreAllMocks();
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace.root, { recursive: true, force: true });
  }
});

describe('Next opted-in Svelte source ownership', () => {
  test('fails loud when a source-compatible legacy engine lacks extractFacts', async () => {
    const workspace = createWorkspace();
    workspaces.push(workspace);
    mocks.extractFactsEnabled = false;

    await expect(makeSession(workspace.app).runFullPipeline()).rejects.toThrow(
      '[animus-next] native engine does not expose extractFacts required for source adaptation'
    );
  });

  test('full pipeline owns raw local and external sources but analyzes generated children', async () => {
    const workspace = createWorkspace();
    workspaces.push(workspace);
    const session = makeSession(workspace.app);

    await session.runFullPipeline();

    const localPath = relative(workspace.app, workspace.localUsage);
    const externalPath = relative(workspace.app, workspace.externalUsage);
    const state = sources(session);
    expect([...state.fileCache.keys()]).toEqual(
      expect.arrayContaining([localPath, externalPath])
    );
    expect(
      [...state.fileCache.keys()].some((path) => path.endsWith('.tsx'))
    ).toBe(false);
    expect(analyzedEntries().map((entry) => entry.path)).toEqual(
      expect.arrayContaining([
        `${localPath}.instance.tsx`,
        `${externalPath}.instance.tsx`,
      ])
    );
    expect(
      analyzedEntries().some((entry) => entry.path.endsWith('.svelte'))
    ).toBe(false);
    expect(state.sourceOwnership[externalPath].analysisPaths).toEqual([
      `${externalPath}.instance.tsx`,
    ]);
    expect(
      (
        mocks.extractFacts.mock.calls.flatMap((call) =>
          JSON.parse(call[0] as string)
        ) as FileEntry[]
      ).some((entry) => entry.path.endsWith('.svelte'))
    ).toBe(false);
  });

  test('one serialized watch path updates, rolls back, retries, resets, and deletes original ownership', async () => {
    const workspace = createWorkspace();
    workspaces.push(workspace);
    const session = makeSession(workspace.app);
    await session.runFullPipeline();

    const localPath = relative(workspace.app, workspace.localUsage);
    const childPath = `${localPath}.instance.tsx`;
    const dynamicSource = `<script>\nimport { badge } from './definition';\nlet tone = 'quiet';\nconst attrs = badge.attrs({ tone });\n</script>\n`;
    writeFileSync(workspace.localUsage, dynamicSource);
    await session.handleWatchUpdate({
      modifiedFiles: new Set([workspace.localUsage]),
      removedFiles: new Set(),
    });
    expect(sources(session).fileCache.get(localPath)).toEqual({
      hash: contentHash(dynamicSource),
      source: dynamicSource,
    });
    expect(analyzedSource(childPath)).toContain('tone={tone}');

    const failedSource = dynamicSource.replace("'quiet'", "'loud'");
    writeFileSync(workspace.localUsage, failedSource);
    mocks.analyzeProject.mockImplementationOnce(() => {
      throw new Error('planned watch failure');
    });
    await expect(
      session.handleWatchUpdate({
        modifiedFiles: new Set([workspace.localUsage]),
        removedFiles: new Set(),
      })
    ).rejects.toThrow('planned watch failure');
    expect(sources(session).fileCache.get(localPath)?.source).toBe(
      dynamicSource
    );
    expect(sources(session).sourceOwnership[localPath].analysisPaths).toEqual([
      childPath,
    ]);

    await session.handleWatchUpdate({
      modifiedFiles: new Set([workspace.localUsage]),
      removedFiles: new Set(),
    });
    expect(sources(session).fileCache.get(localPath)?.source).toBe(
      failedSource
    );

    const beforeReset = analyzedSource(childPath);
    writeFileSync(
      workspace.systemFile,
      `import kit from '../../kit/src/index.ts';\nexport const system = createSystem({}).extend(kit); // reset\n`
    );
    await session.handleWatchUpdate({
      modifiedFiles: new Set([workspace.systemFile]),
      removedFiles: new Set(),
    });
    expect(analyzedSource(childPath)).toBe(beforeReset);
    expect(sources(session).sourceOwnership[localPath].analysisPaths).toEqual([
      childPath,
    ]);

    unlinkSync(workspace.localUsage);
    await session.handleWatchUpdate({
      modifiedFiles: new Set(),
      removedFiles: new Set([workspace.localUsage]),
    });
    expect(sources(session).fileCache.has(localPath)).toBe(false);
    expect(sources(session).sourceOwnership[localPath]).toBeUndefined();
    expect(analyzedEntries().some((entry) => entry.path === childPath)).toBe(
      false
    );
  });

  test('a failed geological reset leaves the last-good transform engine usable', async () => {
    const workspace = createWorkspace();
    workspaces.push(workspace);
    const session = makeSession(workspace.app, true);
    await session.runFullPipeline();

    const definitionPath = 'src/definition.ts';
    const definitionSource = readFileSync(
      join(workspace.app, definitionPath),
      'utf8'
    );
    expect(
      engineApi().transformFile(definitionSource, definitionPath, MANIFEST)
    ).toEqual({ code: definitionSource, hasComponents: true });
    const clearsBeforeReset = mocks.clearAnalysisCache.mock.calls.length;

    writeFileSync(
      workspace.localUsage,
      `<script>import { badge } from './definition'; const attrs = badge.attrs({</script>`
    );
    writeFileSync(
      workspace.systemFile,
      `import kit from '../../kit/src/index.ts';\nexport const system = createSystem({}).extend(kit); // failed reset\n`
    );

    await expect(
      session.handleWatchUpdate({
        modifiedFiles: new Set([workspace.systemFile, workspace.localUsage]),
        removedFiles: new Set(),
      })
    ).rejects.toThrow(/SVELTE_PARSE_ERROR/);

    expect(mocks.analyzeProject).toHaveBeenCalledTimes(1);
    expect(mocks.clearAnalysisCache.mock.calls.length).toBe(clearsBeforeReset);
    expect(
      engineApi().transformFile(definitionSource, definitionPath, MANIFEST)
    ).toEqual({ code: definitionSource, hasComponents: true });
  });
});
