import {
  buildSystemPropsModule,
  contentHash,
  createExcludeMatcher,
} from '@animus-ui/extract/pipeline';
import { COALESCING_WINDOW_MS } from '@animus-ui/extract/session';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { resolveConfig } from 'vite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createKitWorkspace,
  disposeTempRoots,
  KIT_SYSTEM_SOURCE,
  resetAnimusGlobals,
} from '../../extract/tests/session/session-fixtures';
import {
  abortedFacts,
  emptyFacts,
  factsExtractor,
  systemImportFacts,
} from '../../extract/tests/source-ingestion-fixtures';
import { runBuildStart } from '../src/build-start';
import { applyResolvedConfig } from '../src/config';
import {
  RESOLVED_COMPONENTS_ID,
  RESOLVED_SYSTEM_PROPS_ID,
} from '../src/constants';
import { PluginContext } from '../src/context';
import { flushSystemReload, handleHotUpdate } from '../src/hmr';
import { HotUpdateEvents } from '../src/hot-update-events';
import { makeContextProbe, makeEnvGraph, published } from './context-probe';
import { makeComponent, makeManifest } from './manifest-fixture';

import type { FactFile } from '../../extract/tests/source-ingestion-fixtures';
import type { ContextProbe } from './context-probe';
import type {
  ProjectManifest,
  SystemConfig,
} from '@animus-ui/extract/pipeline';
import type { SessionPublication } from '@animus-ui/extract/session';
import type { DevEnvironment, ErrorPayload, HotUpdateOptions } from 'vite';

/**
 * Vite dispatches `hotUpdate` once per environment (client first) for one file
 * event: the claiming dispatch submits it to the Session once, and
 * invalidation runs once per module graph, from the Session's outcomes.
 */

interface HotUpdateProbe extends ContextProbe {
  setSystemDependency(file: string): void;
}

function makeContext(
  rootDir: string,
  extras: Partial<PluginContext> = {}
): HotUpdateProbe {
  let systemDependency: string | undefined;
  const base = makeContextProbe(rootDir, {
    extensionsSet: new Set(['.ts', '.tsx', '.js', '.jsx']),
    hotUpdateEvents: new HotUpdateEvents(),
    isSystemDependency(absFile: string) {
      return absFile === systemDependency;
    },
    ...extras,
  });
  return Object.assign(base, {
    setSystemDependency(file: string) {
      systemDependency = file;
    },
  });
}

type HotUpdateEnvironment = Pick<
  DevEnvironment,
  'name' | 'moduleGraph' | 'transformRequest'
>;
type HotUpdateFixtureOptions = Pick<
  HotUpdateOptions,
  'type' | 'file' | 'timestamp' | 'modules'
> &
  Partial<Pick<HotUpdateOptions, 'read'>>;

function runHotUpdate(
  ctx: PluginContext,
  environment: HotUpdateEnvironment,
  options: HotUpdateFixtureOptions
) {
  return handleHotUpdate(
    ctx,
    // SAFETY: The fixture supplies every DevEnvironment field the hook reads.
    environment as DevEnvironment,
    // SAFETY: The fixture supplies every option the hook actually reads.
    options as HotUpdateOptions
  );
}

function makeEnvironment(name: string, moduleIds: string[]) {
  const { moduleGraph, invalidated } = makeEnvGraph({
    rootDir: '/',
    ids: moduleIds,
  });
  const environment: HotUpdateEnvironment = {
    name,
    moduleGraph,
    transformRequest: async () => null,
  };
  return { environment, invalidated };
}

const VIRTUAL_IDS = [RESOLVED_COMPONENTS_ID, RESOLVED_SYSTEM_PROPS_ID];

