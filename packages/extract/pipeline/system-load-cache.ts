import {
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
} from 'fs';
import { dirname, join } from 'path';

import { contentHash } from './content-hash';
import { declareToolCache } from './task-runner';
import { writeAtomically } from './write-atomically';

/** The states one key keeps, the least recently used going first: each of a
 *  build's participants (Next's client, server and edge compilers) loads
 *  under its own key, so a state is one entry per participant. */
export const SYSTEM_LOAD_CACHE_ENTRIES_PER_KEY = 4;

/** The entries one cache folder keeps across its keys. */
const SYSTEM_LOAD_CACHE_ENTRIES = 32;

/** Bumped when an entry's shape changes: it is part of every key, so an
 *  entry of another shape never matches and ages out. */
const ENTRY_FORMAT = 3;

/** A path written this close to a load, or during it, may have been read in
 *  another state than the one recorded after it: the margin covers file
 *  systems that keep whole-second times. */
export const SYSTEM_LOAD_SETTLE_MS = 2000;

/** What a cached load needs from the loader's result: the files it read,
 *  the paths it found missing, each link its resolution passed through, and
 *  what it read that varies per load. */
interface LoaderResult {
  dependencies?: string[];
  missing?: string[];
  links?: Record<string, string>;
  volatile?: string[];
}

interface Entry {
  /** What each path the load read or found missing held after it: `none`,
   *  `directory`, or `file:` and the file's content digest; for each path
   *  a resolution reached through a link, `link:` and where it led. */
  paths: Record<string, string>;
  result: LoaderResult;
}

/** What `path` holds: a missing candidate may be a directory where the
 *  loader looked for a file, and a dependency may be a directory. */
function observe(path: string): string {
  const stats = statSync(path, { throwIfNoEntry: false });
  if (!stats) return 'none';
  if (stats.isDirectory()) return 'directory';
  try {
    return `file:${contentHash(readFileSync(path))}`;
  } catch {
    return 'none';
  }
}

/** Where the links on `path` lead, as the loader's real path reads it. */
function observeLink(path: string): string {
  try {
    return `link:${realpathSync.native(path)}`;
  } catch {
    return 'none';
  }
}

/** A part of a cache key: the loader's arguments are strings, lists of
 *  them and string records (workspaces, instances). */
type KeyPart =
  | string
  | number
  | undefined
  | readonly string[]
  | Readonly<Record<string, string>>;

/** The key's JSON with each record's entries sorted: equal arguments built
 *  in another order make the same key. */
function canonicalJson(parts: readonly KeyPart[]): string {
  return JSON.stringify(
    parts.map((part) =>
      part instanceof Object && !Array.isArray(part)
        ? Object.entries(part).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        : part
    )
  );
}

/** The project's cache directory, under the nearest `node_modules` a
 *  package manager made, as a monorepo hoists it; one directory per project
 *  root, so each keeps its own entries. None outside any `node_modules`. */
function cacheDirectory(rootDir: string): string | null {
  for (let dir = rootDir; ; dir = dirname(dir)) {
    const modules = join(dir, 'node_modules');
    if (statSync(modules, { throwIfNoEntry: false })) {
      return join(
        modules,
        '.cache',
        'animus',
        'system-load',
        contentHash(rootDir).slice(0, 16)
      );
    }
    if (dirname(dir) === dir) return null;
  }
}

/** The entries among `names` (all, or those of `key`), most recently used
 *  first, each with its key. One another process evicts meanwhile is left
 *  out. */
function entriesOf(
  directory: string,
  names: readonly string[],
  key?: string
): { path: string; key: string; used: number }[] {
  const entries: { path: string; key: string; used: number }[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    if (key !== undefined && !name.startsWith(`${key}.`)) continue;
    const path = join(directory, name);
    const stats = statSync(path, { throwIfNoEntry: false });
    if (stats)
      entries.push({ path, key: name.split('.')[0], used: stats.mtimeMs });
  }
  return entries.sort((a, b) => b.used - a.used);
}

/** The entry for `key` still current: every path the load read or found
 *  missing holds what it held. Each path is observed once. */
function lookup(directory: string, key: string): LoaderResult | null {
  // By kind and path: one path can be a link in one entry and a file in
  // another.
  const observed = new Map<string, string>();
  const holds = ([path, recorded]: [string, string]) => {
    const link = recorded.startsWith('link:');
    const id = `${link ? 'link' : 'path'}:${path}`;
    let now = observed.get(id);
    if (now === undefined) {
      now = link ? observeLink(path) : observe(path);
      observed.set(id, now);
    }
    return now === recorded;
  };
  for (const { path } of entriesOf(directory, readdirSync(directory), key)) {
    let entry: Entry;
    try {
      // SAFETY: `store` writes every entry in this shape, under a key that
      // names the shape; anything else throws below and misses.
      entry = JSON.parse(readFileSync(path, 'utf8')) as Entry;
    } catch {
      // A partial or corrupt entry, or one evicted meanwhile, is a miss.
      continue;
    }
    if (!Object.entries(entry.paths).every(holds)) continue;
    try {
      const now = new Date();
      utimesSync(path, now, now);
    } catch {
      // Recency only orders eviction; a read-only cache still serves.
    }
    return entry.result;
  }
  return null;
}

