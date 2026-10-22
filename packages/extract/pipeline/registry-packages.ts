import { createHash } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { builtinModules } from 'node:module';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';

import { bareSpecifierPackageName, exportsSubpaths } from './discover-packages';
import { isJsonBlock, isJsonString, type JsonValue } from './tsconfig-paths';

/** An unread package the engine's `prepare` lists, as a module names it. */
export interface PreparedPackage {
  importer: string;
  specifier: string;
  /** As the analysis names it. */
  identity: string;
}

/** An unread package the host located, with the analysed modules it can
 *  reach (spec §6.3), as the engine's `PackageReach` reads it. `local` for
 *  a workspace package or a local link or copy. */
export interface PackageReach {
  identity: string;
  reaches: string[];
  local?: true;
}

/** The most packages a package's dependencies are followed through; past
 *  it, the package keeps its reach over every module. */
const DEPENDENCY_BOUND = 4000;

/** The most modules of local packages one package's reach reads; past it,
 *  the package keeps its reach over every module. */
const SOURCE_FILE_BOUND = 5000;

/** The modules a local package's code runs that `packageLoads` reads; a
 *  JSON file or an asset loads nothing. */
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;

/** Reads what each file of a local package loads (`packageLoads`). */
export type PackageLoadsReader = (filesJson: string) => string;

/** Dependency specs that link or copy a local package rather than install
 *  one from a registry. */
const LOCAL_PROTOCOLS = ['file:', 'link:', 'workspace:', 'portal:'];

/** The files a registry decision reads, with each one's stamp, or its
 *  absence. */
type Stamps = Map<string, string>;

/** A file's stamp, or its absence, and a `package.json`'s text, from the
 *  same read. */
interface FileRead {
  stamp: string;
  text?: string;
}

/** The prefix of a stamp key that records where a path resolves through
 *  its symlinks, rather than what the file holds. */
const RESOLVED = '\0resolved:';

/** A `package.json` by its bytes: a registry tarball's files carry one
 *  fixed modification time, so a swap of the same size keeps it. A lockfile
 *  by its size and modification time, which a write changes. (A resolved
 *  key is stamped by the real path it resolves to, in `Reads`.) */
function read(path: string): FileRead {
  try {
    if (path.endsWith('package.json')) {
      const bytes = readFileSync(path);
      return {
        stamp: createHash('sha256').update(bytes).digest('hex'),
        text: bytes.toString('utf-8'),
      };
    }
    const { size, mtimeMs } = statSync(path);
    return { stamp: `${size}:${mtimeMs}` };
  } catch {
    return { stamp: 'absent' };
  }
}

/** What is at a path, through no link: `absent` only where the
 *  filesystem says nothing is there. */
type Entry = 'absent' | 'link' | 'present' | 'unknown';

function readEntry(path: string): Entry {
  try {
    const entry = lstatSync(path, { throwIfNoEntry: false });
    if (entry === undefined) return 'absent';
    return entry.isSymbolicLink() ? 'link' : 'present';
  } catch (error) {
    return failedWith(error, ['ENOTDIR']) ? 'absent' : 'unknown';
  }
}

/** Windows spells real paths with drive letters and junctions that the
 *  snapshot does not model: there each lookup asks `realpath`. */
const MODELLED_REAL_PATHS = process.platform !== 'win32';

/** Whether link target `written` climbs (`..`) after naming a directory,
 *  which may itself be a link. A separator either way only sends more
 *  targets to the filesystem. */
function climbsAfterName(written: string): boolean {
  let named = false;
  for (const segment of written.split(/[\\/]/)) {
    if (segment === '..') {
      if (named) return true;
    } else if (segment !== '' && segment !== '.') {
      named = true;
    }
  }
  return false;
}

/** `path`'s real path; null where nothing is there, undefined where the
 *  lookup failed otherwise. */
function nativeRealPath(path: string): string | null | undefined {
  try {
    return realpathSync.native(path);
  } catch (error) {
    return failedWith(error, ['ENOENT', 'ENOTDIR']) ? null : undefined;
  }
}

/** Whether a failed filesystem call threw one of `codes`. */
function failedWith<Thrown>(error: Thrown, codes: readonly string[]): boolean {
  return (
    error instanceof Object &&
    'code' in error &&
    codes.some((code) => code === error.code)
  );
}

