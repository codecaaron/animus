import { contentHash } from '@animus-ui/extract/pipeline';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  RESOLVED_COMPONENTS_ID,
  RESOLVED_SYSTEM_PROPS_ID,
} from '../src/constants';
import { handleHotUpdate } from '../src/hmr';
import { HotUpdateEvents } from '../src/hot-update-events';
import { makeContextProbe, makeEnvGraph } from './context-probe';
import { makeComponent, makeManifest } from './manifest-fixture';

import type { ContextProbe } from './context-probe';
import type { DevEnvironment, HotUpdateOptions } from 'vite';

/**
 * Vite dispatches `hotUpdate` once per environment (client first) for one file
 * event: analysis runs once across them, invalidation once per module graph.
 */

interface HotUpdateProbe extends ContextProbe {
  resets: string[];
  /** Inputs the next analysis publishes; an omitted one is republished. */
  setNextSystemProps(next: { map?: string; dynamicProps?: string }): void;
  setSystemDependency(file: string): void;
}

function makeContext(rootDir: string): HotUpdateProbe {
  const resets: string[] = [];
  let nextMap: string | undefined;
  let nextDynamicProps: string | undefined;
  let systemDependency: string | undefined;
  const base = makeContextProbe(rootDir, {
    extensionsSet: new Set(['.ts', '.tsx', '.js', '.jsx']),
    reverseProvenance: {},
    hotUpdateEvents: new HotUpdateEvents(),
    isSystemDependency(absFile: string) {
      return absFile === systemDependency;
    },
    requestSystemReload(trigger: string) {
      resets.push(trigger);
    },
  });
  base.ctx.runAnalysis = () => {
    base.analyses++;
    if (nextMap !== undefined) base.ctx.storedSystemPropMapJson = nextMap;
    if (nextDynamicProps !== undefined) {
      base.ctx.storedDynamicPropsJson = nextDynamicProps;
    }
    // The served module is keyed on these inputs by its reader, so publishing
    // them is the whole writer contract; there is no memo to refresh.
    return true;
  };
  return Object.assign(base, {
    resets,
    setNextSystemProps(update: { map?: string; dynamicProps?: string }) {
      nextMap = update.map;
      nextDynamicProps = update.dynamicProps;
    },
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
  ctx: ContextProbe['ctx'],
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
    probe.setNextSystemProps({ map: '{"p":{"8":"animus-u-abc"}}' });
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

    expect(probe.analyses).toBe(1);
    expect(probe.ctx.fileCache.size).toBe(1);
    expect(client.invalidated).toEqual(VIRTUAL_IDS);
    expect(ssr.invalidated).toEqual(VIRTUAL_IDS);
    expect(clientModules?.map((m) => m.id)).toEqual(VIRTUAL_IDS);
    expect(ssrModules?.map((m) => m.id)).toEqual(VIRTUAL_IDS);
  });

  it('invalidates conservatively when the burst evicted the decision', async () => {
    // Past the bounded event history the ssr dispatch cannot read the owner's
    // decision; skipping invalidation there is a hydration mismatch.
    const probe = makeContext(root);
    probe.setNextSystemProps({ map: '{"p":{"8":"animus-u-abc"}}' });
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

    expect(probe.analyses).toBe(1);
    expect(ssr.invalidated).toEqual(VIRTUAL_IDS);
    expect(ssrModules?.map((m) => m.id)).toEqual(VIRTUAL_IDS);
  });

  it('suppresses the update in every environment when content is unchanged', async () => {
    const probe = makeContext(root);
    const client = makeEnvironment('client', VIRTUAL_IDS);
    const ssr = makeEnvironment('ssr', VIRTUAL_IDS);
    const dispatch = (environment: HotUpdateEnvironment, timestamp: number) =>
      runHotUpdate(probe.ctx, environment, {
        type: 'update',
        file,
        timestamp,
        modules: [],
        read: readFile,
      });

    await dispatch(client.environment, 10);
    await dispatch(ssr.environment, 10);
    const clientModules = await dispatch(client.environment, 20);
    const ssrModules = await dispatch(ssr.environment, 20);

    expect(probe.analyses).toBe(1);
    expect(clientModules).toEqual([]);
    expect(ssrModules).toEqual([]);
  });

  it('schedules one system reload per system-dependency event', async () => {
    const probe = makeContext(root);
    probe.setSystemDependency(file);
    const client = makeEnvironment('client', VIRTUAL_IDS);
    const ssr = makeEnvironment('ssr', VIRTUAL_IDS);

    const types = ['update', 'create', 'delete'] as const;
    for (const [index, type] of types.entries()) {
      const timestamp = 30 + index;
      for (const environment of [client.environment, ssr.environment]) {
        const returned = await runHotUpdate(probe.ctx, environment, {
          type,
          file,
          timestamp,
          modules: [],
          read: readFile,
        });
        // The reset owns the delivery; no environment gets its own update.
        expect(returned).toEqual([]);
      }
    }

    expect(probe.resets).toEqual(['Button.tsx', 'Button.tsx', 'Button.tsx']);
    expect(probe.analyses).toBe(0);
    expect(client.invalidated).toEqual([]);
  });

  it('ingests a created file like an edit', async () => {
    // A created eligible source feeds the same analysis path as an edit, so
    // the graph is complete before any consumer refetches.
    const probe = makeContext(root);
    probe.setNextSystemProps({ map: '{"p":{"8":"animus-u-abc"}}' });
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

    expect(probe.analyses).toBe(1);
    expect(probe.ctx.fileCache.size).toBe(1);
    expect(client.invalidated).toEqual(VIRTUAL_IDS);
    expect(ssr.invalidated).toEqual(VIRTUAL_IDS);
    expect(clientModules?.map((m) => m.id)).toEqual(VIRTUAL_IDS);
  });

  it('records external ownership for a watcher-created package file', async () => {
    // Diagnostics correlate through `externalFileOwners`, so a watcher-created
    // external file must be owned before its first analysis.
    const kitSrc = join(root, 'kit', 'src');
    mkdirSync(kitSrc, { recursive: true });
    const kitFile = join(kitSrc, 'Chip.tsx');
    writeFileSync(kitFile, 'export const Chip = 1;\n');
    const probe = makeContext(root);
    const ctx = probe.ctx;
    ctx.externalPackageDirs = [kitSrc];
    ctx.externalDirOwners = { [kitSrc]: '@scope/kit' };
    ctx.externalFileOwners = {};
    const client = makeEnvironment('client', VIRTUAL_IDS);

    await runHotUpdate(probe.ctx, client.environment, {
      type: 'create',
      file: kitFile,
      timestamp: 45,
      modules: [],
      read: async () => readFileSync(kitFile, 'utf-8'),
    });

    expect(probe.analyses).toBe(1);
    expect(ctx.externalFileOwners).toEqual({
      'kit/src/Chip.tsx': '@scope/kit',
    });
  });

  it('coalesces a pre-registered create without overriding the module list', async () => {
    // A late create must return undefined, not []: Vite reads [] as an explicit
    // module list and drops the resolve-failed importers it seeds on create.
    const probe = makeContext(root);
    const source = readFileSync(file, 'utf-8');
    probe.ctx.mutateFileCache((cache) =>
      cache.set('Button.tsx', {
        hash: contentHash(source),
        source,
      })
    );
    const client = makeEnvironment('client', VIRTUAL_IDS);

    const returned = await runHotUpdate(probe.ctx, client.environment, {
      type: 'create',
      file,
      timestamp: 41,
      modules: [],
      read: async () => source,
    });

    expect(returned).toBeUndefined();
    expect(probe.analyses).toBe(0);
  });

  it('prunes a deleted file once across environments', async () => {
    const probe = makeContext(root);
    probe.ctx.mutateFileCache((cache) =>
      cache.set('Button.tsx', { hash: 'h', source: 'src' })
    );
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

    expect(probe.ctx.fileCache.size).toBe(0);
    expect(probe.analyses).toBe(1);
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
    probe.ctx.mutateFileCache((cache) =>
      cache.set('Button.tsx', { hash: 'h', source: 's' })
    );
    const ctx = probe.ctx;
    ctx.storedManifest = makeManifest({
      components: {
        'Fancy.tsx::Fancy': makeComponent(
          'Fancy.tsx',
          "createComponent('div', 'a')"
        ),
      },
      files: { 'Fancy.tsx': ['Fancy.tsx::Fancy'] },
    });
    ctx.runAnalysis = () => {
      probe.analyses++;
      ctx.storedManifest = makeManifest();
      return true;
    };
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

    expect(probe.analyses).toBe(1);
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
    const ctx = probe.ctx;
    ctx.runAnalysis = () => {
      probe.analyses++;
      if (probe.analyses === 1) {
        ctx.storedManifest = makeManifest({
          diagnostics: [
            {
              file: 'Consumer.tsx',
              component: 'Fancy',
              kind: 'bail',
              message:
                "chain dropped: could not resolve parent component 'Parent'",
            },
          ],
        });
      } else {
        ctx.storedManifest = makeManifest({
          components: {
            'Parent.tsx::Parent': makeComponent('Parent.tsx', 'rp'),
            'Consumer.tsx::Fancy': makeComponent('Consumer.tsx', 'rf'),
          },
          files: {
            'Parent.tsx': ['Parent.tsx::Parent'],
            'Consumer.tsx': ['Consumer.tsx::Fancy'],
          },
        });
      }
      return true;
    };
    const client = makeEnvironment('client', VIRTUAL_IDS);

    const returned = await runHotUpdate(probe.ctx, client.environment, {
      type: 'update',
      file: consumer,
      timestamp: 70,
      modules: [],
      read: async () => readFileSync(consumer, 'utf-8'),
    });

    expect(probe.analyses).toBe(2);
    expect(probe.ctx.fileCache.has('Parent.tsx')).toBe(true);
    expect(returned?.map((m) => m.id)).toContain(RESOLVED_COMPONENTS_ID);
  });
});

