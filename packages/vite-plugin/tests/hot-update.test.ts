import { contentHash } from '@animus-ui/extract/pipeline';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  RESOLVED_COMPONENTS_ID,
  RESOLVED_SYSTEM_PROPS_ID,
} from '../src/constants';
import { handleHotUpdate } from '../src/hmr';
import { HotUpdateEvents } from '../src/hot-update-events';

import type { PluginContext } from '../src/context';
import type { DevEnvironment, EnvironmentModuleNode } from 'vite';

/**
 * Vite dispatches `hotUpdate` once per environment for a single file event —
 * client first, then every non-client environment (measured against the
 * installed vite 8.1.4: one client and one ssr call per event, sharing the
 * event timestamp). The plugin's analysis work must run exactly once across
 * those dispatches while module invalidation runs in each environment's own
 * graph, so both dispatches are driven here in Vite's order.
 */

interface ContextProbe {
  ctx: PluginContext;
  analyses: number;
  resets: string[];
  extractedInvalidations: number;
  /**
   * What the next analysis publishes into the system-props module's inputs.
   * An omitted field is left untouched, i.e. republished identically.
   */
  setNextSystemProps(next: { map?: string; dynamicProps?: string }): void;
}

function makeContext(rootDir: string): ContextProbe {
  const probe = {
    analyses: 0,
    resets: [] as string[],
    extractedInvalidations: 0,
    next: {} as { map?: string; dynamicProps?: string },
  };
  const ctx = {
    isProd: false,
    verbose: false,
    rootDir,
    options: {},
    extensionsSet: new Set(['.ts', '.tsx', '.js', '.jsx']),
    externalPackageDirs: [] as string[],
    fileCache: new Map<string, { hash: string; source: string }>(),
    reverseProvenance: {},
    storedManifest: { components: {}, files: {} },
    // The four inputs `virtual:animus/system-props` is generated from. The
    // engine republishes them on every analysis whether or not they moved.
    storedSystemPropMapJson: '{}',
    storedDynamicPropsJson: '{}',
    storedTransformsSource: '{}',
    system: { groupRegistryJson: '{}' },
    hotUpdateEvents: new HotUpdateEvents(),
    systemDependency: '',
    isSystemDependency(absFile: string) {
      return absFile === this.systemDependency;
    },
    requestGeologicalReset(trigger: string) {
      probe.resets.push(trigger);
    },
    runAnalysis() {
      probe.analyses++;
      if (probe.next.map !== undefined) {
        ctx.storedSystemPropMapJson = probe.next.map;
      }
      if (probe.next.dynamicProps !== undefined) {
        ctx.storedDynamicPropsJson = probe.next.dynamicProps;
      }
    },
    invalidateExtractedModules() {
      probe.extractedInvalidations++;
    },
    log() {},
    info() {},
    warn() {},
    logTimingWaterfall() {},
  };
  return {
    ctx: ctx as unknown as PluginContext,
    get analyses() {
      return probe.analyses;
    },
    get resets() {
      return probe.resets;
    },
    get extractedInvalidations() {
      return probe.extractedInvalidations;
    },
    setNextSystemProps(next: { map?: string; dynamicProps?: string }) {
      probe.next = next;
    },
  };
}

function makeEnvironment(name: string, moduleIds: string[]) {
  const invalidated: string[] = [];
  const modules = new Map<string, EnvironmentModuleNode>(
    moduleIds.map((id) => [
      id,
      { id, url: id, environment: name } as EnvironmentModuleNode,
    ])
  );
  const environment = {
    name,
    moduleGraph: {
      getModuleById: (id: string) => modules.get(id),
      getModulesByFile: () => undefined,
      invalidateModule: (mod: EnvironmentModuleNode) =>
        invalidated.push(mod.id ?? ''),
    },
  };
  return { environment: environment as unknown as DevEnvironment, invalidated };
}

const VIRTUAL_IDS = [RESOLVED_COMPONENTS_ID, RESOLVED_SYSTEM_PROPS_ID];

