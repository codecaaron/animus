import { contentHash } from '@animus-ui/extract/pipeline';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { runBuildStart } from '../src/build-start';
import { PluginContext } from '../src/context';
import { handleHotUpdate } from '../src/hmr';
import { transformSource } from '../src/transform';
import { makeEnvGraph } from './context-probe';

import type { EngineApi } from '@animus-ui/extract/pipeline';
import type { DevEnvironment } from 'vite';

interface FileEntry {
  path: string;
  source: string;
  hash?: string;
}

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

interface EngineProbe {
  engine: Record<string, unknown>;
  analyses: FileEntry[][];
  factsInputs: FileEntry[][];
  transformedPaths: string[];
  failNextAnalysis(): void;
}

function makeEngineProbe(): EngineProbe {
  const analyses: FileEntry[][] = [];
  const factsInputs: FileEntry[][] = [];
  const transformedPaths: string[] = [];
  let failNext = false;
  const engine = {
    loadSystemModule: () => ({
      propConfig: '{}',
      groupRegistry: '{}',
      scalesJson: '{}',
      variableMapJson: '{}',
      variableCss: '',
      contextualVarsJson: '{}',
      dependencies: [],
    }),
    extractFacts: (filesJson: string) => {
      factsInputs.push(JSON.parse(filesJson) as FileEntry[]);
      return factsFor(filesJson);
    },
    analyzeProject: (filesJson: string) => {
      if (failNext) {
        failNext = false;
        throw new Error('planned analysis failure');
      }
      analyses.push(JSON.parse(filesJson) as FileEntry[]);
      return JSON.stringify({
        components: {},
        files: {},
        sheets: {},
        css: '',
        diagnostics: [],
      });
    },
    transformFile: (_source: string, path: string) => {
      transformedPaths.push(path);
      return { code: '', hasComponents: false };
    },
    clearAnalysisCache: () => {},
    scanKeyframesExports: () => null,
  };
  return {
    engine,
    analyses,
    factsInputs,
    transformedPaths,
    failNextAnalysis() {
      failNext = true;
    },
  };
}

function makeStatefulResetProbe() {
  let active = false;
  let clears = 0;
  const transformedPaths: string[] = [];
  const engine = {
    loadSystemModule: () => ({
      propConfig: '{}',
      groupRegistry: '{}',
      scalesJson: '{}',
      variableMapJson: '{}',
      variableCss: '',
      contextualVarsJson: '{}',
      dependencies: [],
    }),
    extractFacts: factsFor,
    analyzeProject: () => {
      active = true;
      return JSON.stringify({
        components: {},
        files: {},
        sheets: {},
        css: '',
        diagnostics: [],
      });
    },
    transformFile: (_source: string, path: string) => {
      if (!active) throw new Error('transform engine inactive after clear');
      transformedPaths.push(path);
      return { code: '', hasComponents: false };
    },
    clearAnalysisCache: () => {
      clears += 1;
      active = false;
    },
    scanKeyframesExports: () => null,
  };

  return {
    engine,
    transformedPaths,
    isActive: () => active,
    clearCount: () => clears,
  };
}

