import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { sessionArtifactDir } from '../../extract/session/session-paths';
import { AnimusWebpackPlugin } from '../src/plugin';
import { withAnimus } from '../src/with-animus';

import type { AnimusNextOptions } from '../src/types';

const ENGINE_KEY = '__animus_engine__';
const g = globalThis as Record<string, unknown>;

const temporaryRoots: string[] = [];
let savedEngine: unknown;

beforeEach(() => {
  savedEngine = g[ENGINE_KEY];
});

afterEach(() => {
  g[ENGINE_KEY] = savedEngine;
  vi.restoreAllMocks();
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('withAnimus', () => {
  test('reports a missing system with curried usage guidance', () => {
    expect(() => withAnimus({} as AnimusNextOptions)).toThrow(
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
    // The stylesheet alias targets the session-scoped artifact.
    const plugin = config?.plugins?.find(
      (candidate) => candidate instanceof AnimusWebpackPlugin
    ) as AnimusWebpackPlugin;
    expect(config?.resolve?.alias?.['.animus/styles.css']).toBe(
      join(sessionArtifactDir(root, plugin.sessionId), 'styles.css')
    );
  });

  test('keeps native Svelte usage files out of the webpack transform loader', () => {
    const root = mkdtempSync(join(tmpdir(), 'animus-next-loader-scope-'));
    temporaryRoots.push(root);
    vi.spyOn(process, 'cwd').mockReturnValue(root);

    const wrapped = withAnimus({
      system: './src/ds.ts',
      extensions: ['.ts', '.svelte'],
    })({});
    if (wrapped instanceof Promise) throw new Error('unexpected async config');
    const rule = wrapped.webpack?.({}, {})?.module?.rules?.[0];

    const ruleTest = rule?.test;
    if (typeof ruleTest !== 'function') {
      throw new Error('expected a callable webpack rule test');
    }
    expect(ruleTest(join(root, 'src', 'definition.ts'))).toBe(true);
    expect(ruleTest(join(root, 'src', 'Usage.svelte'))).toBe(false);
  });

  test('a monorepo run keys every path off Next dir and the taps never re-key it', () => {
    // `next dev ./apps/web` from a monorepo root: cwd is the ROOT, Next's
    // resolved `dir` (=== compiler.context) is the app. The cwd and the
    // compiler context must DIFFER here — the old cwd derivation froze the
    // alias/stub under the root while the run taps re-keyed sessionDir to
    // the app, publishing artifacts where none of the frozen paths looked.
    const monorepoRoot = mkdtempSync(join(tmpdir(), 'animus-next-monorepo-'));
    temporaryRoots.push(monorepoRoot);
    const appDir = join(monorepoRoot, 'apps', 'web');
    mkdirSync(appDir, { recursive: true });
    vi.spyOn(process, 'cwd').mockReturnValue(monorepoRoot);

    const wrapped = withAnimus({ system: './src/ds.ts' })({});
    if (wrapped instanceof Promise) throw new Error('unexpected async config');
    const config = wrapped.webpack?.({}, { dir: appDir });

    const plugin = config?.plugins?.find(
      (candidate) => candidate instanceof AnimusWebpackPlugin
    ) as AnimusWebpackPlugin;
    const sessionDir = sessionArtifactDir(appDir, plugin.sessionId);
    // Config-time derivations key off Next's dir, not cwd.
    expect(plugin.sessionDir).toBe(sessionDir);
    expect(config?.resolve?.alias?.['.animus/styles.css']).toBe(
      join(sessionDir, 'styles.css')
    );

    // The run/watchRun taps keep the configured root over a divergent
    // compiler context (custom-webpack setups), warning once instead of
    // silently re-keying sessionDir.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adopt = (
      plugin as unknown as {
        adoptCompilerContext(c: { context: string }): void;
      }
    ).adoptCompilerContext.bind(plugin);
    adopt({ context: monorepoRoot });
    adopt({ context: monorepoRoot });
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
    const plugin = config?.plugins?.find(
      (candidate) => candidate instanceof AnimusWebpackPlugin
    ) as AnimusWebpackPlugin | undefined;

    expect(plugin?.getOptions()).toEqual(options);

    // Loader-facing subset rides on the rule options
    expect(config?.module?.rules?.[0]?.use?.[0]?.options).toEqual({
      strict: true,
      cssImportTarget: 'src/app/[locale]/layout.tsx',
    });
  });

  test('declares the runtime dev define from the Next dev flag', () => {
    // The system runtime gates its development-only diagnostics on
    // `__ANIMUS_DEV__`; the plugin supplies it through the webpack instance
    // Next hands to this hook, so a production compile folds those branches
    // away and `next dev` keeps them.
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
        (candidate) => candidate instanceof FakeDefinePlugin
      ) as FakeDefinePlugin | undefined;
      return injected?.definitions;
    };

    expect(definitionsFor(true)).toEqual({ __ANIMUS_DEV__: 'true' });
    expect(definitionsFor(false)).toEqual({ __ANIMUS_DEV__: 'false' });
  });
});