/** Whether the temp volume ignores case, so two spellings name one file. */
function caseInsensitiveVolume(): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'animus-case-'));
  try {
    writeFileSync(join(dir, 'Probe'), '');
    return existsSync(join(dir, 'probe'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The change set for an edit whose settled bytes Vite's `read()` handed
 *  over: the file as it now reads on disk. */
function settledEdit(path: string) {
  return {
    modifiedFiles: new Set([path]),
    sources: new Map([[path, readFileSync(path, 'utf-8')]]),
  };
}

describe('hotUpdate across environment dispatches', () => {
  let root: string;
  let file: string;
  let readFile: () => Promise<string>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'animus-hot-update-'));
    file = join(root, 'Button.tsx');
    writeFileSync(file, 'export const Button = 1;\n');
    readFile = async () => readFileSync(file, 'utf-8');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('analyzes an update once and invalidates in every environment', async () => {
    const probe = makeContext(root);
    probe.respond(() => [published(probe, { systemPropsChanged: true })]);
    const client = makeEnvironment('client', VIRTUAL_IDS);
    const ssr = makeEnvironment('ssr', VIRTUAL_IDS);
    const event = { type: 'update' as const, file, timestamp: 10 };

    const clientModules = await runHotUpdate(probe.ctx, client.environment, {
      ...event,
      modules: [],
      read: readFile,
    });
    const ssrModules = await runHotUpdate(probe.ctx, ssr.environment, {
      ...event,
      modules: [],
      read: readFile,
    });

    expect(probe.submissions).toEqual([settledEdit(file)]);
    expect(client.invalidated).toEqual(VIRTUAL_IDS);
    expect(ssr.invalidated).toEqual(VIRTUAL_IDS);
    expect(clientModules?.map((m) => m.id)).toEqual(VIRTUAL_IDS);
    expect(ssrModules?.map((m) => m.id)).toEqual(VIRTUAL_IDS);
  });

  it('invalidates conservatively when the burst evicted the decision', async () => {
    // Past the bounded event history the ssr dispatch cannot read the owner's
    // decision; skipping invalidation there is a hydration mismatch.
    const probe = makeContext(root);
    probe.respond(() => [published(probe, { systemPropsChanged: true })]);
    const client = makeEnvironment('client', VIRTUAL_IDS);
    const ssr = makeEnvironment('ssr', VIRTUAL_IDS);
    const event = { type: 'update' as const, file, timestamp: 10 };

    await runHotUpdate(probe.ctx, client.environment, {
      ...event,
      modules: [],
      read: readFile,
    });
    // Seventeen other events claim their own keys, so the 16-entry window
    // drops this event's decision before the ssr dispatch reads it.
    for (let index = 0; index < 17; index++) {
      probe.ctx.hotUpdateEvents.claim(
        'client',
        join(root, `Other${index}.tsx`),
        100 + index
      );
    }

    const ssrModules = await runHotUpdate(probe.ctx, ssr.environment, {
      ...event,
      modules: [],
      read: readFile,
    });

    expect(probe.submissions).toHaveLength(1);
    expect(ssr.invalidated).toEqual(VIRTUAL_IDS);
    expect(ssrModules?.map((m) => m.id)).toEqual(VIRTUAL_IDS);
  });

  it('suppresses the update in every environment when the Session publishes nothing', async () => {
    const probe = makeContext(root);
    // The Session read no change: no attempt, no outcome.
    probe.respond(() => []);
    const client = makeEnvironment('client', VIRTUAL_IDS);
    const ssr = makeEnvironment('ssr', VIRTUAL_IDS);
    const dispatch = (environment: HotUpdateEnvironment) =>
      runHotUpdate(probe.ctx, environment, {
        type: 'update',
        file,
        timestamp: 20,
        modules: [],
        read: readFile,
      });

    const clientModules = await dispatch(client.environment);
    const ssrModules = await dispatch(ssr.environment);

    expect(probe.submissions).toHaveLength(1);
    expect(clientModules).toEqual([]);
    expect(ssrModules).toEqual([]);
    expect(client.invalidated).toEqual([]);
  });

  it('submits a burst of system-dependency events once, after the coalescing window', async () => {
    // A watcher can report a write as it starts and drop the event for its
    // end: the reload reads the disk only once the window has passed.
    const probe = makeContext(root);
    probe.setSystemDependency(file);
    probe.respond(() => [published(probe, { pass: 'full' })]);
    const client = makeEnvironment('client', VIRTUAL_IDS);
    const ssr = makeEnvironment('ssr', VIRTUAL_IDS);
    const dispatch = async (
      type: HotUpdateOptions['type'],
      timestamp: number
    ) => {
      for (const environment of [client.environment, ssr.environment]) {
        const returned = await runHotUpdate(probe.ctx, environment, {
          type,
          file,
          timestamp,
          modules: [],
          read: readFile,
        });
        // The reload owns the delivery; no environment gets its own update.
        expect(returned).toEqual([]);
      }
    };

    await dispatch('update', 30);
    await dispatch('create', 31);
    expect(probe.submissions).toEqual([]);
    await new Promise((settle) => setTimeout(settle, COALESCING_WINDOW_MS * 3));
    expect(probe.submissions).toEqual([
      { modifiedFiles: new Set([file]), removedFiles: new Set() },
    ]);

    await dispatch('delete', 32);
    await flushSystemReload(probe.ctx);
    expect(probe.submissions).toEqual([
      { modifiedFiles: new Set([file]), removedFiles: new Set() },
      { modifiedFiles: new Set(), removedFiles: new Set([file]) },
    ]);
    expect(client.invalidated).toEqual([]);
  });

  it('ingests a created file like an edit', async () => {
    // A created eligible source feeds the same submission as an edit, so
    // the graph is complete before any consumer refetches.
    const probe = makeContext(root);
    probe.respond(() => [published(probe, { systemPropsChanged: true })]);
    const client = makeEnvironment('client', VIRTUAL_IDS);
    const ssr = makeEnvironment('ssr', VIRTUAL_IDS);
    const event = { type: 'create' as const, file, timestamp: 40 };

    const clientModules = await runHotUpdate(probe.ctx, client.environment, {
      ...event,
      modules: [],
      read: readFile,
    });
    await runHotUpdate(probe.ctx, ssr.environment, {
      ...event,
      modules: [],
      read: readFile,
    });

    expect(probe.submissions).toEqual([settledEdit(file)]);
    expect(client.invalidated).toEqual(VIRTUAL_IDS);
    expect(ssr.invalidated).toEqual(VIRTUAL_IDS);
    expect(clientModules?.map((m) => m.id)).toEqual(VIRTUAL_IDS);
  });

  it('submits a watcher-created package file the user exclude would drop', async () => {
    // The Session owns an external file's ingestion and ownership; the hook
    // must not let the user exclude list keep the event from reaching it.
    const kitSrc = join(root, 'kit', 'src');
    mkdirSync(kitSrc, { recursive: true });
    const kitFile = join(kitSrc, 'Chip.tsx');
    writeFileSync(kitFile, 'export const Chip = 1;\n');
    const probe = makeContext(root, {
      externalPackageDirs: [kitSrc],
      excludeMatcher: createExcludeMatcher(['kit']),
    });
    const client = makeEnvironment('client', VIRTUAL_IDS);

    await runHotUpdate(probe.ctx, client.environment, {
      type: 'create',
      file: kitFile,
      timestamp: 45,
      modules: [],
      read: async () => readFileSync(kitFile, 'utf-8'),
    });

    expect(probe.submissions).toEqual([settledEdit(kitFile)]);
  });

  it('coalesces a create the Session already holds without overriding the module list', async () => {
    // A late create must return undefined, not []: Vite reads [] as an explicit
    // module list and drops the resolve-failed importers it seeds on create.
    const probe = makeContext(root);
    probe.respond(() => []);
    const client = makeEnvironment('client', VIRTUAL_IDS);

    const returned = await runHotUpdate(probe.ctx, client.environment, {
      type: 'create',
      file,
      timestamp: 41,
      modules: [],
      read: readFile,
    });

    expect(returned).toBeUndefined();
  });

  it('prunes a deleted file once across environments', async () => {
    const probe = makeContext(root);
    const client = makeEnvironment('client', VIRTUAL_IDS);
    const ssr = makeEnvironment('ssr', VIRTUAL_IDS);

    for (const environment of [client.environment, ssr.environment]) {
      const returned = await runHotUpdate(probe.ctx, environment, {
        type: 'delete',
        file,
        timestamp: 50,
        modules: [],
        read: readFile,
      });
      expect(returned).toBeUndefined();
    }

    expect(probe.submissions).toEqual([{ removedFiles: new Set([file]) }]);
    expect(probe.extractedInvalidations).toBe(1);
  });
});

function makeFileGraph(absPath: string) {
  const invalidated: string[] = [];
  const node = { id: absPath, url: absPath, file: absPath };
  return {
    invalidated,
    moduleGraph: {
      getModulesByFile: (file: string) =>
        file === absPath ? new Set([node]) : undefined,
      getModuleById: () => undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      invalidateModule: (mod: any) => invalidated.push(String(mod.id)),
    },
  };
}

describe('hotUpdate delete re-delivers consumers whose plan changed', () => {
  let root: string;
  let file: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'animus-hot-update-del-'));
    file = join(root, 'Button.tsx');
    writeFileSync(file, 'export const Button = 1;\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('evicts consumer modules when a deleted parent drops their chains', async () => {
    const probe = makeContext(root);
    const ctx = probe.ctx;
    probe.respond(() => [
      published(probe, {
        manifest: makeManifest(),
        planChanged: ['Fancy.tsx'],
      }),
    ]);
    const consumerAbs = resolve(root, 'Fancy.tsx');
    const graph = makeFileGraph(consumerAbs);
    ctx.devServer = {
      environments: { client: { moduleGraph: graph.moduleGraph } },
    };
    const client = makeEnvironment('client', VIRTUAL_IDS);

    await runHotUpdate(probe.ctx, client.environment, {
      type: 'delete',
      file,
      timestamp: 55,
      modules: [],
      read: async () => '',
    });

    expect(probe.submissions).toHaveLength(1);
    expect(graph.invalidated).toEqual([consumerAbs]);
    expect(probe.extractedInvalidations).toBe(1);
  });
});