/** Lockfiles whose change can move what is installed. */
const LOCKFILES = [
  'bun.lock',
  'bun.lockb',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
];

/** Each package's decision, by root, identity and instances: the real
 *  roots of the packages whose analysed modules it reaches, or null for a
 *  package that may reach any module, held while every file it read is
 *  unchanged. */
interface Decision {
  stamps: Stamps;
  roots: string[] | null;
  local: boolean;
}

const decisions = new Map<string, Decision>();

/** One call's reads, shared by its decisions, as one snapshot: each file is
 *  read once, and each installed package's dependencies are walked once
 *  for each reading, with the files the walk read. Packages share most of
 *  their dependencies, so a decision of its own each walked them again. */
class Reads {
  readonly #files = new Map<string, FileRead>();
  readonly #manifests = new Map<string, Manifest | null>();
  readonly #walks = new Map<
    string,
    { roots: string[] | null; files: Set<string> }
  >();

  file(path: string): FileRead {
    let found = this.#files.get(path);
    if (found === undefined) {
      found = this.#read(path);
      this.#files.set(path, found);
    }
    return found;
  }

  /** `read`, less the reads an absence answers: a walk looks for each
   *  dependency in every `node_modules` above a package, and most hold no
   *  such package, where a failed read costs more than an `lstat`. A
   *  manifest through a link is the one at its directory's real path, read
   *  once for every link to it. */
  #read(path: string): FileRead {
    if (path.startsWith(RESOLVED)) {
      return { stamp: this.#real(path.slice(RESOLVED.length)) ?? 'absent' };
    }
    if (this.#absent(path)) return { stamp: 'absent' };
    if (!path.endsWith('package.json')) return read(path);
    const dir = dirname(path);
    const real = this.#real(dir);
    return real === null || real === undefined || real === dir
      ? read(path)
      : this.file(join(real, basename(path)));
  }

  readonly #reals = new Map<string, string | null | undefined>();
  readonly #physicals = new Map<string, string | null | undefined>();
  readonly #entries = new Map<string, Entry>();
  readonly #absences = new Map<string, boolean>();
  readonly #modulesAbove = new Map<string, string[]>();

  /** `realpathSync.native`'s answer for `path`: its real path, null where
   *  nothing is there, undefined where the lookup failed otherwise. A link
   *  is read and its target resolved once, however many links name it. */
  #real(path: string): string | null | undefined {
    if (this.#reals.has(path)) return this.#reals.get(path);
    const spelled = this.#spelled(path);
    if (spelled === undefined) return this.#native(path);
    let found: string | null | undefined = null;
    if (spelled !== null) {
      const entry = this.#entry(spelled);
      if (entry === 'link') found = this.#target(spelled);
      else if (entry !== 'absent') return this.#native(path);
    }
    this.#reals.set(path, found);
    return found;
  }

  /** A spelling of `path` through no link, where its real path is spelled
   *  only as its directories are: null where nothing is there, undefined
   *  where a lookup failed. Each directory costs one `lstat`. */
  #physical(path: string): string | null | undefined {
    if (this.#physicals.has(path)) return this.#physicals.get(path);
    let found: string | null | undefined = path;
    if (dirname(path) !== path) {
      const spelled = this.#spelled(path);
      found = spelled;
      if (spelled !== null && spelled !== undefined) {
        const entry = this.#entry(spelled);
        if (entry === 'absent') found = null;
        else if (entry === 'link') found = this.#target(spelled);
        else if (entry === 'unknown') found = this.#native(spelled);
      }
    }
    this.#physicals.set(path, found);
    return found;
  }

  /** `path` in its directory's spelling through no link: null where that
   *  directory is absent; undefined at the root, on Windows, or where a
   *  lookup failed. */
  #spelled(path: string): string | null | undefined {
    const parent = dirname(path);
    if (parent === path || !MODELLED_REAL_PATHS) return undefined;
    const dir = this.#physical(parent);
    if (dir === null || dir === undefined) return dir;
    return dir === parent ? path : join(dir, basename(path));
  }

