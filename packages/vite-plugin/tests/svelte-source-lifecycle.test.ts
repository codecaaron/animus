import { isJsonObject } from '@animus-ui/assertions';
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
import { createLogger } from 'vite';
import { afterEach, describe, expect, test } from 'vitest';

import { runBuildStart } from '../src/build-start';
import { PluginContext } from '../src/context';
import { handleHotUpdate } from '../src/hmr';
import { transformSource } from '../src/transform';
import { makeEnvGraph } from './context-probe';
import { makeComponent, makeManifest } from './manifest-fixture';

import type { JsonObject, JsonValue } from '@animus-ui/assertions';
import type { EngineApi, RawSourceEntry } from '@animus-ui/extract/pipeline';
import type { DevEnvironment, FullReloadPayload, HotUpdateOptions } from 'vite';

function readJsonString(
  object: JsonObject,
  key: string,
  label: string
): string {
  const value = object[key];
  if (String(value) !== value) {
    throw new Error(`${label}.${key} must be a string`);
  }
  return String(value);
}

function parseRawSourceEntries(filesJson: string): RawSourceEntry[] {
  const parsed: JsonValue = JSON.parse(filesJson);
  if (!Array.isArray(parsed)) {
    throw new Error('engine files must be a JSON array');
  }
  return parsed.map((candidate, index) => {
    const label = `engine files[${index}]`;
    if (!isJsonObject(candidate)) {
      throw new Error(`${label} must be a JSON object`);
    }
    const entry: RawSourceEntry = {
      path: readJsonString(candidate, 'path', label),
      source: readJsonString(candidate, 'source', label),
    };
    if (candidate.hash !== undefined) {
      entry.hash = readJsonString(candidate, 'hash', label);
    }
    return entry;
  });
}

function factsFor(filesJson: string): string {
  const entries = parseRawSourceEntries(filesJson);
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
  engine: EngineApi;
  analyses: RawSourceEntry[][];
  factsInputs: RawSourceEntry[][];
  transformedPaths: string[];
  failNextAnalysis(): void;
}

function makeEngineProbe(): EngineProbe {
  const analyses: RawSourceEntry[][] = [];
  const factsInputs: RawSourceEntry[][] = [];
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
      factsInputs.push(parseRawSourceEntries(filesJson));
      return factsFor(filesJson);
    },
    analyzeProject: (filesJson: string) => {
      if (failNext) {
        failNext = false;
        throw new Error('planned analysis failure');
      }
      analyses.push(parseRawSourceEntries(filesJson));
      return JSON.stringify(makeManifest());
    },
    transformFile: (_source: string, path: string) => {
      transformedPaths.push(path);
      return { code: '', hasComponents: false };
    },
    clearAnalysisCache: () => {},
  } satisfies EngineApi;
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
      return JSON.stringify(makeManifest());
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
  } satisfies EngineApi;

  return {
    engine,
    transformedPaths,
    isActive: () => active,
    clearCount: () => clears,
  };
}