/**
 * The source corpus is reconciled before a dropped-chain analysis is acted on,
 * so the consumer's first re-serve is extracted, never the runtime fallback.
 */
describe('hotUpdate recovers a new imported parent found on disk', () => {
  let root: string;
  let consumer: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'animus-hot-update-rec-'));
    consumer = join(root, 'Consumer.tsx');
    writeFileSync(
      join(root, 'Parent.tsx'),
      "export const Parent = ds.styles({}).asElement('div');\n"
    );
    writeFileSync(
      consumer,
      "import { Parent } from './Parent';\n" +
        "export const Fancy = Parent.extend().styles({}).asElement('div');\n"
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('folds the parent during the consumer edit and re-analyzes once', async () => {
    const probe = makeContext(root);
    // The Session holds the consumer, not the parent its watcher never saw.
    probe.session.heldSources.set('Consumer.tsx', {
      hash: 'h',
      source: readFileSync(consumer, 'utf-8'),
    });
    probe.respond(() =>
      probe.submissions.length === 1
        ? [
            published(probe, {
              manifest: makeManifest({
                missing_inputs: [
                  {
                    file: 'Consumer.tsx',
                    component: 'Fancy',
                    parent: 'Parent',
                    specifier: './Parent',
                    base: 'Parent',
                    outcome: 'absent',
                  },
                ],
              }),
            }),
          ]
        : [
            published(probe, {
              manifest: makeManifest({
                components: {
                  'Parent.tsx::Parent': makeComponent('Parent.tsx', 'rp'),
                  'Consumer.tsx::Fancy': makeComponent('Consumer.tsx', 'rf'),
                },
                files: {
                  'Parent.tsx': ['Parent.tsx::Parent'],
                  'Consumer.tsx': ['Consumer.tsx::Fancy'],
                },
              }),
            }),
          ]
    );
    const client = makeEnvironment('client', VIRTUAL_IDS);

    const returned = await runHotUpdate(probe.ctx, client.environment, {
      type: 'update',
      file: consumer,
      timestamp: 70,
      modules: [],
      read: async () => readFileSync(consumer, 'utf-8'),
    });

    expect(probe.submissions).toEqual([
      settledEdit(consumer),
      { modifiedFiles: new Set([join(root, 'Parent.tsx')]) },
    ]);
    expect(returned?.map((m) => m.id)).toContain(RESOLVED_COMPONENTS_ID);
  });
});

