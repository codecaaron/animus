import { ENGINE_TRANSFORM_EXTENSIONS } from '@animus-ui/extract/pipeline';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, test } from 'vitest';

import {
  ANIMUS_TURBOPACK_RULE_GLOB,
  buildTurbopackConfig,
  resolveTurbopackMode,
  turbopackSideEffectsLimits,
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
      resolveTurbopackMode({ ...BASE, unstable_turbopack: { mode: 'on' } }, {})
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
  const SESSION_ID = 'test-session';
  const SESSION_DIR = '/proj/.animus/sessions/test-session';

  const build = (
    options: AnimusNextOptions,
    entries: Array<[string, string]> = [],
    development = false
  ) =>
    buildTurbopackConfig({
      rootDir: '/proj',
      loaderPath: '/plugin/dist/turbopack-loader.mjs',
      options,
      externalSourceEntries: new Map(entries),
      sessionId: SESSION_ID,
      sessionDir: SESSION_DIR,
      development,
    });

  test('the loader glob is the shared engine-transform file class, verbatim', () => {
    expect(ANIMUS_TURBOPACK_RULE_GLOB).toBe(
      `*.{${ENGINE_TRANSFORM_EXTENSIONS.join(',')}}`
    );
    expect(ANIMUS_TURBOPACK_RULE_GLOB).toBe('*.{ts,tsx,js,jsx,mjs}');
    expect(ANIMUS_TURBOPACK_RULE_GLOB).not.toContain('svelte');
  });

  test('emits one glob rule with JSON-round-trippable options carrying the session identity', () => {
    const fragment = build(
      {
        ...BASE,
        strict: true,
        cssImportTarget: 'src/app/[locale]/layout.tsx',
      },
      [],
      true
    );

    const rule = fragment.rules[ANIMUS_TURBOPACK_RULE_GLOB];
    expect(rule.loaders).toHaveLength(1);
    expect(rule.loaders[0].loader).toBe('/plugin/dist/turbopack-loader.mjs');
    expect(rule.loaders[0].options).toEqual({
      rootDir: '/proj',
      sessionId: SESSION_ID,
      sessionDir: SESSION_DIR,
      development: true,
      strict: true,
      cssImportTarget: 'src/app/[locale]/layout.tsx',
    });
    expect(JSON.parse(JSON.stringify(rule.loaders[0].options))).toEqual(
      rule.loaders[0].options
    );
  });

  test('omits unset optional loader options', () => {
    const fragment = build(BASE);
    expect(
      fragment.rules[ANIMUS_TURBOPACK_RULE_GLOB].loaders[0].options
    ).toEqual({
      rootDir: '/proj',
      sessionId: SESSION_ID,
      sessionDir: SESSION_DIR,
      development: false,
    });
  });

  test('aliases virtual ids to session-scoped artifacts and externals to source entries', () => {
    const fragment = build(BASE, [
      ['@acme/ds', '/proj/packages/ds/src/index.ts'],
    ]);
    expect(fragment.resolveAlias).toEqual({
      'virtual:animus/system-props':
        './.animus/sessions/test-session/system-props.js',
      '.animus/styles.css': './.animus/sessions/test-session/styles.css',
      '@acme/ds': './packages/ds/src/index.ts',
    });
  });
});

describe('turbopackSideEffectsLimits', () => {
  // Contract: Turbopack has no per-module setting, so it reports each
  // redirect whose source the package's `sideEffects` classify otherwise
  // than the entry the redirect replaces, and each kit whose list names
  // shipped code it reads against the kit's source modules.
  test('reports a redirect, and a kit, whose source Turbopack would misclassify', () => {
    const root = mkdtempSync(join(tmpdir(), 'animus-turbopack-side-effects-'));
    try {
      const kit = join(root, 'kit');
      mkdirSync(join(kit, 'src'), { recursive: true });
      writeFileSync(
        join(kit, 'package.json'),
        JSON.stringify({ sideEffects: ['./dist/register.js'] })
      );
      const entries = new Map([
        ['@acme/kit', join(kit, 'src/index.ts')],
        ['@acme/kit/register', join(kit, 'src/register.ts')],
      ]);
      const declared = new Map([
        ['@acme/kit', false],
        ['@acme/kit/register', true],
      ]);

      const lines = turbopackSideEffectsLimits(root, entries, declared);

      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain(
        'cannot carry the "sideEffects" of @acme/kit/register to its source kit/src/register.ts'
      );
      expect(lines[0]).toContain('Turbopack can drop its side effects');
      expect(lines[1]).toContain(
        'cannot keep the source modules of kit side-effectful'
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