function writeProject(
  root: string,
  includeExternal: boolean
): {
  appRoot: string;
  localUsage: string;
  externalUsage: string;
} {
  const appRoot = join(root, 'app');
  const appSrc = join(appRoot, 'src');
  const kitRoot = join(root, 'kit');
  const kitSrc = join(kitRoot, 'src');
  mkdirSync(appSrc, { recursive: true });
  mkdirSync(kitSrc, { recursive: true });
  writeFileSync(join(kitRoot, 'package.json'), '{"name":"@test/kit"}\n');
  writeFileSync(join(kitSrc, 'index.ts'), 'export const kit = {};\n');
  writeFileSync(
    join(appSrc, 'ds.ts'),
    includeExternal
      ? `import { kit } from '../../kit/src';\nexport const ds = createSystem({}).extend(kit);\n`
      : 'export const ds = createSystem({});\n'
  );
  writeFileSync(
    join(appSrc, 'definition.ts'),
    `export const badge = ds.styles({}).asClass();\n`
  );
  writeFileSync(
    join(kitSrc, 'definition.ts'),
    `export const kitBadge = ds.styles({}).asClass();\n`
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
  return { appRoot, localUsage, externalUsage };
}

function makeContext(
  appRoot: string,
  engine: Record<string, unknown>,
  extensions: string[]
): PluginContext {
  const ctx = new PluginContext(
    { system: 'src/ds.ts', extensions },
    () => engine
  );
  ctx.rootDir = appRoot;
  ctx.isProd = false;
  return ctx;
}

async function dispatch(
  ctx: PluginContext,
  type: 'create' | 'update' | 'delete',
  file: string,
  timestamp: number,
  source?: string
): Promise<void> {
  const graph = makeEnvGraph({ rootDir: ctx.rootDir, ids: [] });
  await handleHotUpdate(
    ctx,
    { name: 'client', moduleGraph: graph.moduleGraph } as DevEnvironment,
    {
      type,
      file,
      timestamp,
      modules: [],
      read: source === undefined ? undefined : async () => source,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
  );
}

const scratchRoots: string[] = [];

afterEach(() => {
  for (const root of scratchRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('opted-in Svelte source ownership in the Vite lifecycle', () => {
  test('keeps legacy EngineApi objects source-compatible and fails loud at ingestion', async () => {
    const legacyEngine = {
      loadSystemModule: () => ({}),
      scanKeyframesExports: () => null,
      analyzeProject: () => '{}',
      transformFile: () => ({ code: '', hasComponents: false }),
      clearAnalysisCache: () => {},
    } satisfies EngineApi;
    const ctx = new PluginContext({ system: 'src/ds.ts' }, () => legacyEngine);

    await expect(ctx.ingestRawSources([])).rejects.toThrow(
      '[animus-extract] native engine does not expose extractFacts required for source adaptation'
    );
  });

  test('source diagnostics use one strict/warn policy and name the original path', () => {
    const diagnostic = {
      code: 'SOURCE_SVELTE_DEPENDENCY_MISSING' as const,
      originalPath: 'src/Usage.svelte',
      message: 'install svelte to project opted-in source',
    };
    const warnings: string[] = [];
    const warnContext = new PluginContext({ system: 'src/ds.ts' });
    warnContext.logger = {
      warn: (message: string) => warnings.push(message),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    expect(warnContext.surfaceSourceDiagnostics([diagnostic])).toEqual(
      new Set(['src/Usage.svelte'])
    );
    expect(warnings).toEqual([
      expect.stringContaining(
        'SOURCE_SVELTE_DEPENDENCY_MISSING src/Usage.svelte'
      ),
    ]);

    const strictContext = new PluginContext({
      system: 'src/ds.ts',
      strict: true,
    });
    expect(() => strictContext.surfaceSourceDiagnostics([diagnostic])).toThrow(
      /SOURCE_SVELTE_DEPENDENCY_MISSING src\/Usage\.svelte/
    );
  });

  test('initial local and external sources project while raw paths own the cache', async () => {
    const root = mkdtempSync(join(tmpdir(), 'animus-vite-svelte-initial-'));
    scratchRoots.push(root);
    const { appRoot, localUsage, externalUsage } = writeProject(root, true);
    const probe = makeEngineProbe();
    const ctx = makeContext(appRoot, probe.engine, ['.ts', '.svelte']);

    await runBuildStart(ctx, async () => null);

    const localPath = relative(appRoot, localUsage);
    const externalPath = relative(appRoot, externalUsage);
    expect([...ctx.fileCache.keys()]).toEqual(
      expect.arrayContaining([localPath, externalPath])
    );
    expect(
      [...ctx.fileCache.keys()].some((path) => path.endsWith('.tsx'))
    ).toBe(false);
    expect(probe.analyses.at(-1)?.map((entry) => entry.path)).toEqual(
      expect.arrayContaining([
        `${localPath}.instance.tsx`,
        `${externalPath}.instance.tsx`,
      ])
    );
    expect(
      probe.analyses.at(-1)?.some((entry) => entry.path.endsWith('.svelte'))
    ).toBe(false);
    expect(ctx.sourceOwnership[externalPath].analysisPaths).toEqual([
      `${externalPath}.instance.tsx`,
    ]);

    await transformSource(
      ctx,
      ctx.fileCache.get(localPath)!.source,
      localUsage
    );
    expect(probe.transformedPaths).not.toContain(localPath);
  });

  test('a non-opted-in context never discovers or projects Svelte', async () => {
    const root = mkdtempSync(join(tmpdir(), 'animus-vite-svelte-optout-'));
    scratchRoots.push(root);
    const { appRoot } = writeProject(root, false);
    const probe = makeEngineProbe();
    const ctx = makeContext(appRoot, probe.engine, ['.ts']);

    await runBuildStart(ctx, async () => null);

    expect(
      [...ctx.fileCache.keys()].some((path) => path.endsWith('.svelte'))
    ).toBe(false);
    expect(
      probe.factsInputs.flat().some((entry) => entry.path.includes('.svelte'))
    ).toBe(false);
    expect(
      probe.analyses.flat().some((entry) => entry.path.includes('.svelte'))
    ).toBe(false);
  });

  test('create, update, delete, rollback, retry, and reset replace one original atomically', async () => {
    const root = mkdtempSync(join(tmpdir(), 'animus-vite-svelte-hmr-'));
    scratchRoots.push(root);
    const { appRoot, localUsage } = writeProject(root, false);
    const probe = makeEngineProbe();
    const ctx = makeContext(appRoot, probe.engine, ['.ts', '.svelte']);
    await runBuildStart(ctx, async () => null);

    const usagePath = relative(appRoot, localUsage);
    const dynamicSource = `<script>\nimport { badge } from './definition';\nlet tone = 'quiet';\nconst attrs = badge.attrs({ tone });\n</script>\n`;
    await dispatch(ctx, 'update', localUsage, 1, dynamicSource);
    expect(ctx.fileCache.get(usagePath)).toEqual({
      hash: contentHash(dynamicSource),
      source: dynamicSource,
    });
    expect(
      probe.analyses
        .at(-1)
        ?.find((entry) => entry.path === `${usagePath}.instance.tsx`)?.source
    ).toContain('tone={tone}');

    const failedSource = dynamicSource.replace("'quiet'", "'loud'");
    probe.failNextAnalysis();
    await dispatch(ctx, 'update', localUsage, 2, failedSource);
    expect(ctx.fileCache.get(usagePath)?.source).toBe(dynamicSource);
    await dispatch(ctx, 'update', localUsage, 3, failedSource);
    expect(ctx.fileCache.get(usagePath)?.source).toBe(failedSource);

    const createdFile = join(appRoot, 'src', 'Created.svelte');
    const createdPath = relative(appRoot, createdFile);
    const createdSource = `<script>\nimport { badge } from './definition';\nconst attrs = badge.attrs();\n</script>\n`;
    writeFileSync(createdFile, createdSource);
    await dispatch(ctx, 'create', createdFile, 4, createdSource);
    expect(ctx.sourceOwnership[createdPath].analysisPaths).toEqual([
      `${createdPath}.instance.tsx`,
    ]);
    expect(
      probe.analyses
        .at(-1)
        ?.some((entry) => entry.path === `${createdPath}.instance.tsx`)
    ).toBe(true);

    unlinkSync(createdFile);
    await dispatch(ctx, 'delete', createdFile, 5);
    expect(ctx.fileCache.has(createdPath)).toBe(false);
    expect(ctx.sourceOwnership[createdPath]).toBeUndefined();
    expect(
      probe.analyses.at(-1)?.some((entry) => entry.path.includes(createdPath))
    ).toBe(false);

    const beforeReset = probe.analyses
      .at(-1)!
      .map(({ path, source }) => ({ path, source }));
    await ctx.performGeologicalReset();
    expect(
      probe.analyses.at(-1)!.map(({ path, source }) => ({ path, source }))
    ).toEqual(beforeReset);
  });

  test('an adapter diagnostic reset keeps the last-good transform engine active while warning and invalidating', async () => {
    const root = mkdtempSync(join(tmpdir(), 'animus-vite-svelte-reset-'));
    scratchRoots.push(root);
    const { appRoot, localUsage } = writeProject(root, false);
    const definitionPath = 'src/definition.ts';
    const probe = makeStatefulResetProbe();
    const ctx = makeContext(appRoot, probe.engine, ['.ts', '.svelte']);
    const warnings: string[] = [];
    const invalidated: string[] = [];
    const hotMessages: Array<Record<string, unknown>> = [];
    ctx.logger = {
      warn: (message: string) => warnings.push(message),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    ctx.devServer = {
      moduleGraph: {
        getModuleById: (id: string) => ({ id }),
        invalidateModule: (mod: { id: string }) => invalidated.push(mod.id),
      },
      hot: {
        send: (message: Record<string, unknown>) => hotMessages.push(message),
      },
    };

    await runBuildStart(ctx, async () => null);
    expect(probe.isActive()).toBe(true);
    const clearsBeforeReset = probe.clearCount();
    const malformedSource = `<script>import { badge } from './definition'; const attrs = badge.attrs({</script>`;
    const usagePath = relative(appRoot, localUsage);
    ctx.fileCache.set(usagePath, {
      hash: contentHash(malformedSource),
      source: malformedSource,
    });

    await ctx.performGeologicalReset();

    let transformError: string | null = null;
    try {
      const definition = ctx.fileCache.get(definitionPath)!;
      ctx
        .engineApi()
        .transformFile(
          definition.source,
          definitionPath,
          ctx.storedManifestJson
        );
    } catch (error) {
      transformError = error instanceof Error ? error.message : String(error);
    }

    expect({
      clears: probe.clearCount(),
      warnings,
      invalidatedCount: invalidated.length,
      hotMessages,
      transformError,
      transformedPaths: probe.transformedPaths,
    }).toEqual({
      clears: clearsBeforeReset,
      warnings: [expect.stringContaining(`SVELTE_PARSE_ERROR ${usagePath}`)],
      invalidatedCount: 3,
      hotMessages: [{ type: 'full-reload' }],
      transformError: null,
      transformedPaths: [definitionPath],
    });
  });

  test('a geological reset evicts exactly the source modules whose replacement plans changed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'animus-vite-svelte-plans-'));
    scratchRoots.push(root);
    const { appRoot } = writeProject(root, false);
    const definitionPath = 'src/definition.ts';
    const definitionAbs = join(appRoot, definitionPath);

    // Plan-flipping engine: the replacement plan for the definition file is
    // switchable between analysis passes, so pre/post reset diffs are exact.
    let replacement = 'createClassResolver(["a"])';
    let failNext = false;
    const engine = {
      loadSystemModule: () => ({
        propConfig: '{}',
        groupRegistry: '{}',
        scalesJson: '{}',
        variableMapJson: '{}',
        variableCss: '',
        contextualVarsJson: '{}',
        dependencies: [],
      }),
      extractFacts: factsFor,
      analyzeProject: () => {
        if (failNext) {
          failNext = false;
          throw new Error('planned reset failure');
        }
        return JSON.stringify({
          components: {
            badge: { file: definitionPath, replacement },
          },
          files: {},
          sheets: {},
          css: '',
          diagnostics: [],
        });
      },
      transformFile: () => ({ code: '', hasComponents: false }),
      clearAnalysisCache: () => {},
      scanKeyframesExports: () => null,
    };
    const ctx = makeContext(appRoot, engine, ['.ts', '.svelte']);

    // One ordered event log across BOTH environment graphs and the hot
    // channel: changed-plan evictions must precede the full reload, and the
    // per-file node enumeration must cover query-suffixed ids in every
    // environment (client and SSR).
    const events: string[] = [];
    const envGraph = (name: string) => {
      const nodes = [
        { id: definitionAbs, file: definitionAbs },
        { id: `${definitionAbs}?v=1`, file: definitionAbs },
      ];
      return {
        getModulesByFile: (file: string) =>
          file === definitionAbs ? new Set(nodes) : undefined,
        getModuleById: (id: string) =>
          nodes.find((node) => node.id === id) ?? null,
        invalidateModule: (mod: { id?: unknown }) =>
          events.push(`${name}:${String(mod.id)}`),
      };
    };
    ctx.devServer = {
      environments: {
        client: { moduleGraph: envGraph('client') },
        ssr: { moduleGraph: envGraph('ssr') },
      },
      moduleGraph: {
        getModuleById: () => null,
        invalidateModule: () => {},
      },
      hot: {
        send: (message: { type?: string }) =>
          events.push(`hot:${String(message.type)}`),
      },
    };

    await runBuildStart(ctx, async () => null);
    events.length = 0;

    // Changed plan: every node for the definition file is evicted in every
    // environment graph BEFORE the full reload is sent.
    replacement = 'createClassResolver(["b"])';
    await ctx.performGeologicalReset();
    expect(events).toEqual([
      `client:${definitionAbs}`,
      `client:${definitionAbs}?v=1`,
      `ssr:${definitionAbs}`,
      `ssr:${definitionAbs}?v=1`,
      'hot:full-reload',
    ]);

    // Equal plan: the republished identical plan evicts nothing.
    events.length = 0;
    await ctx.performGeologicalReset();
    expect(events).toEqual(['hot:full-reload']);

    // Failed reset: no publication, no eviction — and the manifest that
    // keeps serving is the last-good one, so a recovered equal-plan reset
    // still evicts nothing.
    events.length = 0;
    failNext = true;
    await ctx.performGeologicalReset();
    expect(events).toEqual(['hot:full-reload']);
    events.length = 0;
    await ctx.performGeologicalReset();
    expect(events).toEqual(['hot:full-reload']);
  });
});