/**
 * An atomic save leaves the path momentarily empty: Vite's `read()` helper
 * retries until the save lands and returns the settled bytes, which the
 * analysis must hold even while the disk still reads empty.
 */
describe('hotUpdate reads through the retry-guarded read helper', () => {
  let restoreGlobals: () => void;

  beforeEach(() => {
    restoreGlobals = resetAnimusGlobals();
  });

  afterEach(() => {
    restoreGlobals();
    disposeTempRoots();
  });

  /** A dev context over a kit workspace with a Session behind it, started,
   *  whose system load fails while `systemLoadFails` is set. */
  async function startedContext(exclude?: string[]) {
    const { parent, app } = createKitWorkspace();
    const file = join(app, 'src', 'Button.tsx');
    writeFileSync(file, 'export const Button = 1;\n');
    const state = { systemLoadFails: false, systemLoads: 0 };
    const systemFacts = factsExtractor({
      [join(app, 'src', 'system.ts')]: {
        ...emptyFacts(join(app, 'src', 'system.ts')),
        imports: systemImportFacts(KIT_SYSTEM_SOURCE),
      },
    });
    const ctx = new PluginContext(
      { system: './src/system.ts', exclude },
      () => ({
        loadSystemModule: () => {
          state.systemLoads += 1;
          if (state.systemLoadFails) throw new Error('planned system failure');
          return {
            propConfig: '{}',
            groupRegistry: '{}',
            scalesJson: '{}',
            variableMapJson: '{}',
            variableCss: '',
            dependencies: [],
          };
        },
        extractFacts: (filesJson: string) => {
          // SAFETY: the Session's own JSON.stringify of its file entries.
          const entries = JSON.parse(filesJson) as Array<{
            path: string;
            source: string;
          }>;
          // SAFETY: the facts double above serializes this shape.
          const facts = JSON.parse(systemFacts(filesJson)) as {
            files: Record<string, FactFile>;
          };
          // The parser stops before the end of a source holding `= ;`.
          for (const { path, source } of entries) {
            if (source.includes('= ;')) facts.files[path] = abortedFacts(path);
          }
          return JSON.stringify(facts);
        },
        analyzeProject: () => JSON.stringify(makeManifest()),
      })
    );
    applyResolvedConfig(
      ctx,
      await resolveConfig(
        { configFile: false, root: app, logLevel: 'silent' },
        'serve'
      )
    );
    await runBuildStart(ctx, async (specifier) =>
      resolve(app, 'src', specifier)
    );
    const client = makeEnvironment('client', VIRTUAL_IDS);
    let timestamp = 60;
    const update = (
      path: string,
      read?: () => Promise<string>,
      type: HotUpdateOptions['type'] = 'update'
    ) =>
      runHotUpdate(ctx, client.environment, {
        type,
        file: path,
        timestamp: timestamp++,
        modules: [],
        read,
      });
    return { parent, app, file, ctx, state, update };
  }

  it('caches the retried content, not the empty file on disk', async () => {
    const { file, ctx, update } = await startedContext();

    const settled = 'export const Button = 2;\n';
    // The atomic-save window: the path exists and is empty right now.
    writeFileSync(file, '');
    await update(file, async () => settled);

    expect(ctx.session?.heldSources.get('src/Button.tsx')).toEqual({
      hash: contentHash(settled),
      source: settled,
    });
    ctx.close();
  });

  // Contract: a held full read keeps what it read, and a deferred reload
  // refuses only over held host bytes the disk lacks; it never publishes
  // the disk over them, and it publishes once the disk holds them.
  it('refuses a reload a parse hold deferred rather than publish the disk over held bytes', async () => {
    const { app, file, ctx, state, update } = await startedContext();
    const card12 = 'export const Button = 12;\n';
    writeFileSync(file, '');
    await update(file, async () => card12);
    const broken = join(app, 'src', 'Broken.ts');
    writeFileSync(broken, 'export const broken = 1;\n');
    await update(broken, async () => 'export const broken = 1;\n', 'create');

    state.systemLoadFails = true;
    await update(join(app, 'src', 'system.ts'));
    await flushSystemReload(ctx);
    state.systemLoadFails = false;

    // The owed reload enters a parse hold, and its held full read keeps the
    // Broken bytes it read. The Card edit that follows is held behind it,
    // with no reload of its own.
    writeFileSync(broken, 'export const broken = ;\n');
    await update(broken, async () => 'export const broken = ;\n');
    const card20 = 'export const Button = 20;\n';
    const loads = state.systemLoads;
    await update(file, async () => card20);
    expect(state.systemLoads).toBe(loads);
    expect(ctx.session?.heldSources.get('src/Button.tsx')?.source).toBe(card20);

    // The repair would run the deferred reload over the empty Card on disk.
    const repaired = 'export const broken = 2;\n';
    writeFileSync(broken, repaired);
    await expect(update(broken, async () => repaired)).rejects.toThrow(
      /system reload not published: .*src\/Button\.tsx/
    );
    const publishedCard = () =>
      ctx.session?.corpus.published.analysisEntries.get('src/Button.tsx')
        ?.source;
    expect(publishedCard()).toBe(card12);

    // Once the disk holds the bytes, the next change publishes the reload.
    writeFileSync(file, card20);
    const repairedAgain = 'export const broken = 3;\n';
    writeFileSync(broken, repairedAgain);
    await update(broken, async () => repairedAgain);
    expect(publishedCard()).toBe(card20);
    ctx.close();
  });

  // Two spellings name one file only on a case-insensitive volume.
  it.skipIf(!caseInsensitiveVolume())(
    'a full read that reaches host bytes only under another spelling refuses',
    async () => {
      // A debt retry takes an edit Vite reports as src/button.tsx while the
      // full read discovers src/Button.tsx: it must not publish the disk.
      const { app, file, ctx, state, update } = await startedContext();
      const publishedButton = () =>
        ctx.session?.corpus.published.analysisEntries.get('src/Button.tsx')
          ?.source;
      const button12 = 'export const Button = 12;\n';
      writeFileSync(file, '');
      await update(file, async () => button12);

      state.systemLoadFails = true;
      await update(join(app, 'src', 'system.ts'));
      await flushSystemReload(ctx);
      state.systemLoadFails = false;

      await expect(
        update(
          join(app, 'src', 'button.tsx'),
          async () => 'export const Button = 30;\n'
        )
      ).rejects.toThrow(
        /reload not published: .*src\/button\.tsx \(read as src\/Button\.tsx\)/
      );
      expect(publishedButton()).toBe(button12);
      ctx.close();
    }
  );

  /** A failed system reload leaves a debt, so the next batch runs a full
   *  read; Button is published from host bytes over an empty disk. */
  async function owedReloadOverHostBytes(exclude?: string[]) {
    const started = await startedContext(exclude);
    const { app, file, ctx, state, update } = started;
    writeFileSync(file, '');
    await update(file, async () => 'export const Button = 12;\n');
    state.systemLoadFails = true;
    await update(join(app, 'src', 'system.ts'));
    await flushSystemReload(ctx);
    state.systemLoadFails = false;
    const publishedButton = () =>
      ctx.session?.corpus.published.analysisEntries.get('src/Button.tsx')
        ?.source;
    return { ...started, publishedButton };
  }

  // Two spellings name two files only on a case-sensitive volume.
  it.skipIf(caseInsensitiveVolume())(
    'a host source for an excluded file never refuses for a distinct file spelled alike',
    async () => {
      const { app, file, ctx, publishedButton } = await owedReloadOverHostBytes(
        ['**/Ignored.ts']
      );
      const excluded = join(app, 'src', 'Ignored.ts');
      writeFileSync(excluded, 'export const ignored = 1;\n');
      writeFileSync(
        join(app, 'src', 'ignored.ts'),
        'export const other = 1;\n'
      );
      const button30 = 'export const Button = 30;\n';
      writeFileSync(file, button30);

      await ctx.session!.handleWatchUpdate({
        modifiedFiles: new Set([excluded, file]),
        sources: new Map([
          [excluded, 'export const ignored = 2;\n'],
          [file, button30],
        ]),
      });
      expect(publishedButton()).toBe(button30);
      ctx.close();
    }
  );

  it('a full read that reaches host bytes only through a symlinked alias refuses', async () => {
    const { parent, app, ctx, publishedButton } =
      await owedReloadOverHostBytes();
    // An alias outside the root names the root's src directory.
    const alias = join(parent, 'alias-src');
    symlinkSync(join(app, 'src'), alias, 'dir');
    const aliased = join(alias, 'Button.tsx');

    await expect(
      ctx.session!.handleWatchUpdate({
        modifiedFiles: new Set([aliased]),
        sources: new Map([[aliased, 'export const Button = 30;\n']]),
      })
    ).rejects.toThrow(
      /reload not published: .*alias-src\/Button\.tsx \(read as src\/Button\.tsx\)/
    );
    expect(publishedButton()).toBe('export const Button = 12;\n');
    ctx.close();
  });

  it('analyzes the retried content when a system reload debt takes the edit', async () => {
    // A failed system reload leaves debt, so the next edit is analyzed by a
    // full pass; that pass must read the settled bytes, not the empty disk.
    const { app, file, ctx, state, update } = await startedContext();
    writeFileSync(file, '');
    await update(file, async () => 'export const Button = 2;\n');

    state.systemLoadFails = true;
    await update(join(app, 'src', 'system.ts'));
    await flushSystemReload(ctx);
    state.systemLoadFails = false;

    const settled = 'export const Button = 3;\n';
    await update(file, async () => settled);

    expect(
      ctx.session?.corpus.published.analysisEntries.get('src/Button.tsx')
        ?.source
    ).toBe(settled);
    expect(ctx.session?.heldSources.get('src/Button.tsx')?.source).toBe(
      settled
    );
    ctx.close();
  });
});

