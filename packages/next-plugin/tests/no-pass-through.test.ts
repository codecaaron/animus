/**
 * SA1: a transform failure never serves builder source. Each host family
 * surfaces it as the host's own error, in development and in a build.
 */
import { join } from 'path';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  disposeTempRoots,
  makeTempRoot,
} from '../../extract/tests/session/session-fixtures';
import { transformWithEngine } from '../../unplugin/src/core';
import { transformSource } from '../../vite-plugin/src/transform';
import { makeContextProbe } from '../../vite-plugin/tests/context-probe';
import { makeManifest } from '../../vite-plugin/tests/manifest-fixture';
import animusLoader from '../src/loader';
import { transformWithManifest } from '../src/loader-core';
import animusTurbopackLoader from '../src/turbopack-loader';

const BUILDER_SOURCE =
  "import { animus } from '@animus-ui/system';\nexport const Button = animus.styles({}).asElement('button');\n";

const engineDown = () => {
  throw new Error('engine down');
};

afterEach(() => {
  vi.restoreAllMocks();
  disposeTempRoots();
});

describe('a transform failure never serves builder source', () => {
  test('Vite: an engine failure for an extracted file throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const root = '/proj';
    const probe = makeContextProbe(root, {
      isProd: false,
      storedManifest: makeManifest({
        files: { 'src/Button.tsx': ['src/Button.tsx::Button'] },
      }),
      storedManifestJson: '{}',
      engineApi: () => ({ transformFile: engineDown }),
    });

    await expect(
      transformSource(probe.ctx, BUILDER_SOURCE, join(root, 'src/Button.tsx'))
    ).rejects.toThrow(/engine down/);
  });

  test('webpack loader: an engine failure throws in development', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() =>
      transformWithManifest({
        source: BUILDER_SOURCE,
        filename: 'src/Button.tsx',
        manifestJson: '{}',
        engineApi: () => ({ transformFile: engineDown }),
        opts: { development: true },
      })
    ).toThrow(/engine down/);
  });

  test('webpack loader: a file the analysis extracted but the engine finds empty throws', () => {
    const transform = (filename: string) =>
      transformWithManifest({
        source: BUILDER_SOURCE,
        filename,
        manifestJson: JSON.stringify({
          files: {
            'src/Button.tsx': ['src/Button.tsx::Button'],
            'src/use.tsx': [],
          },
        }),
        engineApi: () => ({
          transformFile: (source: string) => ({
            code: source,
            hasComponents: false,
          }),
        }),
        opts: {},
      });

    expect(() => transform('src/Button.tsx')).toThrow(/src\/Button\.tsx/);
    // A usage-only file and one outside the analysis stay valid.
    expect(transform('src/use.tsx')).toBe(BUILDER_SOURCE);
    expect(transform('src/other.tsx')).toBe(BUILDER_SOURCE);
  });

  test('webpack loader: a loader with no build config is refused', () => {
    expect(() =>
      animusLoader.call(
        {
          resourcePath: '/proj/src/Button.tsx',
          rootContext: '/proj',
          getOptions: () => ({}),
        },
        BUILDER_SOURCE
      )
    ).toThrow(expect.objectContaining({ name: 'AnimusConfigError' }));
  });

  test('Turbopack loader: no committed analysis and no status throws', async () => {
    const root = makeTempRoot('animus-no-pass-through-');
    const outcome = new Promise<string>((resolve, reject) => {
      const ctx: ThisParameterType<typeof animusTurbopackLoader> = {
        resourcePath: join(root, 'src/Button.tsx'),
        rootContext: root,
        getOptions: () => ({
          rootDir: root,
          sessionId: 'no-analysis',
          sessionDir: join(root, '.animus', 'sessions', 'no-analysis'),
          development: false,
        }),
        addDependency: () => {},
        async:
          () =>
          (err: Error | null, content?: string): void => {
            if (err) reject(err);
            else resolve(content ?? '');
          },
      };
      animusTurbopackLoader.call(ctx, BUILDER_SOURCE);
    });

    await expect(outcome).rejects.toThrow(/no analysis/);
  });

  test('unplugin: a file the analysis extracted but the engine finds empty throws', () => {
    expect(() =>
      transformWithEngine(BUILDER_SOURCE, '/app/src/Button.tsx', {
        rootDir: '/app',
        manifestJson: '{}',
        transformFile: (source) => ({ code: source, hasComponents: false }),
        served: { listed: new Set(['src/Button.tsx']), dropped: new Map() },
      })
    ).toThrow(/src\/Button\.tsx/);
  });
});

/** An extension the analysis dropped over a parent it could not resolve,
 *  as the manifest records it (spec §12.2 row 11). */
const DROP = {
  file: 'src/Fancy.tsx',
  component: 'Fancy',
  parent: 'Parent',
  specifier: './Parent',
  base: 'src/Parent',
  outcome: 'absent',
} as const;
const DROPPED_MESSAGE =
  "cannot serve src/Fancy.tsx: 'Fancy' extends 'Parent' from './Parent'";

describe('a dropped extension is never served raw', () => {
  // Contract (SA1, spec §12.2 row 11): every host fails the transform of a
  // file whose extension the analysis dropped over its parent, naming the
  // component, parent and specifier, in development and in a build.
  // Mixed: another component of the same file extracted.
  for (const mixed of [false, true]) {
    const label = mixed ? ', beside an extracted component' : '';
    test(`unplugin${label}`, () => {
      expect(() =>
        transformWithEngine(BUILDER_SOURCE, '/app/src/Fancy.tsx', {
          rootDir: '/app',
          manifestJson: '{}',
          transformFile: (source) => ({ code: source, hasComponents: mixed }),
          served: {
            listed: new Set(mixed ? [DROP.file] : []),
            dropped: new Map([[DROP.file, DROP]]),
          },
        })
      ).toThrow(DROPPED_MESSAGE);
    });

    for (const development of [true, false]) {
      test(`webpack loader, ${development ? 'development' : 'build'}${label}`, () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(() =>
          transformWithManifest({
            source: BUILDER_SOURCE,
            filename: DROP.file,
            manifestJson: JSON.stringify(
              makeManifest({
                files: mixed ? { [DROP.file]: [`${DROP.file}::Good`] } : {},
                missing_inputs: [{ ...DROP }],
              })
            ),
            engineApi: () => ({
              transformFile: (source: string) => ({
                code: source,
                hasComponents: mixed,
              }),
            }),
            opts: { development },
          })
        ).toThrow(DROPPED_MESSAGE);
      });
    }
  }
});
