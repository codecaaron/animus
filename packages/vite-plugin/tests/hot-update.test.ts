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

import type { ContextProbe } from './context-probe';
import type { DevEnvironment, HotUpdateOptions } from 'vite';

/**
 * Vite dispatches `hotUpdate` once per environment for a single file event —
 * client first, then every non-client environment (measured against the
 * installed vite 8.1.4: one client and one ssr call per event, sharing the
 * event timestamp). The plugin's analysis work must run exactly once across
 * those dispatches while module invalidation runs in each environment's own
 * graph, so both dispatches are driven here in Vite's order.
 */

interface HotUpdateProbe extends ContextProbe {
  resets: string[];
  /**
   * What the next analysis publishes into the system-props module's inputs.
   * An omitted field is left untouched, i.e. republished identically.
   */
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
    requestGeologicalReset(trigger: string) {
      resets.push(trigger);
    },
  });
  base.ctx.runAnalysis = () => {
    base.analyses++;
    if (nextMap !== undefined) base.ctx.storedSystemPropMapJson = nextMap;
    if (nextDynamicProps !== undefined) {
      base.ctx.storedDynamicPropsJson = nextDynamicProps;
    }
    // Publishing the inputs is the whole writer contract: the served module
    // is keyed on them by its reader, so nothing here refreshes a memo.
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
    // SAFETY: The fixture models every DevEnvironment field read by handleHotUpdate: name, moduleGraph, and transformRequest.
    environment as DevEnvironment,
    // SAFETY: The fixture provides every option read by handleHotUpdate; server is unused, and read is optional for its documented non-Vite host path.
    options as HotUpdateOptions
  );
}

/** Named-environment wrapper over the shared graph double — the graph body
 *  is `makeEnvGraph`; this only names the environment for the dispatcher. */
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

    // The analysis half ran for the client dispatch only.
    expect(probe.analyses).toBe(1);
    expect(probe.ctx.fileCache.size).toBe(1);
    // The invalidation half ran in both environments, against their own graph.
    expect(client.invalidated).toEqual(VIRTUAL_IDS);
    expect(ssr.invalidated).toEqual(VIRTUAL_IDS);
    expect(clientModules?.map((m) => m.id)).toEqual(VIRTUAL_IDS);
    expect(ssrModules?.map((m) => m.id)).toEqual(VIRTUAL_IDS);
  });

  it('invalidates conservatively when the burst evicted the decision', async () => {
    // Vite does not serialize watcher handlers, so a mass edit (git checkout,
    // format-on-save-all) puts many events in flight between one event's
    // client dispatch and its ssr dispatch. Past the bounded history the ssr
    // dispatch can no longer read the owner's decision — and the one thing it
    // must not do is skip invalidation: its graph would keep the pre-edit
    // component CSS and system-props module while the client has the new
    // ones, which renders as a hydration mismatch.
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
    // Seventeen other files change while the ssr dispatch is still queued —
    // every one of them claims its own event first, exactly as a dispatch
    // does, and the oldest key falls out of the 16-entry window.
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

    // No second analysis: the owner already ran it, and the file's content
    // has not moved since.
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
    // A save that did not change the bytes: same hash, no re-analysis.
    const clientModules = await dispatch(client.environment, 20);
    const ssrModules = await dispatch(ssr.environment, 20);

    expect(probe.analyses).toBe(1);
    expect(clientModules).toEqual([]);
    expect(ssrModules).toEqual([]);
  });

  it('schedules one geological reset per system-dependency event', async () => {
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

    // Membership is tested first for all three event types, and each event
    // schedules exactly one reset.
    expect(probe.resets).toEqual(['Button.tsx', 'Button.tsx', 'Button.tsx']);
    expect(probe.analyses).toBe(0);
    expect(client.invalidated).toEqual([]);
  });

  it('ingests a created file like an edit', async () => {
    // openspec: hmr-new-file-detection, "Watcher creation ingestion" — a
    // created eligible source feeds the same analysis path as an edit, so
    // the graph is usually complete before any consumer refetches.
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
    // Cross-source token diagnostics correlate through
    // `externalFileOwners[diagnostic.file]`; a watcher-created external file
    // must be owned BEFORE its first analysis — it enters the cache here, so
    // the transform-time registration block never runs for it.
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
    // The backstop (or rediscovery's fold) registered the file first; the
    // late watcher event must coalesce into a no-op instead of buying a
    // second analysis — but it must return undefined, NOT []. Vite 8 treats
    // a returned [] as an explicit empty module list (truthy gate) and would
    // drop the resolve-failed importers it seeds on create, cancelling the
    // full-reload that clears the "Failed to resolve import" overlay.
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

/** A fake environment graph holding one node for `absPath`. */
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

/**
 * Plan-changed consumers are re-delivered by every analysis path — the delete
 * half here (openspec: hmr-new-file-detection, "Consumers of a deleted parent
 * are invalidated"; dev-transform-coherence, "Definition-module invalidation
 * tracks the published analysis").
 */
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
    ctx.storedManifest = {
      components: {
        'Fancy.tsx::Fancy': {
          file: 'Fancy.tsx',
          replacement: "createComponent('div', 'a')",
        },
      },
      files: { 'Fancy.tsx': ['Fancy.tsx::Fancy'] },
    };
    ctx.runAnalysis = () => {
      probe.analyses++;
      ctx.storedManifest = { components: {}, files: {} };
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
 * ANI-035's exact ordering: an imported extension parent exists on disk
 * (created mid-session; its create event was lost), and a consumer edit
 * analyzes to `chain dropped: could not resolve parent component`. The
 * source universe is reconciled BEFORE that result is acted on (openspec:
 * dev-transform-coherence, "Source-universe reconciliation precedes
 * unresolved-parent fallbacks") — the consumer's first re-serve is
 * extracted, never the runtime fallback.
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
        // The parent is not in the analyzed universe yet: chains drop.
        ctx.storedManifest = {
          components: {},
          files: {},
          diagnostics: [
            {
              file: 'Consumer.tsx',
              component: 'Fancy',
              kind: 'bail',
              message:
                "chain dropped: could not resolve parent component 'Parent'",
            },
          ],
        };
      } else {
        // The fold made the parent visible: the whole graph resolves.
        ctx.storedManifest = {
          components: {
            'Parent.tsx::Parent': { file: 'Parent.tsx', replacement: 'rp' },
            'Consumer.tsx::Fancy': { file: 'Consumer.tsx', replacement: 'rf' },
          },
          files: {
            'Parent.tsx': ['Parent.tsx::Parent'],
            'Consumer.tsx': ['Consumer.tsx::Fancy'],
          },
          diagnostics: [],
        };
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

    // One reconciliation pass: drop → fold Parent.tsx → one re-analysis.
    expect(probe.analyses).toBe(2);
    expect(probe.ctx.fileCache.has('Parent.tsx')).toBe(true);
    // The update publishes normally (no suppression, no fallback path).
    expect(returned?.map((m) => m.id)).toContain(RESOLVED_COMPONENTS_ID);
  });
});