/**
 * A failed analysis must not record its content as analyzed: the hash gate
 * would then suppress the same-content retry and the session never recovers.
 */
describe('hotUpdate failed analysis reopens the hash gate', () => {
  let root: string;
  let file: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'animus-hot-update-fail-'));
    file = join(root, 'Button.tsx');
    writeFileSync(file, 'export const Button = 2;\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('restores the previous cache entry and re-analyzes the same content', async () => {
    const old = 'export const Button = 1;\n';
    const probe = makeContext(root);
    probe.ctx.mutateFileCache((cache) =>
      cache.set('Button.tsx', {
        hash: contentHash(old),
        source: old,
      })
    );
    probe.ctx.runAnalysis = () => {
      probe.analyses++;
      return false;
    };
    const client = makeEnvironment('client', VIRTUAL_IDS);
    const dispatch = (timestamp: number) =>
      runHotUpdate(probe.ctx, client.environment, {
        type: 'update',
        file,
        timestamp,
        modules: [],
        read: async () => readFileSync(file, 'utf-8'),
      });

    const first = await dispatch(60);

    expect(first).toBeUndefined();
    expect(probe.ctx.fileCache.get('Button.tsx')).toEqual({
      hash: contentHash(old),
      source: old,
    });

    await dispatch(61);

    expect(probe.analyses).toBe(2);
  });

  /**
   * A throw from the reconciling re-analysis must still roll the cache entry
   * back, or a byte-identical re-save hits the unchanged-hash gate.
   */
  it('restores the cache entry when stabilization throws after a good analysis', async () => {
    const old = 'export const Button = 1;\n';
    // On disk but not cached, so stabilization's walk folds it and re-analyzes.
    writeFileSync(join(root, 'Parent.tsx'), 'export const Parent = 1;\n');
    const probe = makeContext(root);
    probe.ctx.mutateFileCache((cache) =>
      cache.set('Button.tsx', {
        hash: contentHash(old),
        source: old,
      })
    );
    const ctx = probe.ctx;
    ctx.runAnalysis = () => {
      probe.analyses++;
      if (probe.analyses === 1) {
        ctx.storedManifest = makeManifest({
          diagnostics: [
            {
              file: 'Button.tsx',
              component: 'Fancy',
              kind: 'bail',
              message:
                "chain dropped: could not resolve parent component 'Parent'",
            },
          ],
        });
        return true;
      }
      throw new Error('error diagnostics fail the build');
    };
    const client = makeEnvironment('client', VIRTUAL_IDS);

    await expect(
      runHotUpdate(probe.ctx, client.environment, {
        type: 'update',
        file,
        timestamp: 60,
        modules: [],
        read: async () => readFileSync(file, 'utf-8'),
      })
    ).rejects.toThrow();

    expect(probe.analyses).toBe(2);
    expect(probe.ctx.fileCache.get('Button.tsx')).toEqual({
      hash: contentHash(old),
      source: old,
    });
  });
});

