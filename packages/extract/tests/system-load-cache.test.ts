import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createV2EngineApi } from '../pipeline/engine-adapter';
import { loadSystemConfig } from '../pipeline/system-config';
import {
  SYSTEM_LOAD_CACHE_ENTRIES_PER_KEY,
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

const SYSTEM = `import { createSystem } from '@animus-ui/system';
export { tokens } from './theme';
export const ds = createSystem().build().seal();
`;

const theme = (brand: string, prelude = '') =>
  `import { createTheme } from '@animus-ui/system';
${prelude}
export const tokens = createTheme().addColors({ brand: { 500: ${brand} } }).build();
`;

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** Dates everything under `root` as settled, outside `node_modules`: the
 *  cache keeps no load of a path that changed just before it. */
function settle(root: string): void {
  const settled = new Date(Date.now() - 2 * SYSTEM_LOAD_SETTLE_MS);
  const visit = (path: string) => {
    utimesSync(path, settled, settled);
    if (!statSync(path).isDirectory()) return;
    for (const name of readdirSync(path)) {
      if (name !== 'node_modules') visit(join(path, name));
    }
  };
  visit(root);
}

/** Waits until the system packages a project links in settle: the tiers
 *  build them just before this runs, and the cache keeps no load of a file
 *  that changed just before it. */
function settleLinkedPackages(): void {
  let newest = 0;
  const visit = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const stats = statSync(join(dir, name));
      if (stats.isDirectory()) visit(join(dir, name));
      else newest = Math.max(newest, stats.mtimeMs);
    }
  };
  for (const name of ['system', 'properties']) {
    visit(join(REPO_ROOT, 'packages', name, 'dist'));
  }
  const wait = newest + SYSTEM_LOAD_SETTLE_MS - Date.now();
  if (wait > 0)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait + 50);
}

/** A project whose system re-exports `./theme`; `files` are written below
 *  its root, and `links` link a path below it to another. */
function project(
  files: Record<string, string>,
  links: Record<string, string> = {}
): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'animus-load-cache-')));
  roots.push(root);
  mkdirSync(join(root, 'node_modules', '@animus-ui'), { recursive: true });
  for (const name of ['system', 'properties']) {
    symlinkSync(
      join(REPO_ROOT, 'packages', name),
      join(root, 'node_modules', '@animus-ui', name)
    );
  }
  write(join(root, 'package.json'), '{"name":"app","type":"module"}');
  write(join(root, 'src', 'ds.ts'), SYSTEM);
  for (const [path, text] of Object.entries(files))
    write(join(root, path), text);
  for (const [path, target] of Object.entries(links)) {
    symlinkSync(target, join(root, path));
  }
  settle(root);
  return root;
}

interface LoadCounter {
  loads: number;
  buildId: string;
  /** Runs once, after the next native load returns: what changes while a
   *  load runs. */
  duringLoad?: () => void;
}

/** Loads through the cache, counting the native loads; `cache` is the
 *  host's folder, the nearest `node_modules` when absent. */
function loader(root: string, cache?: string) {
  const native = nativeApi();
  const counter: LoadCounter = {
    loads: 0,
    buildId: native.engineBuildId?.() ?? '',
  };
  const engine: EngineApi = {
    ...native,
    engineBuildId: () => counter.buildId,
    loadSystemModule: (...args: unknown[]) => {
      counter.loads++;
      const result = native.loadSystemModule(...args);
      const during = counter.duringLoad;
      counter.duringLoad = undefined;
      during?.();
      return result;
    },
  };
  const load = (conditions?: string[]) =>
    loadSystemConfig(() => engine, {
      systemPath: join(root, 'src', 'ds.ts'),
      rootDir: root,
      conditions,
      cache: { directory: cache },
    });
  const brand = () => /#[0-9a-f]{6}/.exec(load().variableCss)?.[0];
  /** How many native loads `run` made. */
  const loadsOf = (run: () => void) => {
    const before = counter.loads;
    run();
    return counter.loads - before;
  };
  return { counter, load, brand, loadsOf };
}

