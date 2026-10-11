import { findSession } from '@animus-ui/extract/session';
import { join, resolve } from 'path';
import { createLogger, resolveConfig } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createKitWorkspace,
  disposeTempRoots,
  engineHandleCount,
  KIT_SYSTEM_SOURCE,
  makeTempRoot,
  resetAnimusGlobals,
} from '../../extract/tests/session/session-fixtures';
import {
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
import { PluginContext, systemPropsModuleSource } from '../src/context';
import { animusExtract } from '../src/index';
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

afterEach(() => {
  disposeTempRoots();
});

/** A Vite build of a kit workspace whose analysis returns `manifest`: the
 *  emitter config its analysis received. */
/** An injected engine over a kit workspace's system, whose analysis
 *  returns `manifest` and reports the arguments it received. */
function kitWorkspaceEngine(
  app: string,
  manifest: ReturnType<typeof makeManifest>,
  onAnalyze: (received: AnalyzeProjectArgs) => void = () => {}
) {
  return () => ({
    loadSystemModule: () => ({
      propConfig: '{}',
      groupRegistry: '{}',
      scalesJson: '{}',
      variableMapJson: '{}',
      variableCss: '',
      dependencies: [],
    }),
    extractFacts: factsExtractor({
      [join(app, 'src', 'system.ts')]: {
        ...emptyFacts(join(app, 'src', 'system.ts')),
        imports: systemImportFacts(KIT_SYSTEM_SOURCE),
      },
    }),
    analyzeProject: (...received: AnalyzeProjectArgs) => {
      onAnalyze(received);
      return JSON.stringify(manifest);
    },
  });
}

async function buildWith(
  options: Pick<AnimusExtractOptions, 'runtimeImport'>,
  manifest = makeManifest()
): Promise<EmitterJsonObject> {
  const { app } = createKitWorkspace();
  let emitterConfigJson: AnalyzeProjectArgs[8] | undefined;
  const ctx = new PluginContext(
    { system: './src/system.ts', ...options },
    kitWorkspaceEngine(app, manifest, (received) => {
      emitterConfigJson = received[8];
    })
  );
  applyResolvedConfig(
    ctx,
    await resolveConfig(
      { configFile: false, root: app, logLevel: 'silent' },
      'build'
    )
  );
  try {
    await runBuildStart(ctx, async (specifier) =>
      resolve(app, 'src', specifier)
    );
  } finally {
    ctx.session?.close();
  }
  if (emitterConfigJson === undefined || emitterConfigJson === null) {
    throw new Error('analyzeProject emitter config must be present');
  }
  const emitterConfig: EmitterJsonValue = JSON.parse(emitterConfigJson);
  if (!isEmitterJsonObject(emitterConfig)) {
    throw new Error('analyzeProject emitter config must be an object');
  }
  return emitterConfig;
}

describe('invalidateExtractedModules: the shared create/delete path', () => {
  /** Invalidation carries no content condition: Vite keeps serving the
   *  cached transform result, so a reload never rescues a live module. */
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

describe('trace: the tier above verbose', () => {
  function capture(verbose: boolean | 'trace'): string[] {
    const lines: string[] = [];
    const ctx = new PluginContext({ system: './ds.ts', verbose });
    const logger = createLogger('silent');
    logger.info = (message) => {
      lines.push(message);
    };
    ctx.logger = logger;
    ctx.log('summary');
    ctx.trace('per item');
    return lines;
  }

  it('verbose prints summaries but not per-item lines', () => {
    expect(capture(true)).toEqual(['[animus] summary']);
  });

  it("'trace' prints both", () => {
    expect(capture('trace')).toEqual(['[animus] summary', '[animus] per item']);
  });
});

describe('runtime import selection', () => {
  async function emittedRuntimeImport(runtimeImport?: string): Promise<string> {
    const emitterConfig = await buildWith(
      runtimeImport === undefined ? {} : { runtimeImport }
    );
    if (String(emitterConfig.runtime_import) !== emitterConfig.runtime_import) {
      throw new Error('analyzeProject emitter runtime import must be a string');
    }
    return String(emitterConfig.runtime_import);
  }

  it('emits the shared /runtime entry by default, as every adapter does', async () => {
    expect(await emittedRuntimeImport()).toBe('@animus-ui/system/runtime');
  });

  it('keeps the system barrel when the caller selects it', async () => {
    expect(await emittedRuntimeImport('@animus-ui/system')).toBe(
      '@animus-ui/system'
    );
  });

  it('emits the caller-selected resolver-only runtime', async () => {
    expect(await emittedRuntimeImport('@animus-ui/system/class-resolver')).toBe(
      '@animus-ui/system/class-resolver'
    );
  });
});

describe('runtimeImport override guards its terminal contract', () => {
  function withReplacement(replacement: string) {
    return makeManifest({
      components: {
        badge: makeComponent('src/definition.ts', replacement),
      },
    });
  }

  it('accepts an override when every replacement is a class resolver', async () => {
    await expect(
      buildWith(
        { runtimeImport: '@animus-ui/system/class-resolver' },
        withReplacement("createClassResolver(['a'])")
      )
    ).resolves.toBeDefined();
  });

  it('never fires for the default runtime', async () => {
    await expect(
      buildWith({}, withReplacement("createComponent('div', {...})"))
    ).resolves.toBeDefined();
  });

  it('never fires for either full runtime, /runtime or the system barrel', async () => {
    for (const runtimeImport of [
      '@animus-ui/system/runtime',
      '@animus-ui/system',
    ]) {
      await expect(
        buildWith(
          { runtimeImport },
          withReplacement("createComponent('div', {...})")
        )
      ).resolves.toBeDefined();
    }
  });
});

describe('systemPropsModuleSource: keyed on the inputs it generates from', () => {
  /** The served module regenerates from its context inputs on every call: a
   *  memo a writer forgets to refresh serves a dead generation forever. */
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
    // Adoption replaces `system` wholesale, so the registry moves with no
    // per-field write a refresh could hang on.
    const ctx = new PluginContext({ system: './ds.ts' });

    systemPropsModuleSource(ctx);
    ctx.system = { ...ctx.system, groupRegistryJson: '{"space":["p","m"]}' };

    expect(systemPropsModuleSource(ctx)).toContain(
      'export const systemPropGroups = {"space":["p","m"]};'
    );
  });

  it('tracks the transforms the latest analysis admitted', () => {
    const ctx = new PluginContext({ system: './ds.ts' });

    ctx.storedAdmittedTransformsJson = '{"fraction":"(v) => v * 2"}';
    const first = systemPropsModuleSource(ctx);
    ctx.storedAdmittedTransformsJson = '{"fraction":"(v) => v * 3"}';

    expect(first).toContain('"fraction": ((v) => v * 2)');
    expect(systemPropsModuleSource(ctx)).toContain(
      '"fraction": ((v) => v * 3)'
    );
  });

  it('delivers no configured source analysis has not admitted', () => {
    const ctx = new PluginContext({ system: './ds.ts' });

    ctx.system = {
      ...ctx.system,
      transformSourcesJson: '{"fraction":"(v) => v * 2"}',
    };

    expect(systemPropsModuleSource(ctx)).toContain(
      'export const transforms = {};'
    );
  });

  it('serves identical bytes while the inputs stand still', () => {
    const ctx = new PluginContext({ system: './ds.ts' });

    expect(systemPropsModuleSource(ctx)).toBe(systemPropsModuleSource(ctx));
  });
});

describe('engine handle lifetime', () => {
  let restoreGlobals: (() => void) | null = null;
  afterEach(() => {
    restoreGlobals?.();
    restoreGlobals = null;
  });

  /** Contract: a Vite context's engine handle lives as long as the context
   *  (SA18). None is registered before the root resolves, and contexts
   *  created and closed leave none behind. */
  it('contexts created and closed leave no engine handle', () => {
    restoreGlobals = resetAnimusGlobals();
    const root = makeTempRoot('animus-vite-engine-');

    // The config hook's kit lookup runs before the root resolves.
    const config = animusExtract({ system: './ds.ts' }).config;
    if (config === undefined || 'handler' in config) {
      throw new Error('animusExtract declares its config hook as a method');
    }
    config.call(
      // SAFETY: the hook reads only `root` from the user config and the
      // command from the env; Vite's plugin context is unused.
      {} as ThisParameterType<typeof config>,
      { root },
      { command: 'serve', mode: 'development' }
    );
    expect(engineHandleCount()).toBe(0);

    const contexts = [0, 1, 2].map(() => {
      const ctx = new PluginContext({ system: './ds.ts' });
      ctx.rootDir = root;
      ctx.engineApi();
      return ctx;
    });
    expect(engineHandleCount()).toBe(3);
    for (const ctx of contexts) ctx.releaseEngine();
    expect(engineHandleCount()).toBe(0);
  });

  /** Contract: Vite closing a context retires its build: the Session leaves
   *  the registry, injected engine included (no engine handle to release).
   *  A Session a re-resolved config superseded (once per environment) leaves
   *  at once, and a closed context's next build start joins again. */
  it('a closed context leaves no Session registry entry, and its next build rejoins', async () => {
    restoreGlobals = resetAnimusGlobals();
    const { app } = createKitWorkspace();
    const ctx = new PluginContext(
      { system: './src/system.ts' },
      kitWorkspaceEngine(app, makeManifest())
    );
    const config = await resolveConfig(
      { configFile: false, root: app, logLevel: 'silent' },
      'build'
    );
    const start = () =>
      runBuildStart(ctx, async (specifier) => resolve(app, 'src', specifier));

    // A client and an SSR environment, each resolving the config.
    applyResolvedConfig(ctx, config);
    await start();
    const key = ctx.session!.key;
    applyResolvedConfig(ctx, config);
    await start();
    ctx.close();
    expect(findSession(key)).toBeUndefined();

    // One plugin shared by both environments: the second build start rejoins.
    await start();
    expect(findSession(key)).toBeDefined();
    expect(ctx.storedManifest).not.toBeNull();
    ctx.close();
    expect(findSession(key)).toBeUndefined();
  });
});
