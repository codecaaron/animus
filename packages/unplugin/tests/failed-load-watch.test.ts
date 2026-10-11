import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { setEngineApiOverride } from '../../extract/session/singleton';
import {
  createProject,
  disposeTempRoots,
  resetAnimusGlobals,
} from '../../extract/tests/session/session-fixtures';
import { unpluginFactory } from '../src/core';

let restoreGlobals: (() => void) | null = null;

afterEach(() => {
  restoreGlobals?.();
  setEngineApiOverride(null);
  vi.restoreAllMocks();
  disposeTempRoots();
});

describe("a failed load's observations are watched", () => {
  test('rollup watch registers the files the load read and the paths it found absent', async () => {
    restoreGlobals = resetAnimusGlobals();
    const root = createProject('animus-unplugin-failed-load-');
    const palette = join(root, 'src', 'palette.ts');
    const absent = join(root, 'src', 'theme.ts');
    setEngineApiOverride(() => ({
      extractFacts: () => '{"files":{},"parseCount":0}',
      loadSystemModule: () => {
        throw Object.assign(new Error('SyntaxError in palette.ts'), {
          dependencies: [join(root, 'src', 'system.ts'), palette],
          missing: [absent],
        });
      },
      analyzeProject: () => '',
      clearAnalysisCache: () => {},
    }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plugin = unpluginFactory(
      { system: './src/system.ts', root },
      { framework: 'rollup', watchMode: true, versions: {} }
    );
    if (Array.isArray(plugin) || !plugin.rollup?.buildStart) {
      throw new Error('expected one plugin with a rollup buildStart');
    }
    const hook = plugin.rollup.buildStart;
    const buildStart = 'handler' in hook ? hook.handler : hook;
    const watched: string[] = [];
    const context = {
      meta: { watchMode: true },
      addWatchFile: (path: string) => watched.push(path),
    };

    await expect(
      // SAFETY: the hook reads only `meta.watchMode` and `addWatchFile` from
      // its context, and only `plugins` from its options.
      buildStart.call(context as never, { plugins: [] } as never)
    ).rejects.toThrow('palette.ts');

    expect(watched).toEqual(expect.arrayContaining([palette, absent]));
  });
});
