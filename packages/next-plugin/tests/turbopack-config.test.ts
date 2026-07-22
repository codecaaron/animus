import { describe, expect, test } from 'vitest';

import {
  ANIMUS_TURBOPACK_RULE_GLOB,
  buildTurbopackConfig,
  resolveTurbopackMode,
} from '../src/turbopack-config';

import type { AnimusNextOptions } from '../src/types';

const BASE: AnimusNextOptions = { system: './src/ds.ts' };

describe('resolveTurbopackMode', () => {
  test('defaults to auto: inactive without TURBOPACK, active with it', () => {
    expect(resolveTurbopackMode(BASE, {})).toBe(false);
    expect(resolveTurbopackMode(BASE, { TURBOPACK: '1' })).toBe(true);
  });

  test('off suppresses wiring even under Turbopack', () => {
    expect(
      resolveTurbopackMode(
        { ...BASE, turbopack: { mode: 'off' } },
        { TURBOPACK: '1' }
      )
    ).toBe(false);
  });

  test('on is unconditional', () => {
    expect(
      resolveTurbopackMode({ ...BASE, turbopack: { mode: 'on' } }, {})
    ).toBe(true);
  });

  test('explicit auto follows the TURBOPACK environment signal', () => {
    const auto: AnimusNextOptions = {
      ...BASE,
      turbopack: { mode: 'auto' },
    };
    expect(resolveTurbopackMode(auto, {})).toBe(false);
    expect(resolveTurbopackMode(auto, { TURBOPACK: '1' })).toBe(true);
  });

  test('deprecated unstable_turbopack is honored; stable option wins', () => {
    expect(
      resolveTurbopackMode(
        { ...BASE, unstable_turbopack: { mode: 'on' } },
        {}
      )
    ).toBe(true);
    expect(
      resolveTurbopackMode(
        {
          ...BASE,
          turbopack: { mode: 'off' },
          unstable_turbopack: { mode: 'on' },
        },
        { TURBOPACK: '1' }
      )
    ).toBe(false);
  });
});

describe('buildTurbopackConfig', () => {
  const build = (options: AnimusNextOptions, entries: Array<[string, string]> = []) =>
    buildTurbopackConfig({
      rootDir: '/proj',
      loaderPath: '/plugin/dist/turbopack-loader.mjs',
      options,
      externalSourceEntries: new Map(entries),
    });

  test('emits one glob rule with JSON-round-trippable options', () => {
    const fragment = build({
      ...BASE,
      strict: true,
      cssImportTarget: 'src/app/[locale]/layout.tsx',
    });

    const rule = fragment.rules[ANIMUS_TURBOPACK_RULE_GLOB];
    expect(rule.loaders).toHaveLength(1);
    expect(rule.loaders[0].loader).toBe('/plugin/dist/turbopack-loader.mjs');
    expect(rule.loaders[0].options).toEqual({
      rootDir: '/proj',
      strict: true,
      cssImportTarget: 'src/app/[locale]/layout.tsx',
    });
    // Spec: options survive JSON serialization unchanged (G3)
    expect(JSON.parse(JSON.stringify(rule.loaders[0].options))).toEqual(
      rule.loaders[0].options
    );
  });

  test('omits unset optional loader options', () => {
    const fragment = build(BASE);
    expect(fragment.rules[ANIMUS_TURBOPACK_RULE_GLOB].loaders[0].options).toEqual(
      { rootDir: '/proj' }
    );
  });

  test('aliases virtual ids to disk artifacts and externals to source entries', () => {
    const fragment = build(BASE, [
      ['@acme/ds', '/proj/packages/ds/src/index.ts'],
    ]);
    expect(fragment.resolveAlias).toEqual({
      'virtual:animus/system-props': './.animus/system-props.js',
      '.animus/styles.css': './.animus/styles.css',
      '@acme/ds': './packages/ds/src/index.ts',
    });
  });
});