function writeProject(root: string, includeExternal: boolean) {
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
  engine: EngineApi,
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

function warningLogger(warnings: string[]) {
  const logger = createLogger('silent');
  logger.warn = (message) => {
    warnings.push(message);
  };
  return logger;
}

async function dispatch(
  ctx: PluginContext,
  type: 'create' | 'update' | 'delete',
  file: string,
  timestamp: number,
  source?: string
): Promise<void> {
  const graph = makeEnvGraph({ rootDir: ctx.rootDir, ids: [] });
  const environment: Pick<
    DevEnvironment,
    'name' | 'moduleGraph' | 'transformRequest'
  > = {
    name: 'client',
    moduleGraph: graph.moduleGraph,
    transformRequest: async () => null,
  };
  const options: Pick<
    HotUpdateOptions,
    'type' | 'file' | 'timestamp' | 'modules'
  > &
    Partial<Pick<HotUpdateOptions, 'read'>> = {
    type,
    file,
    timestamp,
    modules: [],
    read: source === undefined ? undefined : async () => source,
  };
  await handleHotUpdate(
    ctx,
    // SAFETY: The fixture models every DevEnvironment field read by handleHotUpdate: name, moduleGraph, and transformRequest.
    environment as DevEnvironment,
    // SAFETY: The fixture provides every option read by handleHotUpdate; server is unused, and read is optional for its documented non-Vite host path.
    options as HotUpdateOptions
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
    warnContext.logger = warningLogger(warnings);

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

    // Identical repeat warnings dedupe per original path; a new message on
    // the same path still surfaces.
    warnContext.surfaceSourceDiagnostics([diagnostic]);
    expect(warnings).toHaveLength(1);
    warnContext.surfaceSourceDiagnostics([
      { ...diagnostic, message: 'a different failure on the same file' },
    ]);
    expect(warnings).toHaveLength(2);
  });

  test('recovered native parse diagnostics are advisory: warn-only, never strict-fatal, never quarantined', () => {
    // OXC reports recovered diagnostics for sources the consumer's own
    // toolchain accepts (JSX in a `.js` file) — extraction must not be
    // stricter than the host bundler, so these warn and the file stays
    // analyzed in BOTH modes.
    const advisory = {
      code: 'SOURCE_NATIVE_PARSE_ERROR' as const,
      originalPath: 'src/app.js',
      analysisPath: 'src/app.js',
      message: 'Unexpected JSX expression',
    };
    const warnings: string[] = [];
    const strictContext = new PluginContext({
      system: 'src/ds.ts',
      strict: true,
    });
    strictContext.logger = warningLogger(warnings);

    expect(strictContext.surfaceSourceDiagnostics([advisory])).toEqual(
      new Set()
    );
    expect(warnings).toEqual([
      expect.stringContaining('SOURCE_NATIVE_PARSE_ERROR src/app.js'),
    ]);

    // Mixed batch under strict: the fatal line throws and names ONLY the
    // fatal diagnostic; the advisory never joins the quarantine set.
    const fatal = {
      code: 'SOURCE_SVELTE_DEPENDENCY_MISSING' as const,
      originalPath: 'src/Usage.svelte',
      message: 'install svelte to project opted-in source',
    };
    expect(() =>
      strictContext.surfaceSourceDiagnostics([advisory, fatal])
    ).toThrow(/SOURCE_SVELTE_DEPENDENCY_MISSING/);
    const lax = new PluginContext({ system: 'src/ds.ts' });
    lax.logger = strictContext.logger;
    expect(lax.surfaceSourceDiagnostics([advisory, fatal])).toEqual(
      new Set(['src/Usage.svelte'])
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

  test('an adapter diagnostic reset quarantines the invalid original, warns once, and re-seeds the engine', async () => {
    const root = mkdtempSync(join(tmpdir(), 'animus-vite-svelte-reset-'));
    scratchRoots.push(root);
    const { appRoot, localUsage } = writeProject(root, false);
    const definitionPath = 'src/definition.ts';
    const probe = makeStatefulResetProbe();
    const ctx = makeContext(appRoot, probe.engine, ['.ts', '.svelte']);
    const warnings: string[] = [];
    const invalidated: string[] = [];
    const hotMessages: FullReloadPayload[] = [];
    ctx.logger = warningLogger(warnings);
    ctx.devServer = {
      moduleGraph: {
        getModuleById: (id: string) => ({ id }),
        invalidateModule: (mod: { id: string }) => invalidated.push(mod.id),
      },
      hot: {
        send: (message: FullReloadPayload) => hotMessages.push(message),
      },
    };

    await runBuildStart(ctx, async () => null);
    expect(probe.isActive()).toBe(true);
    const clearsBeforeReset = probe.clearCount();
    const malformedSource = `<script>import { badge } from './definition'; const attrs = badge.attrs({</script>`;
    const usagePath = relative(appRoot, localUsage);
    ctx.mutateFileCache((cache) =>
      cache.set(usagePath, {
        hash: contentHash(malformedSource),
        source: malformedSource,
      })
    );

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
      // Quarantine, not abort: the invalid original is excluded from the
      // published generation while the rest of the corpus analyzed —
      // the engine cache cleared once and the re-analysis re-seeded it.
      quarantinedOwnership: ctx.sourceOwnership[usagePath],
      engineActive: probe.isActive(),
    }).toEqual({
      clears: clearsBeforeReset + 1,
      warnings: [expect.stringContaining(`SVELTE_PARSE_ERROR ${usagePath}`)],
      invalidatedCount: 3,
      hotMessages: [{ type: 'full-reload' }],
      transformError: null,
      transformedPaths: [definitionPath],
      quarantinedOwnership: undefined,
      engineActive: true,
    });

    // A second reset over the unchanged bad file re-quarantines silently —
    // the (path, diagnostic) pair already warned, so no repeat noise.
    await ctx.performGeologicalReset();
    expect(warnings).toHaveLength(1);
  });

  test('a permanently-diagnosable sibling never freezes edits, deletes, or retries', async () => {
    const root = mkdtempSync(join(tmpdir(), 'animus-vite-svelte-quarantine-'));
    scratchRoots.push(root);
    const { appRoot, localUsage } = writeProject(root, false);
    const badFile = join(appRoot, 'src', 'Bad.svelte');
    const badSource = `<script>import { badge } from './definition'; const attrs = badge.attrs({</script>`;
    writeFileSync(badFile, badSource);
    const probe = makeEngineProbe();
    const ctx = makeContext(appRoot, probe.engine, ['.ts', '.svelte']);
    const warnings: string[] = [];
    ctx.logger = warningLogger(warnings);

    await runBuildStart(ctx, async () => null);
    const badPath = relative(appRoot, badFile);
    // buildStart quarantined the invalid original: warned, excluded from
    // ownership and from the accepted-corpus dev cache.
    expect(warnings).toEqual([
      expect.stringContaining(`SVELTE_PARSE_ERROR ${badPath}`),
    ]);
    expect(ctx.sourceOwnership[badPath]).toBeUndefined();

    // An unrelated edit analyzes and publishes — the sibling diagnostic
    // must not roll the edit out of the cache or skip the re-analysis.
    const analysesBefore = probe.analyses.length;
    const usagePath = relative(appRoot, localUsage);
    const edited = `<script>\nimport { badge } from './definition';\nconst attrs = badge.attrs({ tone: 'quiet' });\n</script>\n<!-- edited -->\n`;
    await dispatch(ctx, 'update', localUsage, 21, edited);
    expect(probe.analyses.length).toBeGreaterThan(analysesBefore);
    expect(ctx.fileCache.get(usagePath)).toEqual({
      hash: contentHash(edited),
      source: edited,
    });

    // Editing the bad file itself re-ingests and re-quarantines it (cache
    // keeps the new source for the next fix-edit), and the identical
    // diagnostic does not warn twice.
    await dispatch(ctx, 'update', badFile, 22, badSource);
    expect(ctx.fileCache.get(badPath)?.source).toBe(badSource);
    expect(ctx.sourceOwnership[badPath]).toBeUndefined();
    expect(warnings).toHaveLength(1);

    // Deleting a file while the sibling stays diagnosable still prunes it —
    // no ghost restore, and the prune's re-analysis ran.
    unlinkSync(localUsage);
    await dispatch(ctx, 'delete', localUsage, 23);
    expect(ctx.fileCache.has(usagePath)).toBe(false);

    // A failed analysis after a delete also never re-inserts the entry:
    // a delete fires exactly one watcher event, so a restored entry would
    // be a permanent ghost.
    probe.failNextAnalysis();
    unlinkSync(badFile);
    await dispatch(ctx, 'delete', badFile, 24);
    expect(ctx.fileCache.has(badPath)).toBe(false);
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
        return JSON.stringify(
          makeManifest({
            components: { badge: makeComponent(definitionPath, replacement) },
          })
        );
      },
      transformFile: () => ({ code: '', hasComponents: false }),
      clearAnalysisCache: () => {},
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