/**
 * A failed analysis must not record its content as successfully analyzed —
 * otherwise the hash gate suppresses the same-content retry and the session
 * never recovers (openspec: dev-transform-coherence, "Failed analyses do not
 * suppress equal-content retries").
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

    // The failed attempt rolled the entry back to the pre-edit content.
    expect(first).toBeUndefined();
    expect(probe.ctx.fileCache.get('Button.tsx')).toEqual({
      hash: contentHash(old),
      source: old,
    });

    await dispatch(61);

    // Same bytes again — analysis retries instead of 'unchanged' suppression.
    expect(probe.analyses).toBe(2);
  });

  /**
   * The FIRST analysis publishes, then source-universe stabilization
   * re-analyzes — and `runAnalysis` throws in every mode on error
   * diagnostics, since that escalation sits outside its non-strict catch.
   * That throw escaped past the rollback, leaving the cache advanced to the
   * offending content, so re-saving the corrected file byte-identically hit
   * the unchanged-hash gate and never re-analyzed.
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
        // Publishes, but leaves an unresolved-parent drop for stabilize.
        ctx.storedManifest = {
          components: {},
          files: {},
          diagnostics: [
            {
              file: 'Button.tsx',
              component: 'Fancy',
              kind: 'bail',
              message:
                "chain dropped: could not resolve parent component 'Parent'",
            },
          ],
        };
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
    // Rolled back to the pre-edit content, so a same-content re-save retries.
    expect(probe.ctx.fileCache.get('Button.tsx')).toEqual({
      hash: contentHash(old),
      source: old,
    });
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
    // The map is ONE of four inputs to the served module, and they move
    // independently — see the system-props compare in src/hmr.ts
    // `analyzeChangedFile` for why the comparison is over the generated
    // module, not the map.
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
