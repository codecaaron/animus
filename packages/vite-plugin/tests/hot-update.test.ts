import { mkdtempSync, rmSync, writeFileSync } from 'fs';
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
}

function makeContext(rootDir: string): ContextProbe {
  const probe = {
    analyses: 0,
    resets: [] as string[],
    extractedInvalidations: 0,
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
    },
    invalidateExtractedModules() {
      probe.extractedInvalidations++;
    },
    log() {},
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

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'animus-hot-update-'));
    file = join(root, 'Button.tsx');
    writeFileSync(file, 'export const Button = 1;\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('analyzes an update once and invalidates in every environment', async () => {
    const probe = makeContext(root);
    const client = makeEnvironment('client', VIRTUAL_IDS);
    const ssr = makeEnvironment('ssr', VIRTUAL_IDS);
    const event = { type: 'update' as const, file, timestamp: 10 };

    const clientModules = await handleHotUpdate(probe.ctx, client.environment, {
      ...event,
      modules: [],
      read: async () => '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const ssrModules = await handleHotUpdate(probe.ctx, ssr.environment, {
      ...event,
      modules: [],
      read: async () => '',
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
        read: async () => '',
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
          read: async () => '',
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
        read: async () => '',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      expect(returned).toBeUndefined();
    }

    expect(probe.ctx.fileCache.size).toBe(0);
    expect(probe.analyses).toBe(1);
    expect(probe.extractedInvalidations).toBe(1);
  });
});
