import {
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  utimesSync,
} from 'fs';
import { dirname, join } from 'path';

import { contentHash } from './content-hash';
import { writeAtomically } from './write-atomically';

/** The entries one project keeps; the least recently used goes first. */
export const SYSTEM_LOAD_CACHE_ENTRIES = 4;

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

/** The entries for `key`, most recently used first. */
function candidates(directory: string, key: string): string[] {
  return readdirSync(directory)
    .filter((name) => name.startsWith(`${key}.`) && name.endsWith('.json'))
    .map((name) => join(directory, name))
    .map((path) => ({ path, used: statSync(path).mtimeMs }))
    .sort((a, b) => b.used - a.used)
    .map(({ path }) => path);
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
  for (const path of candidates(directory, key)) {
    let entry: Entry;
    try {
      // SAFETY: `store` writes every entry in this shape, under a key that
      // names the shape; anything else throws below and misses.
      entry = JSON.parse(readFileSync(path, 'utf8')) as Entry;
    } catch {
      // A partial or corrupt entry is a miss.
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

/** Keeps `result` unless it read something that varies per load, or what
 *  it read moved while it ran: a file it read changed shortly before or
 *  while it ran, a file appeared where it found none, or a link it passed
 *  through now leads elsewhere. A directory's own time is no file's
 *  content, and git touches `.git`'s on every command. */
function store(
  directory: string,
  key: string,
  result: LoaderResult,
  startedMs: number
): void {
  if (result.volatile && result.volatile.length > 0) return;
  const paths: Record<string, string> = {};
  for (const path of result.dependencies ?? []) {
    const stats = statSync(path, { throwIfNoEntry: false });
    if (stats?.isFile() && stats.mtimeMs > startedMs - SYSTEM_LOAD_SETTLE_MS) {
      return;
    }
    paths[path] = observe(path);
  }
  for (const path of result.missing ?? []) {
    paths[path] = observe(path);
    if (paths[path].startsWith('file:')) return;
  }
  for (const [path, real] of Object.entries(result.links ?? {})) {
    paths[path] = observeLink(path);
    if (paths[path] !== `link:${real}`) return;
  }
  const entry: Entry = { paths, result };
  const name = `${key}.${contentHash(JSON.stringify(paths))}.json`;
  writeAtomically(join(directory, name), JSON.stringify(entry));
  evict(directory);
}

/** Keeps the most recently used entries, and drops what a writer that
 *  stopped between write and rename left an hour ago or more. */
function evict(directory: string): void {
  const names = readdirSync(directory);
  const hourAgo = Date.now() - 60 * 60 * 1000;
  for (const name of names) {
    const path = join(directory, name);
    if (name.endsWith('.tmp') && statSync(path).mtimeMs < hourAgo) {
      unlinkSync(path);
    }
  }
  const entries = names
    .filter((name) => name.endsWith('.json'))
    .map((name) => join(directory, name))
    .map((path) => ({ path, used: statSync(path).mtimeMs }))
    .sort((a, b) => b.used - a.used);
  for (const { path } of entries.slice(SYSTEM_LOAD_CACHE_ENTRIES)) {
    unlinkSync(path);
  }
}

/**
 * The loader's result for these arguments: a kept result while every path
 * the load read or found missing holds what it held, else a fresh load,
 * kept for next time unless a path it read changed just before or while it
 * ran. The key is the engine build, which names the loader's code, every
 * argument the loader takes, and the host's time zone, which a local-time
 * date reads. Nothing is kept for an engine without a build id, for a
 * project outside any `node_modules`, or for a load that read the clock or
 * `Math.random`; a failed load throws as it would. The cache never fails a
 * load: an unreadable or unwritable cache only loads.
 */
export function cachedSystemLoad<Result extends LoaderResult>(
  buildId: string | undefined,
  rootDir: string,
  args: readonly KeyPart[],
  load: () => Result
): Result {
  if (!buildId) return load();
  // The host's time zone, as a local-time date reads it, in winter and in
  // summer; `Intl` would cost more than a hit.
  const zone = `${new Date(0)}|${new Date(15552000000)}`;
  const key = contentHash(
    canonicalJson([ENTRY_FORMAT, buildId, zone, ...args])
  );
  let directory: string | null = null;
  try {
    directory = cacheDirectory(rootDir);
    const kept = directory && lookup(directory, key);
    if (kept) {
      // SAFETY: an entry under this key holds what `load` returned for the
      // same engine build and arguments.
      return kept as Result;
    }
  } catch {
    // Load as if nothing were kept.
  }
  const startedMs = Date.now();
  const result = load();
  if (!directory) return result;
  try {
    store(directory, key, result, startedMs);
  } catch {
    // Keeping it is only an optimisation.
  }
  return result;
}