/** A context with its own Session, whose watch updates publish the given
 *  manifests through the context's real outcome observation. */
function observedContext(root: string) {
  const ctx = new PluginContext({ system: './ds.ts' }, () => ({}));
  ctx.rootDir = root;
  ctx.excludeMatcher = createExcludeMatcher(undefined);
  const session = ctx.createSession();
  const system: SystemConfig = { ...ctx.system };
  const publish = (manifest: ProjectManifest) => {
    const publication: SessionPublication = {
      manifest,
      manifestJson: JSON.stringify(manifest),
      analysisGlobalCss: '',
      analysisComponentCss: '',
      styles: '',
      fontPreloads: [],
      // Built from the same inputs as the Session builds it.
      systemPropsModule: buildSystemPropsModule({
        systemPropMapJson: JSON.stringify(manifest.system_prop_map),
        groupRegistryJson: system.groupRegistryJson,
        dynamicProps: manifest.dynamic_props,
        admittedTransforms: manifest.admitted_transforms,
        typedSystemProps: manifest.typed_system_props,
      }),
      system,
      packageMap: {},
      ownership: {},
      analyzedHashes: new Map(),
      packageReadRecord: null,
      replacementEpoch: '',
      externalPackageDirs: [],
      externalSourceEntries: new Map(),
      externalSourceSideEffects: new Map(),
    };
    session.publication = publication;
    session.onOutcome?.({
      kind: 'published',
      publication,
      pass: 'incremental',
      planChanged: [],
      endedHold: false,
      redeliver: [],
    });
  };
  let next = makeManifest();
  session.handleWatchUpdate = async () => publish(next);
  return {
    ctx,
    publish,
    publishNext(manifest: ProjectManifest) {
      next = manifest;
    },
  };
}

