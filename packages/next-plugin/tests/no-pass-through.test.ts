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
        listsComponents: (path) => path === 'src/Button.tsx',
      })
    ).toThrow(/src\/Button\.tsx/);
  });
});