/**
 * An atomic save leaves the path momentarily empty, so the hook reads through
 * Vite's retrying `read()` helper; a raw read caches `''` for the process.
 */
describe('hotUpdate reads through the retry-guarded read helper', () => {
  let root: string;
  let file: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'animus-hot-update-read-'));
    file = join(root, 'Button.tsx');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('caches the retried content, not the empty file on disk', async () => {
    const settled = 'export const Button = 2;\n';
    // The atomic-save window: the path exists and is empty right now.
    writeFileSync(file, '');
    const probe = makeContext(root);
    const client = makeEnvironment('client', VIRTUAL_IDS);

    await runHotUpdate(probe.ctx, client.environment, {
      type: 'update',
      file,
      timestamp: 60,
      modules: [],
      read: async () => settled,
    });

    expect(probe.ctx.fileCache.get('Button.tsx')).toEqual({
      hash: contentHash(settled),
      source: settled,
    });
  });

  it('falls back to the file on disk when no read helper is supplied', async () => {
    const onDisk = 'export const Button = 3;\n';
    writeFileSync(file, onDisk);
    const probe = makeContext(root);
    const client = makeEnvironment('client', VIRTUAL_IDS);

    await runHotUpdate(probe.ctx, client.environment, {
      type: 'update',
      file,
      timestamp: 61,
      modules: [],
    });

    expect(probe.ctx.fileCache.get('Button.tsx')?.source).toBe(onDisk);
  });
});

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

  const dispatch = (
    probe: ContextProbe,
    environment: HotUpdateEnvironment,
    timestamp: number
  ) =>
    runHotUpdate(probe.ctx, environment, {
      type: 'update',
      file,
      timestamp,
      modules: [],
      read: readFile,
    });

  it('leaves the map module alone when the analysis republished it unchanged', async () => {
    const probe = makeContext(root);
    probe.setNextSystemProps({ map: '{"p":{"8":"animus-u-abc"}}' });
    const client = makeEnvironment('client', VIRTUAL_IDS);
    const ssr = makeEnvironment('ssr', VIRTUAL_IDS);
    await dispatch(probe, client.environment, 70);
    await dispatch(probe, ssr.environment, 70);
    const seeded = {
      client: client.invalidated.length,
      ssr: ssr.invalidated.length,
    };

    writeFileSync(file, 'export const Button = 1; // restyled\n');
    const clientModules = await dispatch(probe, client.environment, 71);
    const ssrModules = await dispatch(probe, ssr.environment, 71);

    expect(probe.analyses).toBe(2);
    expect(client.invalidated.slice(seeded.client)).toEqual([
      RESOLVED_COMPONENTS_ID,
    ]);
    expect(ssr.invalidated.slice(seeded.ssr)).toEqual([RESOLVED_COMPONENTS_ID]);
    expect(clientModules?.map((m) => m.id)).toEqual([RESOLVED_COMPONENTS_ID]);
    expect(ssrModules?.map((m) => m.id)).toEqual([RESOLVED_COMPONENTS_ID]);
  });

  it('invalidates the map module when a new prop value appears', async () => {
    const probe = makeContext(root);
    const client = makeEnvironment('client', VIRTUAL_IDS);
    probe.setNextSystemProps({ map: '{"p":{"24":"animus-u-def"}}' });

    const modules = await dispatch(probe, client.environment, 80);

    expect(client.invalidated).toEqual(VIRTUAL_IDS);
    expect(modules?.map((m) => m.id)).toEqual(VIRTUAL_IDS);
  });

  it('invalidates when only the dynamic prop config moved', async () => {
    // The map is one of several inputs to the served module and they move
    // independently, so the comparison is over the generated module.
    const probe = makeContext(root);
    const client = makeEnvironment('client', VIRTUAL_IDS);
    // The meta must carry the manifest's real shape — the config builder
    // fails loud on entries missing varName/slotClass.
    probe.setNextSystemProps({
      dynamicProps:
        '{"width":{"varName":"--animus-width","slotClass":"animus-dyn-width","property":"width"}}',
    });

    const modules = await dispatch(probe, client.environment, 81);

    expect(probe.ctx.storedSystemPropMapJson).toBe('{}');
    expect(client.invalidated).toEqual(VIRTUAL_IDS);
    expect(modules?.map((m) => m.id)).toEqual(VIRTUAL_IDS);
  });
});

