import { createLogger } from 'vite';
import { describe, expect, it, vi } from 'vitest';

import {
  RESOLVED_COMPONENTS_ID,
  RESOLVED_SYSTEM_PROPS_ID,
} from '../src/constants';
import {
  PluginContext,
  runExclusiveAnalysis,
  systemPropsModuleSource,
} from '../src/context';
import { makeComponent, makeManifest } from './manifest-fixture';

import type { AnimusExtractOptions } from '../src/index';
import type { AnalyzeProjectArgs } from '@animus-ui/extract/pipeline';
import type { FullReloadPayload } from 'vite';

type EmitterJsonValue =
  | null
  | boolean
  | number
  | string
  | EmitterJsonValue[]
  | EmitterJsonObject;

interface EmitterJsonObject {
  [key: string]: EmitterJsonValue | undefined;
}

function isEmitterJsonObject(
  value: EmitterJsonValue
): value is EmitterJsonObject {
  return value !== null && Object(value) === value && !Array.isArray(value);
}

/**
 * `PluginContext`'s own behavior, driven on a real instance rather than through
 * a hook. The constructor loads no engine (the NAPI handle is created lazily
 * behind `engineApi`), so the state operations here are unit-testable.
 */

describe('invalidateExtractedModules: the shared create/delete path', () => {
  /**
   * BOTH out-of-band re-analyses use this path — transform-time new-file
   * detection and the `hotUpdate` delete event (openspec:
   * hmr-new-file-detection, "Creation and deletion share this invalidation
   * path"). Neither carries a content condition: the spec names the component
   * CSS module and the system props module outright, and a client reload does
   * not rescue a module that was never invalidated (Vite keeps serving its
   * cached transform result). Asserted here rather than at either call site,
   * because a condition, if one were reintroduced, would live here.
   */
  function contextWithGraph() {
    const invalidated: string[] = [];
    const ctx = new PluginContext({ system: './ds.ts' });
    ctx.devServer = {
      moduleGraph: {
        getModuleById: (id: string) => ({ id }),
        invalidateModule: (mod: { id: string }) => invalidated.push(mod.id),
      },
      hot: { send: () => {} },
    };
    return { ctx, invalidated };
  }

  it('invalidates the component CSS and the system props module', () => {
    const { ctx, invalidated } = contextWithGraph();

    ctx.invalidateExtractedModules();

    expect(invalidated).toEqual([
      RESOLVED_COMPONENTS_ID,
      RESOLVED_SYSTEM_PROPS_ID,
    ]);
  });

  it('no-ops without a dev server', () => {
    const ctx = new PluginContext({ system: './ds.ts' });

    expect(() => ctx.invalidateExtractedModules()).not.toThrow();
  });

  it('coalesces overlapping reload timers into one full-reload', () => {
    // The delayed reload is coalescing, not correctness: N out-of-band
    // invalidations inside one burst must not stack N reloads.
    vi.useFakeTimers();
    try {
      const sends: FullReloadPayload[] = [];
      const ctx = new PluginContext({ system: './ds.ts' });
      ctx.devServer = {
        moduleGraph: {
          getModuleById: () => undefined,
          invalidateModule: () => {},
        },
        hot: { send: (payload: FullReloadPayload) => sends.push(payload) },
      };

      ctx.invalidateExtractedModules();
      ctx.invalidateExtractedModules();
      vi.advanceTimersByTime(300);

      expect(sends).toEqual([{ type: 'full-reload' }]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('info: visible without verbose', () => {
  // openspec: hmr-new-file-detection, "New file detection logging" — the
  // standard level exists so a developer sees the event without opting in.
  it('emits when verbose is off, while log() stays silent', () => {
    const lines: string[] = [];
    const ctx = new PluginContext({ system: './ds.ts' });
    const logger = createLogger('silent');
    logger.info = (message) => {
      lines.push(message);
    };
    ctx.logger = logger;

    expect(ctx.verbose).toBe(false);
    ctx.log('verbose only');
    ctx.info('always visible');

    expect(lines).toEqual(['[animus] always visible']);
  });
});

describe('runtime import selection', () => {
  function emittedRuntimeImport(options: {
    system: string;
    runtimeImport?: string;
  }): string {
    let emitterConfigJson: AnalyzeProjectArgs[8] | undefined;
    const ctx = new PluginContext(options, () => ({
      analyzeProject: (...received: AnalyzeProjectArgs) => {
        emitterConfigJson = received[8];
        return JSON.stringify(makeManifest());
      },
    }));

    expect(ctx.runAnalysis([])).toBe(true);
    if (emitterConfigJson === undefined || emitterConfigJson === null) {
      throw new Error('analyzeProject emitter config must be present');
    }
    const emitterConfig: EmitterJsonValue = JSON.parse(emitterConfigJson);
    if (
      !isEmitterJsonObject(emitterConfig) ||
      String(emitterConfig.runtime_import) !== emitterConfig.runtime_import
    ) {
      throw new Error('analyzeProject emitter runtime import must be a string');
    }
    return String(emitterConfig.runtime_import);
  }

  it('keeps the existing system barrel as the default', () => {
    expect(emittedRuntimeImport({ system: './ds.ts' })).toBe(
      '@animus-ui/system'
    );
  });

  it('emits the caller-selected resolver-only runtime', () => {
    expect(
      emittedRuntimeImport({
        system: './ds.ts',
        runtimeImport: '@animus-ui/system/class-resolver',
      })
    ).toBe('@animus-ui/system/class-resolver');
  });
});

describe('runtimeImport override guards its terminal contract', () => {
  function contextWithReplacement(
    replacement: string,
    runtimeImport?: string
  ): PluginContext {
    const options: AnimusExtractOptions = { system: './ds.ts' };
    if (runtimeImport) options.runtimeImport = runtimeImport;
    return new PluginContext(options, () => ({
      analyzeProject: () =>
        JSON.stringify(
          makeManifest({
            components: {
              badge: makeComponent('src/definition.ts', replacement),
            },
          })
        ),
    }));
  }

  it('throws in every mode when an override coexists with a non-.asClass() terminal', () => {
    const ctx = contextWithReplacement(
      "createComponent('div', {...})",
      '@animus-ui/system/class-resolver'
    );
    expect(() => ctx.runAnalysis([])).toThrow(
      /runtimeImport '@animus-ui\/system\/class-resolver' is valid only when every extracted terminal is \.asClass\(\).*badge/s
    );
  });

  it('accepts an override when every replacement is a class resolver', () => {
    const ctx = contextWithReplacement(
      "createClassResolver(['a'])",
      '@animus-ui/system/class-resolver'
    );
    expect(ctx.runAnalysis([])).toBe(true);
  });

  it('never fires for the default runtime', () => {
    const ctx = contextWithReplacement("createComponent('div', {...})");
    expect(ctx.runAnalysis([])).toBe(true);
  });
});

describe('systemPropsModuleSource: keyed on the inputs it generates from', () => {
  /**
   * The served module is a pure function of four context inputs, all already
   * strings. Invalidation belongs to the READER: a memo the writers have to
   * remember to refresh is a standing obligation, and the one writer that
   * forgets serves a module from a generation that no longer exists — the
   * `??=` store-on-generate then makes that staleness permanent and invisible.
   */
  it('serves a hand-moved input without any writer refreshing a memo', () => {
    const ctx = new PluginContext({ system: './ds.ts' });

    const before = systemPropsModuleSource(ctx);
    ctx.storedSystemPropMapJson = JSON.stringify({ color: 'colors' });

    expect(before).toContain('export const systemPropMap = {};');
    expect(systemPropsModuleSource(ctx)).toContain(
      'export const systemPropMap = {"color":"colors"};'
    );
  });

  it('tracks the group registry the loaded system carries', () => {
    // `system` is replaced wholesale by `loadSystem`, so the registry moves
    // without any per-field write the memo could hang a refresh on.
    const ctx = new PluginContext({ system: './ds.ts' });

    systemPropsModuleSource(ctx);
    ctx.system = { ...ctx.system, groupRegistryJson: '{"space":["p","m"]}' };

    expect(systemPropsModuleSource(ctx)).toContain(
      'export const systemPropGroups = {"space":["p","m"]};'
    );
  });

  it('serves identical bytes while the inputs stand still', () => {
    const ctx = new PluginContext({ system: './ds.ts' });

    expect(systemPropsModuleSource(ctx)).toBe(systemPropsModuleSource(ctx));
  });
});

describe('runExclusive: the analysis-transaction lock', () => {
  it('serializes queued transactions and a rejection never poisons the chain', async () => {
    const ctx = new PluginContext({ system: 'src/ds.ts' });
    const order: string[] = [];

    const first = runExclusiveAnalysis(ctx, async () => {
      order.push('a-start');
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push('a-end');
      return 'a';
    });
    const second = runExclusiveAnalysis(ctx, async () => {
      order.push('b');
      throw new Error('planned transaction failure');
    });
    const third = runExclusiveAnalysis(ctx, async () => {
      order.push('c');
      return 42;
    });

    await expect(first).resolves.toBe('a');
    await expect(second).rejects.toThrow('planned transaction failure');
    await expect(third).resolves.toBe(42);
    // No interleaving: each transaction starts only after the previous one
    // settled, and the rejected one did not block the next.
    expect(order).toEqual(['a-start', 'a-end', 'b', 'c']);
  });
});
