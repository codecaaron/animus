import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { createV2EngineApi } from '../pipeline/engine-adapter';
import { loadSystemConfig } from '../pipeline/system-config';
import {
  SYSTEM_LOAD_CACHE_ENTRIES,
  SYSTEM_LOAD_SETTLE_MS,
} from '../pipeline/system-load-cache';
import { REPO_ROOT } from './engine-prerequisites';

import type { EngineApi, V2ExtractEngine } from '../pipeline/engine-adapter';

const NATIVE = join(__dirname, '../index-v2.js');

function nativeApi(): EngineApi {
  let engine: V2ExtractEngine | null = null;
  let sentSources: Map<string, string> | null = null;
  let driftWarned = false;
  return createV2EngineApi({
    label: 'system-load-cache-test',
    isV2: () => true,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loadNativeEngine: () => require(NATIVE),
    store: {
      getEngine: () => engine,
      setEngine: (next) => {
        engine = next;
      },
      getSentSources: () => sentSources,
      setSentSources: (sources) => {
        sentSources = sources;
      },
      getDriftWarned: () => driftWarned,
      setDriftWarned: (value) => {
        driftWarned = value;
      },
    },
  })();
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/** A project whose system re-exports `./theme`, which resolves to
 *  `theme/index.ts`: `theme.ts` is a path the load finds missing. */
function project(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'animus-load-cache-')));
  roots.push(root);
  mkdirSync(join(root, 'node_modules', '@animus-ui'), { recursive: true });
  for (const name of ['system', 'properties']) {
    symlinkSync(
      join(REPO_ROOT, 'packages', name),
      join(root, 'node_modules', '@animus-ui', name)
    );
  }
  writeFileSync(join(root, 'package.json'), '{"name":"app","type":"module"}');
  mkdirSync(join(root, 'src', 'theme'), { recursive: true });
  writeFileSync(
    join(root, 'src', 'ds.ts'),
    `import { createSystem } from '@animus-ui/system';
export { tokens } from './theme';
export const ds = createSystem().build().seal();
`
  );
  writeTheme(root, 'theme/index.ts', "'#111111'");
  return root;
}

/** Writes a theme file, then dates the project's sources as settled: the
 *  cache keeps no load of a file written just before it. */
function writeTheme(root: string, file: string, brand: string): void {
  writeFileSync(
    join(root, 'src', file),
    `import { createTheme } from '@animus-ui/system';
export const tokens = createTheme().addColors({ brand: { 500: ${brand} } }).build();
`
  );
  const settled = new Date(Date.now() - 2 * SYSTEM_LOAD_SETTLE_MS);
  const settle = (path: string) => {
    utimesSync(path, settled, settled);
    if (path.endsWith('.ts') || path.endsWith('.json')) return;
    for (const name of readdirSync(path)) settle(join(path, name));
  };
  settle(join(root, 'src'));
  utimesSync(join(root, 'package.json'), settled, settled);
}

/**
 * Contract: a cached system load is served only while every file it read is
 * unchanged and every path it found missing is still absent, under the same
 * engine build and loader options; a load that read the clock or
 * `Math.random` is never served from the cache. A partial entry is a miss,
 * and a project keeps a bounded number of entries.
 */
describe('the system-load cache', () => {
  it('serves a load only while every file it read is unchanged and every path it found missing is still absent', () => {
    const root = project();
    const native = nativeApi();
    let loads = 0;
    let buildId = native.engineBuildId?.() ?? '';
    const engine: EngineApi = {
      ...native,
      engineBuildId: () => buildId,
      loadSystemModule: (...args: unknown[]) => {
        loads++;
        return native.loadSystemModule(...args);
      },
    };
    const load = (conditions?: string[]) =>
      loadSystemConfig(() => engine, {
        systemPath: join(root, 'src', 'ds.ts'),
        rootDir: root,
        conditions,
      });
    const brand = () => /#[0-9a-f]{6}/.exec(load().variableCss)?.[0];

    // Kept, and served as loaded.
    const loaded = load();
    expect(load()).toEqual(loaded);
    expect(loads).toBe(1);

    // A file it read changes.
    writeTheme(root, 'theme/index.ts', "'#222222'");
    expect(brand()).toBe('#222222');
    expect(brand()).toBe('#222222');
    expect(loads).toBe(2);

    // A path it found missing appears, and now wins resolution.
    writeTheme(root, 'theme.ts', "'#333333'");
    expect(brand()).toBe('#333333');
    expect(brand()).toBe('#333333');
    expect(loads).toBe(3);

    // Other loader options, then another engine build.
    load(['animus-test']);
    load(['animus-test']);
    expect(loads).toBe(4);
    buildId = 'another-build';
    load();
    expect(loads).toBe(5);

    // A partial entry is a miss.
    const kept = join(root, 'node_modules', '.cache', 'animus', 'system-load');
    // The project's own directory.
    const [ownDirectory] = readdirSync(kept);
    const directory = join(kept, ownDirectory);
    for (const name of readdirSync(directory)) {
      writeFileSync(join(directory, name), '{"format":');
    }
    load();
    expect(loads).toBe(6);
    expect(readdirSync(directory).length).toBeLessThanOrEqual(
      SYSTEM_LOAD_CACHE_ENTRIES
    );

    // A load that reads the clock is never served again.
    writeTheme(root, 'theme.ts', "Date.now() > 0 ? '#444444' : '#555555'");
    expect(brand()).toBe('#444444');
    expect(brand()).toBe('#444444');
    expect(loads).toBe(8);
  });
});
