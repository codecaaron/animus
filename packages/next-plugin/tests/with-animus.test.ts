import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

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
    expect(config?.resolve?.alias?.['.animus/styles.css']).toBe(
      join(root, '.animus', 'styles.css')
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
      engine: 'v1',
      layers: [
        'reset',
        'global',
        'base',
        'variants',
        'compounds',
        'states',
        'system',
        'custom',
        'overrides',
      ],
    };

    const wrapped = withAnimus(options)({});
    const config = wrapped.webpack?.({}, {});
    const plugin = config?.plugins?.find(
      (candidate) => candidate instanceof AnimusWebpackPlugin
    ) as AnimusWebpackPlugin | undefined;

    expect(plugin?.getOptions()).toEqual(options);
  });
});
