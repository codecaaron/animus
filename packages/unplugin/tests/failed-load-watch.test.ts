import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { watch } from 'rollup';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { setEngineApiOverride } from '../../extract/session/singleton';
import {
  buildManifest,
  createProject,
  disposeTempRoots,
  PLAN_A,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from '../../extract/tests/session/session-fixtures';
import { parserStoppingAt } from '../../extract/tests/source-ingestion-fixtures';
import { unpluginFactory } from '../src/core';
import { animusRollup } from '../src/rollup';

import type { RollupWatcherEvent } from 'rollup';

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

/** Polls `probe` within a fixed budget; a timeout names what it waited for
 *  and the watch's event trace. */
async function until(
  probe: () => boolean,
  what: string,
  trace: readonly string[]
): Promise<void> {
  const start = Date.now();
  while (!probe()) {
    if (Date.now() - start > 4_000) {
      throw new Error(`gave up waiting for ${what}:\n${trace.join('\n')}`);
    }
    await new Promise((settle) => setTimeout(settle, 25));
  }
}

describe('a path the system load found absent is watched for its creation', () => {
  test('rollup watch reloads the system when it is created', async () => {
    restoreGlobals = resetAnimusGlobals();
    // The watcher reports real paths; the temp root may sit behind a symlink.
    const root = realpathSync(createProject('animus-unplugin-absent-watch-'));
    // The load's resolution probes for an import it could not resolve.
    const absent = [join(root, 'src', 'theme'), join(root, 'src', 'theme.js')];
    const entry = join(root, 'src', 'entry.js');
    writeFileSync(entry, 'export const entry = 1;\n');
    const trace: string[] = [];
    let loads = 0;
    setEngineApiOverride(() => ({
      extractFacts: parserStoppingAt('(('),
      loadSystemModule: () => {
        loads++;
        trace.push(`system load ${loads}`);
        return {
          ...SYSTEM_CONFIG,
          dependencies: [join(root, 'src', 'system.ts')],
          missing: existsSync(absent[1]) ? [] : absent,
        };
      },
      analyzeProject: () => buildManifest(PLAN_A),
      // The bundle holds no component file, so no transform replaces code.
      transformFile: (source: string) => ({
        code: source,
        hasComponents: false,
      }),
      clearAnalysisCache: () => {},
    }));
    const watcher = watch({
      input: entry,
      output: { dir: join(root, 'out'), format: 'es' },
      // A written bundle inside the root would rebuild the watch again.
      watch: { skipWrite: true },
      plugins: [animusRollup({ system: './src/system.ts', root })],
    });
    watcher.on('event', (event: RollupWatcherEvent) => {
      trace.push(
        event.code === 'ERROR'
          ? `rollup ERROR ${String(event.error.message).slice(0, 300)}`
          : `rollup ${event.code}`
      );
      if (event.code === 'BUNDLE_END') void event.result.close();
    });
    watcher.on('change', (id, { event }) => {
      trace.push(`change ${event} ${id}`);
    });
    try {
      const ends = () => trace.filter((line) => line === 'rollup END').length;
      await until(() => ends() === 1, 'the first build', trace);

      // An edit rebuilds first: each build registers the absent paths again.
      writeFileSync(entry, 'export const entry = 2;\n');
      await until(() => ends() === 2, 'the rebuild after an edit', trace);
      const loadsBefore = loads;

      writeFileSync(absent[1], 'export const theme = {};\n');
      await until(() => loads > loadsBefore, 'the system reload', trace);
    } finally {
      await watcher.close();
    }
  });
});
