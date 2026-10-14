import {
  ANIMUS_LAYERS,
  ENGINE_TRANSFORM_EXTENSIONS,
} from '@animus-ui/extract/pipeline';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  sessionArtifactDir,
  stylesPath,
} from '../../extract/session/session-paths';
import { resetAnimusGlobals } from '../../extract/tests/session/session-fixtures';
import { real } from '../../layergate/src/host';
import { registry } from '../../layergate/src/webpack-state';
import { AnimusWebpackPlugin } from '../src/plugin';
import { QUARANTINE_TURBOPACK_MESSAGE } from '../src/quarantine';
import { withAnimus } from '../src/with-animus';

import type { AnimusNextOptions } from '../src/types';

const temporaryRoots: string[] = [];
let restoreGlobals: () => void;

beforeEach(() => {
  restoreGlobals = resetAnimusGlobals();
});

afterEach(() => {
  restoreGlobals();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function injectedAnimusPlugin<Entry>(
  entries: readonly Entry[] | undefined
): Entry & AnimusWebpackPlugin {
  const plugin = entries?.find(
    (entry): entry is Entry & AnimusWebpackPlugin =>
      entry instanceof AnimusWebpackPlugin
  );
  if (plugin === undefined) {
    throw new Error('expected the webpack hook to inject AnimusWebpackPlugin');
  }
  return plugin;
}

function optionsWithoutSystem(): AnimusNextOptions {
  const options: AnimusNextOptions = { system: './src/ds.ts' };
  Reflect.deleteProperty(options, 'system');
  return options;
}

describe('withAnimus', () => {
  test('reports a missing system with curried usage guidance', () => {
    expect(() => withAnimus(optionsWithoutSystem())).toThrow(
      '[animus-extract] Missing required option `system`. ' +
        'Provide the path to your SystemInstance module: ' +
        'withAnimus({ system: "./src/ds.ts" })'
    );
  });

  test('adds Animus configuration after the consumer webpack hook', () => {
    const root = mkdtempSync(join(tmpdir(), 'animus-next-composition-'));
    temporaryRoots.push(root);
    vi.spyOn(process, 'cwd').mockReturnValue(root);

    const replacementConfig = { plugins: [] };
    const consumerWebpack = vi.fn(() => replacementConfig);
    const wrapped = withAnimus({ system: './src/ds.ts' })({
      webpack: consumerWebpack,
    });
    if (!('webpack' in wrapped)) {
      throw new Error('withAnimus returned the Turbopack branch');
    }
    const incomingConfig = {};
    const context = {};

    const config = wrapped.webpack?.(incomingConfig, context);

    expect(consumerWebpack).toHaveBeenCalledWith(incomingConfig, context);
    expect(config).toBe(replacementConfig);
    expect(
      config?.plugins?.some(
        (candidate) => candidate instanceof AnimusWebpackPlugin
      )
    ).toBe(true);
    expect(config?.module?.rules).toHaveLength(1);
    const plugin = injectedAnimusPlugin(config?.plugins);
    expect(config?.resolve?.alias?.['.animus/styles.css']).toBe(
      join(sessionArtifactDir(root, plugin.sessionId), 'styles.css')
    );
  });

  function loaderRuleTest(options: AnimusNextOptions) {
    const wrapped = withAnimus(options)({});
    if (!('webpack' in wrapped)) {
      throw new Error('withAnimus returned the Turbopack branch');
    }
    const ruleTest = wrapped.webpack?.({}, {})?.module?.rules?.[0]?.test;
    if (ruleTest === undefined || ruleTest instanceof RegExp) {
      throw new Error('expected a callable webpack rule test');
    }
    return ruleTest;
  }

  test('keeps native Svelte usage files out of the webpack transform loader', () => {
    const root = mkdtempSync(join(tmpdir(), 'animus-next-loader-scope-'));
    temporaryRoots.push(root);
    vi.spyOn(process, 'cwd').mockReturnValue(root);

    const ruleTest = loaderRuleTest({
      system: './src/ds.ts',
      extensions: ['.ts', '.svelte'],
    });

    expect(ruleTest(join(root, 'src', 'definition.ts'))).toBe(true);
    expect(ruleTest(join(root, 'src', 'Usage.svelte'))).toBe(false);
  });

  test('the loader rule claims exactly the shared engine-transform file class', () => {
    const root = mkdtempSync(join(tmpdir(), 'animus-next-loader-class-'));
    temporaryRoots.push(root);
    vi.spyOn(process, 'cwd').mockReturnValue(root);

    const ruleTest = loaderRuleTest({ system: './src/ds.ts' });

    for (const ext of ENGINE_TRANSFORM_EXTENSIONS) {
      expect([ext, ruleTest(join(root, 'src', `definition.${ext}`))]).toEqual([
        ext,
        true,
      ]);
    }
    expect(ruleTest(join(root, 'src', 'Usage.svelte'))).toBe(false);
    expect(ruleTest(join(root, 'src', 'legacy.cjs'))).toBe(false);
  });

  test('a monorepo run keys every path off the app root and the taps never re-key it', () => {
    const monorepoRoot = mkdtempSync(join(tmpdir(), 'animus-next-monorepo-'));
    temporaryRoots.push(monorepoRoot);
    const appDir = join(monorepoRoot, 'apps', 'web');
    mkdirSync(appDir, { recursive: true });
    vi.spyOn(process, 'cwd').mockReturnValue(monorepoRoot);

    // From the monorepo root, the app is named by `root`.
    const wrapped = withAnimus({ system: './src/ds.ts', root: appDir })({});
    if (!('webpack' in wrapped)) {
      throw new Error('withAnimus returned the Turbopack branch');
    }
    const config = wrapped.webpack?.({}, { dir: appDir });

    const plugin = injectedAnimusPlugin(config?.plugins);
    const sessionDir = sessionArtifactDir(appDir, plugin.sessionId);
    expect(plugin.sessionDir).toBe(sessionDir);
    expect(config?.resolve?.alias?.['.animus/styles.css']).toBe(
      join(sessionDir, 'styles.css')
    );

    const adopt = plugin['adoptCompilerContext'].bind(plugin);
    const compilerAt = (context: string): Parameters<typeof adopt>[0] => ({
      context,
      hooks: {
        run: { tapPromise: () => {} },
        watchRun: { tapPromise: () => {} },
        compilation: { tap: () => {} },
        thisCompilation: { tap: () => {} },
      },
    });
    // A compiler context other than the configured root fails (SA2).
    expect(() => adopt(compilerAt(monorepoRoot))).toThrow(
      expect.objectContaining({
        name: 'AnimusConfigError',
        message: expect.stringContaining(
          `compiler.context (${monorepoRoot}) differs from the configured project root (${appDir})`
        ),
      })
    );
    expect(plugin.sessionDir).toBe(sessionDir);
  });

  /** Contract: an equivalent compiler context is the same root (SA2). */
  test('an equivalent compiler context is accepted as the configured root', () => {
    const parent = mkdtempSync(join(tmpdir(), 'animus-next-equivalent-'));
    temporaryRoots.push(parent);
    const appDir = join(parent, 'app');
    mkdirSync(appDir);
    const linked = join(parent, 'linked');
    symlinkSync(appDir, linked);
    vi.spyOn(process, 'cwd').mockReturnValue(appDir);
    const wrapped = withAnimus({ system: './src/ds.ts' })({});
    if (!('webpack' in wrapped)) {
      throw new Error('withAnimus returned the Turbopack branch');
    }
    const plugin = injectedAnimusPlugin(
      wrapped.webpack?.({}, { dir: appDir })?.plugins
    );
    const adopt = plugin['adoptCompilerContext'].bind(plugin);
    for (const context of [`${appDir}/`, linked]) {
      expect(() =>
        adopt({
          context,
          hooks: {
            run: { tapPromise: () => {} },
            watchRun: { tapPromise: () => {} },
            compilation: { tap: () => {} },
            thisCompilation: { tap: () => {} },
          },
        })
      ).not.toThrow();
    }
  });

  /** An app under a parent directory that declares one source kit; the
   *  parent declares none. */
  function appWithSourceKit() {
    const parent = mkdtempSync(join(tmpdir(), 'animus-next-kit-root-'));
    temporaryRoots.push(parent);
    writeFileSync(join(parent, 'package.json'), '{"name":"parent"}');
    const app = join(parent, 'apps', 'web');
    mkdirSync(app, { recursive: true });
    writeFileSync(
      join(app, 'package.json'),
      JSON.stringify({ name: 'web', dependencies: { '@kits/ui': '*' } })
    );
    const kit = join(app, 'node_modules', '@kits', 'ui');
    mkdirSync(join(kit, 'src'), { recursive: true });
    writeFileSync(
      join(kit, 'package.json'),
      JSON.stringify({
        name: '@kits/ui',
        exports: {
          '.': { animus: './src/index.ts', default: './dist/index.js' },
        },
      })
    );
    writeFileSync(join(kit, 'src', 'index.ts'), 'export {};\n');
    return { parent, app };
  }

  test('an app built from its own directory or from a parent with root gets the same source kits', () => {
    const { parent, app } = appWithSourceKit();
    const cwd = vi.spyOn(process, 'cwd');
    cwd.mockReturnValue(app);
    const own = withAnimus({ system: './src/ds.ts' })({});
    cwd.mockReturnValue(parent);
    const fromParent = withAnimus({ system: './src/ds.ts', root: app })({});

    expect(own.transpilePackages).toEqual(['@kits/ui']);
    expect(fromParent.transpilePackages).toEqual(own.transpilePackages);
  });

  test('a webpack run from a parent without root fails, naming both roots', () => {
    const { parent, app } = appWithSourceKit();
    vi.spyOn(process, 'cwd').mockReturnValue(parent);
    const wrapped = withAnimus({ system: './src/ds.ts' })({});
    if (!('webpack' in wrapped)) {
      throw new Error('withAnimus returned the Turbopack branch');
    }
    expect(() => wrapped.webpack?.({}, { dir: app })).toThrow(
      expect.objectContaining({
        name: 'AnimusConfigError',
        message: expect.stringMatching(
          new RegExp(`builds ${app}.*source kits from ${parent}`)
        ),
      })
    );
  });

  test('forwards every configured option to the injected plugin', () => {
    const root = mkdtempSync(join(tmpdir(), 'animus-next-options-'));
    temporaryRoots.push(root);
    vi.spyOn(process, 'cwd').mockReturnValue(root);

    const options: AnimusNextOptions = {
      system: './src/ds.ts',
      exclude: ['**/*.stories.tsx'],
      extensions: ['.ts', '.tsx'],
      strict: true,
      verbose: true,
      prefix: 'acme',
      engine: 'v2',
      cssImportTarget: 'src/app/[locale]/layout.tsx',
      layers: [
        'reset',
        'anm-global',
        'anm-base',
        'anm-variants',
        'anm-compounds',
        'anm-states',
        'anm-system',
        'anm-custom',
        'overrides',
      ],
    };

    const wrapped = withAnimus(options)({});
    if (!('webpack' in wrapped)) {
      throw new Error('withAnimus returned the Turbopack branch');
    }
    const config = wrapped.webpack?.({}, {});
    const plugin = injectedAnimusPlugin(config?.plugins);

    // With the mode resolved from the Next dev flag, absent here.
    expect(plugin.getOptions()).toEqual({ ...options, mode: 'production' });

    expect(config?.module?.rules?.[0]?.use?.[0]?.options).toEqual({
      development: false,
      cssImportTarget: 'src/app/[locale]/layout.tsx',
      // The build the wrapper created, and the root its plugin analyses.
      build: plugin.sessionId,
      root: process.cwd(),
    });
  });

  // Contract: `quarantine` gives the client compiler, the one that builds
  // stylesheets, layergate's plugin: `anm-vendor` first in the order
  // Animus's stylesheet declares, the declared sheets delivered at that
  // stylesheet's head, and what layergate reads watched by Animus's
  // matcher, which owns Next's watch options. Server compilers get none.
  test('quarantine adds layergate to the client compiler only', () => {
    const root = mkdtempSync(join(tmpdir(), 'animus-next-quarantine-'));
    temporaryRoots.push(root);
    vi.spyOn(process, 'cwd').mockReturnValue(root);

    const wrapped = withAnimus({
      system: './src/ds.ts',
      quarantine: { sheets: ['vendor/a.css'], dependencies: ['vendor'] },
    })({});
    if (!('webpack' in wrapped)) {
      throw new Error('withAnimus returned the Turbopack branch');
    }
    const isGate = (candidate: unknown): candidate is { id: string } =>
      candidate instanceof Object &&
      candidate.constructor.name === 'LayergatePlugin';
    const client = wrapped.webpack?.({}, { isServer: false });
    const server = wrapped.webpack?.({}, { isServer: true });
    const animus = injectedAnimusPlugin(client?.plugins);
    const gate = client?.plugins?.find(isGate);
    if (!gate) throw new Error('expected layergate on the client compiler');
    const state = registry().states.get(gate.id);

    expect(server?.plugins?.some(isGate)).toBe(false);
    expect(animus.getOptions().layers).toEqual([
      'anm-vendor',
      ...ANIMUS_LAYERS,
    ]);
    expect(state?.plan).toMatchObject({
      layer: 'anm-vendor',
      order: ['anm-vendor', ...ANIMUS_LAYERS],
      sheets: ['vendor/a.css'],
    });
    expect(state?.declaredBy).toBe(real(stylesPath(animus.sessionDir)));

    const read = join(root, 'node_modules/vendor/nested.css');
    state?.units.record('unit', [read]);
    const ignores = animus.watchIgnored(/node_modules/);
    expect(ignores(read)).toBe(false);
    expect(ignores(join(root, 'node_modules/vendor/other.css'))).toBe(true);
  });

  // Contract: under Turbopack, which runs no loader on the stylesheets a
  // stylesheet imports, `quarantine` fails config loading, naming webpack.
  test('quarantine refuses Turbopack', () => {
    const wrapped = withAnimus({
      system: './src/ds.ts',
      turbopack: { mode: 'on' },
      quarantine: { sheets: ['vendor/a.css'] },
    });
    expect(() => wrapped({})).toThrow(QUARANTINE_TURBOPACK_MESSAGE);
  });

  // Contract: the refusal follows the host actually running, not Animus's
  // own Turbopack mode: under Turbopack with `turbopack: { mode: 'off' }`,
  // Next never calls the webpack hook, so vendor CSS would ship unlayered.
  // Next sets TURBOPACK, possibly empty: its presence counts.
  test.each(['1', ''])(
    'quarantine refuses Turbopack whatever the turbopack mode (TURBOPACK=%j)',
    (value) => {
      vi.stubEnv('TURBOPACK', value);
      const wrapped = withAnimus({
        system: './src/ds.ts',
        turbopack: { mode: 'off' },
        quarantine: { sheets: ['vendor/a.css'] },
      });
      expect(() => wrapped({})).toThrow(QUARANTINE_TURBOPACK_MESSAGE);
    }
  );

  test('declares the runtime dev define from the Next dev flag', () => {
    const root = mkdtempSync(join(tmpdir(), 'animus-next-define-'));
    temporaryRoots.push(root);
    vi.spyOn(process, 'cwd').mockReturnValue(root);

    class FakeDefinePlugin {
      constructor(readonly definitions: Record<string, string>) {}
    }

    const definitionsFor = (dev: boolean) => {
      const wrapped = withAnimus({ system: './src/ds.ts' })({});
      if (!('webpack' in wrapped)) {
        throw new Error('withAnimus returned the Turbopack branch');
      }
      const config = wrapped.webpack?.(
        {},
        { dev, webpack: { DefinePlugin: FakeDefinePlugin } }
      );
      const injected = config?.plugins?.find(
        (candidate): candidate is FakeDefinePlugin =>
          candidate instanceof FakeDefinePlugin
      );
      return injected?.definitions;
    };

    expect(definitionsFor(true)).toEqual({ __ANIMUS_DEV__: 'true' });
    expect(definitionsFor(false)).toEqual({ __ANIMUS_DEV__: 'false' });
  });
});