/**
 * The system-dependency branch returns before the cache write, so a file that
 * is also a discovered source keeps stale text that every reset re-analyzes.
 */
describe('hotUpdate refreshes a system dependency that is also a source', () => {
  let root: string;
  let file: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'animus-hot-update-dep-'));
    file = join(root, 'theme.ts');
    writeFileSync(file, 'export const tokens = 2;\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('refreshes the cached source before scheduling the reset', async () => {
    const probe = makeContext(root);
    probe.setSystemDependency(file);
    probe.ctx.mutateFileCache((cache) =>
      cache.set('theme.ts', {
        hash: contentHash('export const tokens = 1;\n'),
        source: 'export const tokens = 1;\n',
      })
    );
    const client = makeEnvironment('client', VIRTUAL_IDS);
    const ssr = makeEnvironment('ssr', VIRTUAL_IDS);

    for (const environment of [client.environment, ssr.environment]) {
      await runHotUpdate(probe.ctx, environment, {
        type: 'update',
        file,
        timestamp: 90,
        modules: [],
        read: async () => readFileSync(file, 'utf-8'),
      });
    }

    expect(probe.ctx.fileCache.get('theme.ts')).toEqual({
      hash: contentHash('export const tokens = 2;\n'),
      source: 'export const tokens = 2;\n',
    });
    expect(probe.resets).toEqual(['theme.ts']);
    // The refresh is a cache write, not an analysis — the reset owns that.
    expect(probe.analyses).toBe(0);
  });

  it('creates no entry for a dependency that is not a discovered source', async () => {
    const probe = makeContext(root);
    probe.setSystemDependency(file);
    const client = makeEnvironment('client', VIRTUAL_IDS);

    await runHotUpdate(probe.ctx, client.environment, {
      type: 'update',
      file,
      timestamp: 91,
      modules: [],
      read: async () => readFileSync(file, 'utf-8'),
    });

    expect([...probe.ctx.fileCache.keys()]).toEqual([]);
    expect(probe.resets).toEqual(['theme.ts']);
  });

  it('prunes the cached source on a delete event', async () => {
    // Terminal branch: an entry left behind is re-analyzed by every later
    // reset. The read returns '' — reaching it would overwrite, not prune.
    const probe = makeContext(root);
    probe.setSystemDependency(file);
    probe.ctx.mutateFileCache((cache) =>
      cache.set('theme.ts', {
        hash: 'h',
        source: 'export const tokens = 2;\n',
      })
    );
    const client = makeEnvironment('client', VIRTUAL_IDS);

    const returned = await runHotUpdate(probe.ctx, client.environment, {
      type: 'delete',
      file,
      timestamp: 92,
      modules: [],
      read: async () => '',
    });

    expect(probe.ctx.fileCache.has('theme.ts')).toBe(false);
    expect(returned).toEqual([]);
    expect(probe.resets).toEqual(['theme.ts']);
  });
});