  /** The real path of link `path`, whose directory is spelled through no
   *  link: its target's, resolved once. A `..` after a name in the target
   *  climbs from where that name leads, which may be a link, so only the
   *  filesystem resolves it; leading `..`s climb from the link's own
   *  directory. */
  #target(path: string): string | null | undefined {
    if (this.#reals.has(path)) return this.#reals.get(path);
    let target: string;
    try {
      const written = readlinkSync(path);
      if (climbsAfterName(written)) return this.#native(path);
      target = resolve(dirname(path), written);
    } catch {
      return this.#native(path);
    }
    const found = this.#reals.has(target)
      ? this.#reals.get(target)
      : this.#native(target);
    this.#reals.set(path, found);
    return found;
  }

  /** `nativeRealPath`, recording the answer for `path`, and a real path's
   *  ancestors as their own: no link lies on the way to them. */
  #native(path: string): string | null | undefined {
    const found = nativeRealPath(path);
    for (
      let real = found;
      real !== null && real !== undefined && this.#physicals.get(real) !== real;
      real = dirname(real)
    ) {
      this.#reals.set(real, real);
      this.#physicals.set(real, real);
    }
    this.#reals.set(path, found);
    return found;
  }

  #entry(path: string): Entry {
    let entry = this.#entries.get(path);
    if (entry === undefined) {
      entry = readEntry(path);
      this.#entries.set(path, entry);
    }
    return entry;
  }

  /** Whether the filesystem says nothing is at `path`. */
  #absent(path: string): boolean {
    let absent = this.#absences.get(path);
    if (absent === undefined) {
      const spelled = this.#spelled(path);
      absent =
        spelled === null ||
        (spelled !== undefined && this.#entry(spelled) === 'absent');
      this.#absences.set(path, absent);
    }
    return absent;
  }

  /** Every `node_modules` path at and above `dir`, nearest first. */
  #modules(dir: string): string[] {
    let found = this.#modulesAbove.get(dir);
    if (found === undefined) {
      const parent = dirname(dir);
      found = [join(dir, 'node_modules')];
      if (parent !== dir) found.push(...this.#modules(parent));
      this.#modulesAbove.set(dir, found);
    }
    return found;
  }

  unchanged(stamps: Stamps): boolean {
    for (const [path, stamp] of stamps) {
      if (this.file(path).stamp !== stamp) return false;
    }
    return true;
  }

  /** The roots `installed` reaches, read as a registry package
   *  (`localDependencies`) or, loaded at `subpath`, as a local one
   *  (`localReach`), adding the files their reading read to `files`. */
  reached(
    installed: string,
    registry: boolean,
    subpath: string,
    files: Set<string>,
    packageLoads?: PackageLoadsReader
  ): string[] | null {
    const key = registry
      ? `registry\0${installed}`
      : `local\0${installed}\0${subpath}`;
    let walk = this.#walks.get(key);
    if (walk === undefined) {
      const walked = new Set<string>();
      const lookups = this.tracked(walked);
      walk = {
        roots: registry
          ? localDependencies(installed, lookups)
          : packageLoads === undefined
            ? null
            : localReach(installed, subpath, lookups, packageLoads, (dir) =>
                this.reached(dir, true, '.', walked)
              ),
        files: walked,
      };
      this.#walks.set(key, walk);
    }
    for (const path of walk.files) files.add(path);
    return walk.roots;
  }

  /** Lookups that add each file they read to `files`. */
  tracked(files: Set<string>): Lookups {
    return {
      source: (path) => {
        files.add(path);
        try {
          return readFileSync(path, 'utf-8');
        } catch {
          return null;
        }
      },
      exists: (path) => {
        files.add(path);
        return this.file(path).stamp !== 'absent';
      },
      resolve: (path) => {
        const key = RESOLVED + path;
        files.add(key);
        const { stamp } = this.file(key);
        return stamp === 'absent' ? null : stamp;
      },
      manifest: (dir) => {
        const path = join(dir, 'package.json');
        files.add(path);
        let found = this.#manifests.get(path);
        if (found === undefined) {
          const { text } = this.file(path);
          try {
            // SAFETY: a package.json is a JSON object; its dependency maps
            // are read, and its entry fields only through the JSON guards.
            found = text === undefined ? null : (JSON.parse(text) as Manifest);
          } catch {
            found = null;
          }
          this.#manifests.set(path, found);
        }
        return found;
      },
      modules: (dir) => this.#modules(dir),
      absent: (path) => {
        const absent = this.#absent(path);
        if (absent) files.add(path);
        return absent;
      },
    };
  }
}