/**
 * Contract: a cached system load is served only while every file it read is
 * unchanged and every path it found missing is still absent, under the same
 * engine build, loader options and time zone, and while every link its
 * resolution passed through leads where it led. A load that read the clock
 * or `Math.random`, or ran within the settle window of a change, is never
 * served from the cache. A partial entry is a miss, and a project keeps a
 * bounded number of entries.
 *
 * Contract: the participants of one build each keep their states, so an
 * edit and its revert hit for every one of them, and an entry removed while
 * a lookup lists the folder leaves the rest servable.
 */
describe('the system-load cache', () => {
  const zone = process.env.TZ;
  beforeAll(() => {
    settleLinkedPackages();
    // A known zone, which a runtime can set and set back.
    process.env.TZ = 'UTC';
  });
  afterAll(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  it('serves a load only while every file it read is unchanged and every path it found missing is still absent', () => {
    // A repository of its own: the load records `.git`, a directory.
    const root = project({
      'src/theme/index.ts': theme("'#111111'"),
      '.git/HEAD': 'ref: refs/heads/main\n',
    });
    const { counter, load, brand, loadsOf } = loader(root);
    const writeTheme = (file: string, text: string) => {
      write(join(root, 'src', file), text);
      settle(root);
    };

    // Kept, and served as loaded.
    const loaded = load();
    expect(load()).toEqual(loaded);
    expect(counter.loads).toBe(1);

    // A file it read changes.
    writeTheme('theme/index.ts', theme("'#222222'"));
    expect(loadsOf(() => expect(brand()).toBe('#222222'))).toBe(1);
    expect(loadsOf(() => expect(brand()).toBe('#222222'))).toBe(0);

    // A path it found missing appears, and now wins resolution.
    writeTheme('theme.ts', theme("'#333333'"));
    expect(loadsOf(() => expect(brand()).toBe('#333333'))).toBe(1);
    expect(loadsOf(() => expect(brand()).toBe('#333333'))).toBe(0);

    // Other loader options, then another time zone, then another build.
    expect(loadsOf(() => load(['animus-test']))).toBe(1);
    expect(loadsOf(() => load(['animus-test']))).toBe(0);
    process.env.TZ = 'Pacific/Chatham';
    try {
      expect(loadsOf(() => load())).toBe(1);
    } finally {
      process.env.TZ = 'UTC';
    }
    expect(loadsOf(() => load())).toBe(0);
    counter.buildId = 'another-build';
    expect(loadsOf(() => load())).toBe(1);

    // A change within the settle window is not kept until it settles.
    write(join(root, 'src', 'theme.ts'), theme("'#444444'"));
    expect(loadsOf(() => expect(brand()).toBe('#444444'))).toBe(1);
    expect(loadsOf(() => expect(brand()).toBe('#444444'))).toBe(1);
    settle(root);
    expect(loadsOf(() => brand())).toBe(1);
    expect(loadsOf(() => brand())).toBe(0);

    // A directory's own time is no file's content: git touches `.git`'s on
    // every command, and a load just after still keeps.
    writeTheme('theme.ts', theme("'#454545'"));
    const now = new Date();
    utimesSync(join(root, '.git'), now, now);
    expect(loadsOf(() => expect(brand()).toBe('#454545'))).toBe(1);
    expect(loadsOf(() => brand())).toBe(0);

    // A file appearing, its time and all, where the load found none while
    // it ran is not kept: the load read the path missing.
    rmSync(join(root, 'src', 'theme.ts'));
    settle(root);
    counter.duringLoad = () => writeTheme('theme.ts', theme("'#464646'"));
    expect(loadsOf(() => expect(brand()).toBe('#222222'))).toBe(1);
    expect(loadsOf(() => expect(brand()).toBe('#464646'))).toBe(1);

    // A partial entry is a miss.
    const kept = join(root, 'node_modules', '.cache', 'animus', 'system-load');
    // The project's own directory.
    const [ownDirectory] = readdirSync(kept);
    const directory = join(kept, ownDirectory);
    for (const name of readdirSync(directory)) {
      writeFileSync(join(directory, name), '{"format":');
    }
    expect(loadsOf(() => load())).toBe(1);
    // A key keeps its most recent states.
    for (const state of ['#565656', '#575757']) {
      writeTheme('theme.ts', theme(`'${state}'`));
      expect(loadsOf(() => load())).toBe(1);
    }
    const states = new Map<string, number>();
    for (const name of readdirSync(directory)) {
      const key = name.split('.')[0];
      states.set(key, (states.get(key) ?? 0) + 1);
    }
    expect(Math.max(...states.values())).toBe(
      SYSTEM_LOAD_CACHE_ENTRIES_PER_KEY
    );

    // A load that reads the clock or `Math.random` is never served again;
    // one that only checks what the realm offers is.
    for (const read of [
      'Date.now() > 0',
      'new Date().getTime() > 0',
      "Date() !== ''",
      'Math.random() >= 0',
      'performance.now() >= 0',
      'performance.timeOrigin > 0',
    ]) {
      writeTheme('theme.ts', theme(`${read} ? '#555555' : '#666666'`));
      expect(loadsOf(() => expect(brand()).toBe('#555555'))).toBe(1);
      expect(
        loadsOf(() => expect(brand()).toBe('#555555')),
        read
      ).toBe(1);
    }
    writeTheme(
      'theme.ts',
      theme(
        "typeof performance.now === 'function' && 'now' in performance ? '#777777' : '#888888'"
      )
    );
    expect(loadsOf(() => expect(brand()).toBe('#777777'))).toBe(1);
    expect(loadsOf(() => expect(brand()).toBe('#777777'))).toBe(0);
  });

  it('serves a load only while every link its resolution passed through leads where it led', () => {
    // Two checkouts of one package: the same package.json, another brand.
    const checkout = (name: string, brand: string) => ({
      [`pkgs/${name}/package.json`]:
        '{"name":"brand-tokens","type":"module","main":"index.js"}',
      [`pkgs/${name}/index.js`]: `export const BRAND = '${brand}';\n`,
    });
    const files = {
      'themes/a/index.ts': theme(
        'BRAND',
        "import { BRAND } from 'brand-tokens';"
      ),
      'themes/b/index.ts': theme("'#cc0000'"),
      ...checkout('a', '#aa0000'),
      ...checkout('b', '#bb0000'),
    };
    const root = project(files, {
      'src/theme': '../themes/a',
      'node_modules/brand-tokens': '../pkgs/a',
    });
    const { brand, loadsOf } = loader(root);
    const relink = (path: string, target: string) => {
      unlinkSync(join(root, path));
      symlinkSync(target, join(root, path));
    };

    expect(loadsOf(() => expect(brand()).toBe('#aa0000'))).toBe(1);
    expect(loadsOf(() => expect(brand()).toBe('#aa0000'))).toBe(0);

    // A package link retargeted to a checkout with the same package.json.
    relink('node_modules/brand-tokens', '../pkgs/b');
    expect(loadsOf(() => expect(brand()).toBe('#bb0000'))).toBe(1);
    expect(loadsOf(() => expect(brand()).toBe('#bb0000'))).toBe(0);

    // A directory link a relative import passes through, retargeted.
    relink('src/theme', '../themes/b');
    expect(loadsOf(() => expect(brand()).toBe('#cc0000'))).toBe(1);
    expect(loadsOf(() => expect(brand()).toBe('#cc0000'))).toBe(0);
  });

  it('keeps each participant its states, so a revert hits for all of them', () => {
    const root = project({ 'src/theme/index.ts': theme("'#111111'") });
    const cache = join(root, 'host-cache');
    const { load, loadsOf } = loader(root, cache);
    // Next's server, edge and client compilers, each its own key.
    const participants = [['server'], ['edge'], ['client']];
    const writeTheme = (brand: string) => {
      write(join(root, 'src', 'theme', 'index.ts'), theme(`'${brand}'`));
      settle(root);
    };
    const build = () =>
      participants.map((conditions) => loadsOf(() => load(conditions)));

    expect(build()).toEqual([1, 1, 1]);
    writeTheme('#222222');
    expect(build()).toEqual([1, 1, 1]);
    writeTheme('#111111');
    expect(build()).toEqual([0, 0, 0]);

    // An entry gone between the listing and its read: a link to nowhere
    // lists and fails to stat.
    const directory = join(cache, 'system-load');
    const keys = new Set(
      readdirSync(directory).map((name) => name.split('.')[0])
    );
    for (const key of keys) {
      symlinkSync(join(root, 'gone'), join(directory, `${key}.gone.json`));
    }
    expect(build()).toEqual([0, 0, 0]);
  });
});