describe('hotUpdate across environment dispatches', () => {
  let root: string;
  let file: string;
  /** What Vite's own `read()` helper would hand the hook for `file`. */
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

    const clientModules = await handleHotUpdate(probe.ctx, client.environment, {
      ...event,
      modules: [],
      read: readFile,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const ssrModules = await handleHotUpdate(probe.ctx, ssr.environment, {
      ...event,
      modules: [],
      read: readFile,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    // The analysis half ran for the client dispatch only.
    expect(probe.analyses).toBe(1);
    expect(probe.ctx.fileCache.size).toBe(1);
    // The invalidation half ran in both environments, against their own graph.
    expect(client.invalidated).toEqual(VIRTUAL_IDS);
    expect(ssr.invalidated).toEqual(VIRTUAL_IDS);
    expect(clientModules?.map((m) => m.id)).toEqual(VIRTUAL_IDS);
    expect(ssrModules?.map((m) => m.id)).toEqual(VIRTUAL_IDS);
  });

  it('suppresses the update in every environment when content is unchanged', async () => {
    const probe = makeContext(root);
    const client = makeEnvironment('client', VIRTUAL_IDS);
    const ssr = makeEnvironment('ssr', VIRTUAL_IDS);
    const dispatch = (environment: DevEnvironment, timestamp: number) =>
      handleHotUpdate(probe.ctx, environment, {
        type: 'update',
        file,
        timestamp,
        modules: [],
        read: readFile,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

    await dispatch(client.environment, 10);
    await dispatch(ssr.environment, 10);
    // A save that did not change the bytes: same hash, no re-analysis.
    const clientModules = await dispatch(client.environment, 20);
    const ssrModules = await dispatch(ssr.environment, 20);

    expect(probe.analyses).toBe(1);
    expect(clientModules).toEqual([]);
    expect(ssrModules).toEqual([]);
  });

  it('schedules one geological reset per system-dependency event', async () => {
    const probe = makeContext(root);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (probe.ctx as any).systemDependency = file;
    const client = makeEnvironment('client', VIRTUAL_IDS);
    const ssr = makeEnvironment('ssr', VIRTUAL_IDS);

    const types = ['update', 'create', 'delete'] as const;
    for (const [index, type] of types.entries()) {
      const timestamp = 30 + index;
      for (const environment of [client.environment, ssr.environment]) {
        const returned = await handleHotUpdate(probe.ctx, environment, {
          type,
          file,
          timestamp,
          modules: [],
          read: readFile,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        // The reset owns the delivery; no environment gets its own update.
        expect(returned).toEqual([]);
      }
    }

    // Membership is tested first for all three event types, and each event
    // schedules exactly one reset.
    expect(probe.resets).toEqual(['Button.tsx', 'Button.tsx', 'Button.tsx']);
    expect(probe.analyses).toBe(0);
    expect(client.invalidated).toEqual([]);
  });

  it('leaves a created file to transform-time detection', async () => {
    const probe = makeContext(root);
    const client = makeEnvironment('client', VIRTUAL_IDS);

    const returned = await handleHotUpdate(probe.ctx, client.environment, {
      type: 'create',
      file,
      timestamp: 40,
      modules: [],
      read: async () => '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(returned).toBeUndefined();
    expect(probe.analyses).toBe(0);
    expect(probe.ctx.fileCache.size).toBe(0);
  });

  it('prunes a deleted file once across environments', async () => {
    const probe = makeContext(root);
    probe.ctx.fileCache.set('Button.tsx', { hash: 'h', source: 'src' });
    const client = makeEnvironment('client', VIRTUAL_IDS);
    const ssr = makeEnvironment('ssr', VIRTUAL_IDS);

    for (const environment of [client.environment, ssr.environment]) {
      const returned = await handleHotUpdate(probe.ctx, environment, {
        type: 'delete',
        file,
        timestamp: 50,
        modules: [],
        read: readFile,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      expect(returned).toBeUndefined();
    }

    expect(probe.ctx.fileCache.size).toBe(0);
    expect(probe.analyses).toBe(1);
    expect(probe.extractedInvalidations).toBe(1);
  });
});

/**
 * Editors save atomically: the file is truncated and rewritten, so a watcher
 * event can arrive while the path is momentarily EMPTY. Vite hands the hook a
 * `read()` helper that retries on empty content for exactly this reason; a raw
 * `readFileSync` at the same moment sees `''`, hashes it, and writes that into
 * `fileCache` — permanently, because the corrective content produces no second
 * event. Every later analysis then rebuilds from a blank source and the file's
 * components are gone from the manifest for the life of the process.
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

    await handleHotUpdate(probe.ctx, client.environment, {
      type: 'update',
      file,
      timestamp: 60,
      modules: [],
      read: async () => settled,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

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

    await handleHotUpdate(probe.ctx, client.environment, {
      type: 'update',
      file,
      timestamp: 61,
      modules: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(probe.ctx.fileCache.get('Button.tsx')?.source).toBe(onDisk);
  });
});

/**
 * The shared system prop map is only re-delivered when its CONTENT moved
 * (openspec: vite-extraction-plugin, "System prop map HMR invalidation";
 * shared-system-prop-map, "HMR invalidation of shared map"). A style-only edit
 * that introduces no new system-prop usage must not push an update to every
 * module that imports the map.
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
    environment: DevEnvironment,
    timestamp: number
  ) =>
    handleHotUpdate(probe.ctx, environment, {
      type: 'update',
      file,
      timestamp,
      modules: [],
      read: readFile,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

  it('leaves the map module alone when the analysis republished it unchanged', async () => {
    const probe = makeContext(root);
    probe.setNextSystemProps({ map: '{"p":{"8":"animus-u-abc"}}' });
    // Seed the map, then edit again without moving it.
    const client = makeEnvironment('client', VIRTUAL_IDS);
    const ssr = makeEnvironment('ssr', VIRTUAL_IDS);
    await dispatch(probe, client.environment, 70);
    await dispatch(probe, ssr.environment, 70);
    // Baseline: whatever the seeding edit invalidated is not this test's
    // subject, so only what the SECOND edit adds is asserted.
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
    // The map is ONE of four inputs to the served module. Widening a
    // component's `.system({ ... })` opt-in adds a dynamic slot without
    // minting any new utility class, so the map stays byte-identical while
    // `dynamicPropConfig` gains an entry. Keying the decision on the map alone
    // leaves the client running a config that is missing the new prop — and no
    // later event repairs it, because Vite keeps serving the module's cached
    // transform result across full page reloads.
    const probe = makeContext(root);
    const client = makeEnvironment('client', VIRTUAL_IDS);
    probe.setNextSystemProps({
      dynamicProps: '{"width":{"property":"width"}}',
    });

    const modules = await dispatch(probe, client.environment, 81);

    expect(probe.ctx.storedSystemPropMapJson).toBe('{}');
    expect(client.invalidated).toEqual(VIRTUAL_IDS);
    expect(modules?.map((m) => m.id)).toEqual(VIRTUAL_IDS);
  });
});

/**
 * A file can be BOTH a system dependency and a discovered component source
 * (a theme module that also exports components). The dependency branch returns
 * before the cache write, so without an explicit refresh that file's pre-edit
 * text survives in `fileCache` for the life of the process — and the geological
 * reset rebuilds its full-source analysis from that same cache, so every reset
 * re-analyzes the stale text.
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (probe.ctx as any).systemDependency = file;
    probe.ctx.fileCache.set('theme.ts', {
      hash: contentHash('export const tokens = 1;\n'),
      source: 'export const tokens = 1;\n',
    });
    const client = makeEnvironment('client', VIRTUAL_IDS);
    const ssr = makeEnvironment('ssr', VIRTUAL_IDS);

    for (const environment of [client.environment, ssr.environment]) {
      await handleHotUpdate(probe.ctx, environment, {
        type: 'update',
        file,
        timestamp: 90,
        modules: [],
        read: async () => readFileSync(file, 'utf-8'),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (probe.ctx as any).systemDependency = file;
    const client = makeEnvironment('client', VIRTUAL_IDS);

    await handleHotUpdate(probe.ctx, client.environment, {
      type: 'update',
      file,
      timestamp: 91,
      modules: [],
      read: async () => readFileSync(file, 'utf-8'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect([...probe.ctx.fileCache.keys()]).toEqual([]);
    expect(probe.resets).toEqual(['theme.ts']);
  });

  it('prunes the cached source on a delete event', async () => {
    // Deletion pruning applies here too (openspec: hmr-new-file-detection,
    // "Watcher deletion pruning"): this branch is terminal, so an entry left
    // behind is a ghost source that every later reset re-analyzes and that no
    // watcher event can ever name again.
    //
    // The `read` helper below SUCCEEDS and returns empty content — the witness
    // that the delete is decided on the event type. If the read were reached,
    // the entry would be overwritten with `''` rather than removed, and the
    // assertion would fail on the entry still existing.
    const probe = makeContext(root);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (probe.ctx as any).systemDependency = file;
    probe.ctx.fileCache.set('theme.ts', {
      hash: 'h',
      source: 'export const tokens = 2;\n',
    });
    const client = makeEnvironment('client', VIRTUAL_IDS);

    const returned = await handleHotUpdate(probe.ctx, client.environment, {
      type: 'delete',
      file,
      timestamp: 92,
      modules: [],
      read: async () => '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(probe.ctx.fileCache.has('theme.ts')).toBe(false);
    expect(returned).toEqual([]);
    expect(probe.resets).toEqual(['theme.ts']);
  });
});