interface Lookups {
  /** A file's text, or null where it cannot be read. */
  source(path: string): string | null;
  exists(path: string): boolean;
  /** The real path `path` resolves to through its symlinks. */
  resolve(path: string): string | null;
  manifest(dir: string): Manifest | null;
  /** Every `node_modules` path at and above `dir`, nearest first. */
  modules(dir: string): readonly string[];
  /** Whether nothing is at `path`, read as a file where so: its stamp
   *  records the absence. */
  absent(path: string): boolean;
}

type Manifest = {
  main?: JsonValue;
  module?: JsonValue;
  exports?: JsonValue;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

/** Each package's answer to whether it reaches Animus, by its real root and
 *  the system's kits, held while every file it read is unchanged. */
const animusAnswers = new Map<string, { stamps: Stamps; reaches: boolean }>();

/**
 * The `located` packages foreign to Animus: neither the package nor any
 * package its dependencies, peers and optional dependencies name, at any
 * depth, is an `@animus-ui/*` package or one of the system's `kits`. Past
 * the bound a package may name any, so it reaches Animus.
 */
export function foreignPackages(
  located: ReadonlyArray<{ name: string; roots: readonly string[] }>,
  kits: ReadonlySet<string>
): string[] {
  const reads = new Reads();
  const key = [...kits].sort().join('\n');
  const animus = (name: string) =>
    name.startsWith('@animus-ui/') || kits.has(name);
  // A package is foreign only where every instance its importers reach is.
  return located
    .filter(({ name, roots }) => !animus(name) && !roots.some(reachesAnimus))
    .map(({ name }) => name)
    .sort();

  function reachesAnimus(installed: string): boolean {
    const cacheKey = `${installed}\n${key}`;
    const cached = animusAnswers.get(cacheKey);
    if (cached !== undefined && reads.unchanged(cached.stamps)) {
      return cached.reaches;
    }
    const files = lockfilesAbove(installed);
    const reaches =
      walkDependencies(installed, reads.tracked(files), {
        stops: animus,
      }) === null;
    animusAnswers.set(cacheKey, {
      stamps: new Map([...files].map((path) => [path, reads.file(path).stamp])),
      reaches,
    });
    return reaches;
  }
}

/**
 * Walks the dependencies, peers and optional dependencies `installed`
 * declares, and those of each one `follows` accepts, at any depth: the real
 * root of each package reached, `installed` among them, with those
 * followed. Null past the bound, at a manifest it cannot read, or once
 * `stops` accepts a name a followed manifest declares.
 */
function walkDependencies(
  installed: string,
  lookups: Lookups,
  {
    follows = () => true,
    stops = () => false,
  }: {
    follows?: (spec: string, dependency: string) => boolean;
    stops?: (name: string) => boolean;
  }
): {
  reached: Set<string>;
  followed: Set<string>;
} | null {
  const reached = new Set<string>([installed]);
  const followed = new Set<string>([installed]);
  const work = [installed];
  while (work.length > 0) {
    const dir = work.pop()!;
    const declared = lookups.manifest(dir);
    if (declared === null) return null;
    const specs = Object.entries(dependencySpecs(declared));
    if (specs.some(([name]) => stops(name))) return null;
    for (const [name, spec] of specs) {
      const dependency = installedPackage(name, dir, lookups);
      if (dependency === null || reached.has(dependency)) continue;
      reached.add(dependency);
      if (reached.size > DEPENDENCY_BOUND) return null;
      if (follows(spec, dependency)) {
        followed.add(dependency);
        work.push(dependency);
      }
    }
  }
  return { reached, followed };
}

/** The extensions and directory indexes a load's path may leave out. */
const RESOLVED_SUFFIXES = [
  '',
  '.js',
  '.cjs',
  '.mjs',
  '.jsx',
  '.ts',
  '.cts',
  '.mts',
  '.tsx',
  '.json',
  '/index.js',
  '/index.cjs',
  '/index.mjs',
  '/index.ts',
  '/index.tsx',
];

/**
 * The real roots of the packages a local package loaded at `subpath`
 * reaches: itself, each package its modules load at any depth, found as
 * Node finds it from the loading module, declared or not, and for one
 * installed from a registry, the local packages it depends on (`registry`).
 * A manifest is no boundary on what code loads, so the modules are read
 * from the entries the package exports for `subpath`, under every
 * condition, along each load (`packageLoads`). Null, so the package may
 * reach any module, where a module makes a computed load, runs code from a
 * string, lets a loader escape or does not parse, where a load leaves its
 * package by a path, uses a `#` import or a URL, or resolves to nothing, or
 * past the bound.
 */
function localReach(
  installed: string,
  subpath: string,
  lookups: Lookups,
  packageLoads: PackageLoadsReader,
  registry: (root: string) => string[] | null
): string[] | null {
  const roots = new Set<string>([installed]);
  const seen = new Set<string>();
  let pending: { file: string; root: string }[] = [];
  const enter = (root: string, at: string): boolean => {
    const entries = packageEntries(root, at, lookups);
    if (entries === null) return false;
    for (const file of entries) pending.push({ file, root });
    return true;
  };
  if (!enter(installed, subpath)) return null;
  while (pending.length > 0) {
    const sources: { path: string; source: string; root: string }[] = [];
    for (const { file, root } of pending) {
      if (seen.has(file)) continue;
      seen.add(file);
      if (!SOURCE_FILE.test(file)) continue;
      const source = lookups.source(file);
      if (source === null) return null;
      sources.push({ path: file, source, root });
    }
    pending = [];
    if (seen.size > SOURCE_FILE_BOUND) return null;
    if (sources.length === 0) continue;
    // SAFETY: `packageLoads` returns the engine's serde output for these files.
    const loaded = JSON.parse(
      packageLoads(
        JSON.stringify(sources.map(({ path, source }) => ({ path, source })))
      )
    ) as Record<string, { specifiers: string[]; open?: string }>;
    for (const { path: file, root } of sources) {
      const loads = loaded[file];
      if (loads === undefined || loads.open !== undefined) return null;
      for (const specifier of loads.specifiers) {
        if (specifier.startsWith('.') || specifier.startsWith('/')) {
          const target = resolveFile(
            resolve(dirname(file), specifier),
            lookups
          );
          if (target === null || !target.startsWith(root + sep)) return null;
          pending.push({ file: target, root });
          continue;
        }
        if (/^[a-z][a-z0-9+.-]*:/i.test(specifier)) {
          if (specifier.startsWith('node:')) continue;
          return null;
        }
        if (specifier.startsWith('#')) return null;
        const name = bareSpecifierPackageName(specifier);
        if (builtinModules.includes(name)) continue;
        const dependency = installedPackage(name, dirname(file), lookups);
        if (dependency === null) return null;
        roots.add(dependency);
        if (roots.size > DEPENDENCY_BOUND) return null;
        const fromRegistry =
          insideNodeModules(dependency) &&
          !declaredLocally(name, dirname(file), lookups.manifest);
        if (fromRegistry) {
          const local = registry(dependency);
          if (local === null) return null;
          for (const reached of local) roots.add(reached);
        } else if (!enter(dependency, `.${specifier.slice(name.length)}`)) {
          return null;
        }
      }
    }
  }
  return [...roots];
}

/** The files the package at `root` runs for `subpath` (`.` for the package
 *  itself): each target its `exports` maps the subpath to, under every
 *  condition but types, or without `exports`, its `main` or the path
 *  itself. Null where the manifest cannot be read, `exports` maps nothing,
 *  or a target resolves to nothing inside the package. */
function packageEntries(
  root: string,
  subpath: string,
  lookups: Lookups
): string[] | null {
  const manifest = lookups.manifest(root);
  if (manifest === null) return null;
  const targets: string[] = [];
  if (manifest.exports === undefined) {
    // Node runs `main`; a bundler may run `module` instead.
    if (subpath !== '.') targets.push(subpath);
    else {
      targets.push(isJsonString(manifest.main) ? manifest.main : 'index');
      if (isJsonString(manifest.module)) targets.push(manifest.module);
    }
  } else {
    const subpaths = exportsSubpaths({ exports: manifest.exports });
    const exact = subpaths.find(([key]) => key === subpath);
    if (exact !== undefined) {
      collectTargets(exact[1], targets, '');
    } else {
      // A pattern (`./api/*`) stands for each subpath its star matches.
      for (const [key, value] of subpaths) {
        const star = key.indexOf('*');
        if (star === -1) continue;
        const before = key.slice(0, star);
        const after = key.slice(star + 1);
        if (
          subpath.length >= before.length + after.length &&
          subpath.startsWith(before) &&
          subpath.endsWith(after)
        ) {
          const match = subpath.slice(
            before.length,
            subpath.length - after.length
          );
          collectTargets(value, targets, match);
        }
      }
    }
    if (targets.length === 0) return null;
  }
  const files: string[] = [];
  for (const target of targets) {
    const file = resolveFile(resolve(root, target), lookups);
    if (file === null || !file.startsWith(root + sep)) return null;
    files.push(file);
  }
  return files;
}

/** Each path an `exports` value names under any condition but types, with
 *  a pattern's star as `match`. */
function collectTargets(value: JsonValue, targets: string[], match: string) {
  if (isJsonString(value)) {
    targets.push(value.replaceAll('*', match));
  } else if (Array.isArray(value)) {
    for (const item of value) collectTargets(item, targets, match);
  } else if (isJsonBlock(value)) {
    for (const [condition, nested] of Object.entries(value)) {
      if (condition !== 'types' && condition !== 'typings') {
        collectTargets(nested, targets, match);
      }
    }
  }
}

/** The file a load of `path` opens, at its real path, trying the
 *  extensions and directory indexes a load may leave out; null where none
 *  is a file. Node runs a module at its real path, so a symbolic link in a
 *  package that points outside it loads a module outside it. */
function resolveFile(path: string, lookups: Lookups): string | null {
  for (const suffix of RESOLVED_SUFFIXES) {
    const file = path + suffix;
    if (lookups.exists(file) && lookups.source(file) !== null) {
      return lookups.resolve(file);
    }
  }
  return null;
}

/** Every lockfile path at or above `dir`. */
function lockfilesAbove(dir: string): Set<string> {
  const files = new Set<string>();
  for (; ; dir = dirname(dir)) {
    for (const lockfile of LOCKFILES) files.add(join(dir, lockfile));
    if (dirname(dir) === dir) return files;
  }
}

/** The dependencies, peers and optional dependencies a manifest declares;
 *  a name in more than one keeps its `dependencies` spec. */
function dependencySpecs(declared: Manifest | null) {
  return {
    ...declared?.optionalDependencies,
    ...declared?.peerDependencies,
    ...declared?.dependencies,
  };
}

/**
 * The analysed modules each listed package can reach (spec §6.3, A4). One
 * the host installed from a registry, resolved through `node_modules` to a
 * real path inside one and declared by its importer's nearest manifest that
 * names it, if any, with no local protocol, names only published packages,
 * so of the app's own modules it reaches only those of the local packages
 * it, or a registry package it depends on, declares as a dependency or
 * peer. Any other, a workspace package or a local link or copy, reaches the
 * modules of itself and of each package it depends on, at any depth: the
 * app's among them when it depends on the app. A package that resolves to
 * nothing, or whose dependencies cannot be read, is left out: it may reach
 * any module. `root` is the session root's real path, which relative paths
 * resolve against.
 */
export function packageReaches(
  root: string,
  packages: readonly PreparedPackage[],
  analysed: ReadonlySet<string>,
  packageLoads?: PackageLoadsReader
): PackageReach[] {
  const byIdentity = new Map<string, PreparedPackage[]>();
  for (const listed of packages) {
    byIdentity.set(listed.identity, [
      ...(byIdentity.get(listed.identity) ?? []),
      listed,
    ]);
  }
  const reads = new Reads();
  // A package's roots are real paths, so each analysed file is compared at
  // its real path: one a symlinked directory holds is inside the package
  // the link names. Its key stays the analysis's own.
  let canonical: Map<string, string> | undefined;
  const absolutes = () =>
    (canonical ??= new Map(
      [...analysed].map((file) => {
        const absolute = isAbsolute(file) ? file : resolve(root, file);
        try {
          return [file, realpathSync.native(absolute)];
        } catch {
          return [file, absolute];
        }
      })
    ));
  const result: PackageReach[] = [];
  // Each package's roots, by directory: an analysed file reaches every
  // package with a root among its ancestors, so each file's ancestors are
  // walked once for all of them.
  const byRoot = new Map<string, string[][]>();
  for (const [identity, instances] of byIdentity) {
    const key = [
      root,
      identity,
      ...instances.map(
        ({ importer, specifier }) => `${importer}\0${specifier}`
      ),
    ].join('\n');
    let decision = decisions.get(key);
    if (decision === undefined || !reads.unchanged(decision.stamps)) {
      decision = decide(root, instances, reads, packageLoads);
      decisions.set(key, decision);
    }
    if (decision.roots === null) continue;
    const reaches: string[] = [];
    for (const packageRoot of new Set(decision.roots)) {
      byRoot.set(packageRoot, [...(byRoot.get(packageRoot) ?? []), reaches]);
    }
    result.push({
      identity,
      reaches,
      ...(decision.local && { local: true as const }),
    });
  }
  if (result.length === 0) return result;
  for (const [file, absolute] of absolutes()) {
    // A package with several roots above a file takes it once.
    const reached = new Set<string[]>();
    for (let dir = dirname(absolute); ; dir = dirname(dir)) {
      for (const reaches of byRoot.get(dir) ?? []) reached.add(reaches);
      if (dirname(dir) === dir) break;
    }
    for (const reaches of reached) reaches.push(file);
  }
  for (const { reaches } of result) reaches.sort();
  return result;
}

/** One package's decision from the filesystem, with the stamp of every
 *  file it read or looked for and of each lockfile at or above the root. */
function decide(
  root: string,
  instances: readonly PreparedPackage[],
  reads: Reads,
  packageLoads: PackageLoadsReader | undefined
): Decision {
  const files = lockfilesAbove(root);
  const lookups = reads.tracked(files);
  const decided = (roots: string[] | null, local = false): Decision => ({
    stamps: new Map([...files].map((path) => [path, reads.file(path).stamp])),
    roots,
    local,
  });
  let local = false;
  const roots = new Set<string>();
  for (const { importer, specifier } of instances) {
    const name = bareSpecifierPackageName(specifier);
    const from = dirname(
      isAbsolute(importer) ? importer : resolve(root, importer)
    );
    const installed = installedPackage(name, from, lookups);
    if (installed === null) return decided(null);
    const registry =
      insideNodeModules(installed) &&
      !declaredLocally(name, from, lookups.manifest);
    const subpath = `.${specifier.slice(name.length)}`;
    const reached = reads.reached(
      installed,
      registry,
      subpath,
      files,
      packageLoads
    );
    if (reached === null) return decided(null);
    local ||= !registry;
    for (const dependency of reached) roots.add(dependency);
  }
  return decided([...roots], local);
}

/** The real directory of package `name` as Node resolves it from `from`:
 *  the nearest `node_modules/<name>` above it. */
function installedPackage(
  name: string,
  from: string,
  lookups: Pick<Lookups, 'exists' | 'resolve' | 'modules' | 'absent'>
): string | null {
  for (const modules of lookups.modules(from)) {
    // An absent `node_modules` holds no package: it stands in for every
    // manifest it would hold.
    if (lookups.absent(modules)) continue;
    const candidate = join(modules, name);
    if (lookups.exists(join(candidate, 'package.json'))) {
      return lookups.resolve(candidate);
    }
  }
  return null;
}

function insideNodeModules(dir: string): boolean {
  return dir.split(sep).includes('node_modules');
}

/** Whether the nearest manifest above `from` that names `name` declares it
 *  with a local protocol. */
function declaredLocally(
  name: string,
  from: string,
  manifest: (dir: string) => Manifest | null
): boolean {
  for (let dir = from; ; dir = dirname(dir)) {
    const declared = manifest(dir);
    const spec =
      declared?.dependencies?.[name] ??
      declared?.devDependencies?.[name] ??
      declared?.peerDependencies?.[name] ??
      declared?.optionalDependencies?.[name];
    if (spec !== undefined) {
      return LOCAL_PROTOCOLS.some((protocol) => spec.startsWith(protocol));
    }
    if (dirname(dir) === dir) return false;
  }
}

/** The real roots of the local packages a registry package reaches through
 *  the dependencies and peers it and its registry dependencies declare;
 *  null where the walk is (`walkDependencies`). */
function localDependencies(
  installed: string,
  lookups: Lookups
): string[] | null {
  // A local protocol links or copies a local package, wherever it lands.
  const walk = walkDependencies(installed, lookups, {
    follows: (spec, dependency) =>
      !LOCAL_PROTOCOLS.some((protocol) => spec.startsWith(protocol)) &&
      insideNodeModules(dependency),
  });
  return walk && [...walk.reached].filter((root) => !walk.followed.has(root));
}