/**
 * Every module that renders a system prop imports the map module, so it is
 * re-delivered only when its content moved.
 */
describe('hotUpdate gates system-props invalidation on a changed map', () => {
  let root: string;
  let file: string;
  let readFile: () => Promise<string>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'animus-hot-update-props-'));
    file = join(root, 'Button.tsx');
    writeFileSync(file, 'export const Button = 1;\n');
    readFile = async () => readFileSync(file, 'utf-8');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const MAP = { p: { '8': 'animus-u-abc' } };

  const dispatch = (
    ctx: PluginContext,
    environment: HotUpdateEnvironment,
    timestamp: number
  ) =>
    runHotUpdate(ctx, environment, {
      type: 'update',
      file,
      timestamp,
      modules: [],
      read: readFile,
    });

  it('leaves the map module alone when the analysis republished it unchanged', async () => {
    const { ctx, publish, publishNext } = observedContext(root);
    publish(makeManifest({ system_prop_map: MAP }));
    publishNext(makeManifest({ system_prop_map: MAP }));
    const client = makeEnvironment('client', VIRTUAL_IDS);
    const ssr = makeEnvironment('ssr', VIRTUAL_IDS);

    const clientModules = await dispatch(ctx, client.environment, 71);
    const ssrModules = await dispatch(ctx, ssr.environment, 71);

    expect(client.invalidated).toEqual([RESOLVED_COMPONENTS_ID]);
    expect(ssr.invalidated).toEqual([RESOLVED_COMPONENTS_ID]);
    expect(clientModules?.map((m) => m.id)).toEqual([RESOLVED_COMPONENTS_ID]);
    expect(ssrModules?.map((m) => m.id)).toEqual([RESOLVED_COMPONENTS_ID]);
  });

  it('invalidates the map module when a new prop value appears', async () => {
    const { ctx, publish, publishNext } = observedContext(root);
    publish(makeManifest({ system_prop_map: MAP }));
    publishNext(
      makeManifest({ system_prop_map: { p: { '24': 'animus-u-def' } } })
    );
    const client = makeEnvironment('client', VIRTUAL_IDS);

    const modules = await dispatch(ctx, client.environment, 80);

    expect(client.invalidated).toEqual(VIRTUAL_IDS);
    expect(modules?.map((m) => m.id)).toEqual(VIRTUAL_IDS);
  });

  it('invalidates when only the dynamic prop config moved', async () => {
    // The map is one of several inputs to the served module and they move
    // independently, so the comparison is over the generated module.
    const { ctx, publish, publishNext } = observedContext(root);
    publish(makeManifest());
    // The meta must carry the manifest's real shape — the config builder
    // fails loud on entries missing varName/slotClass.
    publishNext(
      makeManifest({
        dynamic_props: {
          width: {
            varName: '--animus-width',
            slotClass: 'animus-dyn-width',
            property: 'width',
          },
        },
      })
    );
    const client = makeEnvironment('client', VIRTUAL_IDS);

    const modules = await dispatch(ctx, client.environment, 81);

    expect(ctx.systemPropsModule).toContain('export const systemPropMap = {};');
    expect(client.invalidated).toEqual(VIRTUAL_IDS);
    expect(modules?.map((m) => m.id)).toEqual(VIRTUAL_IDS);
  });
});

