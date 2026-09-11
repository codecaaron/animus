import { ENGINE_TRANSFORM_EXTENSIONS } from '@animus-ui/extract/pipeline';
import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { sessionArtifactDir } from '../../extract/session/session-paths';
import { resetAnimusGlobals } from '../../extract/tests/session/session-fixtures';
import { AnimusWebpackPlugin } from '../src/plugin';
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
    if (wrapped instanceof Promise) throw new Error('unexpected async config');
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
    if (wrapped instanceof Promise) throw new Error('unexpected async config');
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

  test('a monorepo run keys every path off Next dir and the taps never re-key it', () => {
    const monorepoRoot = mkdtempSync(join(tmpdir(), 'animus-next-monorepo-'));
    temporaryRoots.push(monorepoRoot);
    const appDir = join(monorepoRoot, 'apps', 'web');
    mkdirSync(appDir, { recursive: true });
    vi.spyOn(process, 'cwd').mockReturnValue(monorepoRoot);

    const wrapped = withAnimus({ system: './src/ds.ts' })({});
    if (wrapped instanceof Promise) throw new Error('unexpected async config');
    const config = wrapped.webpack?.({}, { dir: appDir });

    const plugin = injectedAnimusPlugin(config?.plugins);
    const sessionDir = sessionArtifactDir(appDir, plugin.sessionId);
    expect(plugin.sessionDir).toBe(sessionDir);
    expect(config?.resolve?.alias?.['.animus/styles.css']).toBe(
      join(sessionDir, 'styles.css')
    );

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
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
    adopt(compilerAt(monorepoRoot));
    adopt(compilerAt(monorepoRoot));
    expect(plugin.sessionDir).toBe(sessionDir);
    expect(
      warn.mock.calls.filter(([msg]) =>
        String(msg).includes('differs from the configured project root')
      )
    ).toHaveLength(1);
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
    if (wrapped instanceof Promise) throw new Error('unexpected async config');
    const config = wrapped.webpack?.({}, {});
    const plugin = injectedAnimusPlugin(config?.plugins);

    expect(plugin.getOptions()).toEqual(options);

    expect(config?.module?.rules?.[0]?.use?.[0]?.options).toEqual({
      strict: true,
      cssImportTarget: 'src/app/[locale]/layout.tsx',
    });
  });

  test('declares the runtime dev define from the Next dev flag', () => {
    const root = mkdtempSync(join(tmpdir(), 'animus-next-define-'));
    temporaryRoots.push(root);
    vi.spyOn(process, 'cwd').mockReturnValue(root);

    class FakeDefinePlugin {
      constructor(readonly definitions: Record<string, string>) {}
    }

    const definitionsFor = (dev: boolean) => {
      const wrapped = withAnimus({ system: './src/ds.ts' })({});
      if (wrapped instanceof Promise)
        throw new Error('unexpected async config');
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