/** Keeps `result`, or returns why not: it read something that varies per
 *  load, or what it read moved while it ran (a file it read changed shortly
 *  before or while it ran, a file appeared where it found none, a link it
 *  passed through now leads elsewhere). A directory's own time is no file's
 *  content, and git touches `.git`'s on every command. */
function store(
  directory: string,
  key: string,
  result: LoaderResult,
  startedMs: number
): string | null {
  if (result.volatile && result.volatile.length > 0) {
    return `it read ${result.volatile.join(', ')}`;
  }
  const paths: Record<string, string> = {};
  for (const path of result.dependencies ?? []) {
    const stats = statSync(path, { throwIfNoEntry: false });
    if (stats?.isFile() && stats.mtimeMs > startedMs - SYSTEM_LOAD_SETTLE_MS) {
      return `${path} is settling (changed in the last ${SYSTEM_LOAD_SETTLE_MS / 1000} s)`;
    }
    paths[path] = observe(path);
  }
  for (const path of result.missing ?? []) {
    paths[path] = observe(path);
    if (paths[path].startsWith('file:')) {
      return `${path} appeared while it loaded`;
    }
  }
  for (const [path, real] of Object.entries(result.links ?? {})) {
    paths[path] = observeLink(path);
    if (paths[path] !== `link:${real}`) {
      return `the link ${path} moved while it loaded`;
    }
  }
  const entry: Entry = { paths, result };
  const name = `${key}.${contentHash(JSON.stringify(paths))}.json`;
  try {
    writeAtomically(join(directory, name), JSON.stringify(entry));
  } catch (error) {
    return `the write failed (${String(error)})`;
  }
  return null;
}

/** Keeps each key's most recently used states and the folder's most
 *  recently used entries, and drops what a writer that stopped between write
 *  and rename left an hour ago or more. One another process removed
 *  meanwhile is gone already. */
function evict(directory: string): void {
  const remove = (path: string) => rmSync(path, { force: true });
  const names = readdirSync(directory);
  const hourAgo = Date.now() - 60 * 60 * 1000;
  for (const name of names) {
    if (!name.endsWith('.tmp')) continue;
    const path = join(directory, name);
    const stats = statSync(path, { throwIfNoEntry: false });
    if (stats && stats.mtimeMs < hourAgo) remove(path);
  }
  const perKey = new Map<string, number>();
  let kept = 0;
  for (const { path, key } of entriesOf(directory, names)) {
    const states = (perKey.get(key) ?? 0) + 1;
    perKey.set(key, states);
    if (
      states > SYSTEM_LOAD_CACHE_ENTRIES_PER_KEY ||
      kept >= SYSTEM_LOAD_CACHE_ENTRIES
    ) {
      remove(path);
    } else {
      kept++;
    }
  }
}

/** Where a system load's results are kept. */
export interface SystemLoadCacheOptions {
  /** A host-owned cache folder (Vite's cacheDir, Next's distDir cache, the
   *  CLI's `.animus/cache`): the entries live in its `system-load` folder.
   *  Absent, the nearest `node_modules`'s `.cache/animus`. */
  directory?: string;
  /** Says what became of each load: a hit, or a miss and whether it was
   *  kept, and why not. */
  report?: (outcome: string) => void;
}

/**
 * The loader's result for these arguments: a kept result while every path
 * the load read or found missing holds what it held, else a fresh load,
 * kept for next time unless a path it read changed just before or while it
 * ran. The key is the engine build, which names the loader's code, every
 * argument the loader takes, and the host's time zone, which a local-time
 * date reads. Nothing is kept for an engine without a build id, without a
 * cache folder, or for a load that read the clock or `Math.random`; a
 * failed load throws as it would. The cache never fails a load: an
 * unreadable or unwritable cache only loads.
 */
export function cachedSystemLoad<Result extends LoaderResult>(
  buildId: string | undefined,
  rootDir: string,
  args: readonly KeyPart[],
  load: () => Result,
  options: SystemLoadCacheOptions = {}
): Result {
  const report = options.report ?? (() => {});
  if (!buildId) {
    report('off: the engine names no build');
    return load();
  }
  // The host's time zone, as a local-time date reads it, in winter and in
  // summer; `Intl` would cost more than a hit.
  const zone = `${new Date(0)}|${new Date(15552000000)}`;
  const key = contentHash(
    canonicalJson([ENTRY_FORMAT, buildId, zone, ...args])
  );
  let directory: string | null = null;
  try {
    directory = options.directory
      ? join(options.directory, 'system-load')
      : cacheDirectory(rootDir);
    if (directory) declareToolCache(directory);
    const kept = directory && lookup(directory, key);
    if (kept) {
      report(`hit in ${directory}`);
      // SAFETY: an entry under this key holds what `load` returned for the
      // same engine build and arguments.
      return kept as Result;
    }
  } catch {
    // Load as if nothing were kept.
  }
  const startedMs = Date.now();
  const result = load();
  if (!directory) {
    report('off: no cache folder');
    return result;
  }
  // Keeping it is only an optimisation.
  let notKept: string | null;
  try {
    notKept = store(directory, key, result, startedMs);
  } catch (error) {
    notKept = `the store failed (${String(error)})`;
  }
  if (notKept !== null) {
    report(`miss, not kept: ${notKept}`);
    return result;
  }
  let evicted = '';
  try {
    evict(directory);
  } catch (error) {
    evicted = `; the eviction failed (${String(error)})`;
  }
  report(`miss, kept in ${directory}${evicted}`);
  return result;
}