describe('hotUpdate system-reload error wiring', () => {
  it('a strict reset failure surfaces as warn + overlay, not a process kill', async () => {
    const root = mkdtempSync(join(tmpdir(), 'animus-hot-update-strict-'));
    try {
      const file = join(root, 'ds.ts');
      const probe = makeContext(root, {
        options: { system: './ds.ts', strict: true },
      });
      probe.setSystemDependency(file);
      probe.respond(() => {
        throw new Error(
          '[animus-extract] unresolvable asset() specifier: @acme/typo.woff2'
        );
      });
      const sent: ErrorPayload[] = [];
      probe.ctx.devServer = {
        hot: { send: (payload: ErrorPayload) => sent.push(payload) },
      };
      const client = makeEnvironment('client', VIRTUAL_IDS);

      const returned = await runHotUpdate(probe.ctx, client.environment, {
        type: 'update',
        file,
        timestamp: 95,
        modules: [],
      });

      expect(returned).toEqual([]);
      await flushSystemReload(probe.ctx);
      expect(
        probe.warnings.some((w) => w.includes('system reload failed'))
      ).toBe(true);
      expect(sent).toHaveLength(1);
      expect(sent[0].type).toBe('error');
      expect(sent[0].err.message).toContain('@acme/typo.woff2');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
