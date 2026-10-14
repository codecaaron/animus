import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

import { bareSpecifierPackageName } from './discover-packages';

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
 *  by its size and modification time, which a write changes. A resolved
 *  key by the real path it resolves to. */
function read(path: string): FileRead {
  try {
    if (path.startsWith(RESOLVED)) {
      return { stamp: realpathSync.native(path.slice(RESOLVED.length)) };
    }
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
      found = read(path);
      this.#files.set(path, found);
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
   *  (`localDependencies`) or a local one (`dependencyClosure`), adding the
   *  files their walk read to `files`. */
  reached(
    installed: string,
    registry: boolean,
    files: Set<string>
  ): string[] | null {
    const key = `${registry ? 'registry' : 'local'}\0${installed}`;
    let walk = this.#walks.get(key);
    if (walk === undefined) {
      const walked = new Set<string>();
      const lookups = this.tracked(walked);
      walk = {
        roots: registry
          ? localDependencies(installed, lookups)
          : dependencyClosure(installed, lookups),
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
            // SAFETY: a package.json is a JSON object; only its dependency maps are read.
            found = text === undefined ? null : (JSON.parse(text) as Manifest);
          } catch {
            found = null;
          }
          this.#manifests.set(path, found);
        }
        return found;
      },
    };
  }
}

interface Lookups {
  exists(path: string): boolean;
  /** The real path `path` resolves to through its symlinks. */
  resolve(path: string): string | null;
  manifest(dir: string): Manifest | null;
}

type Manifest = {
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
): { reached: Set<string>; followed: Set<string> } | null {
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

/** The real roots of a local package and of each package it depends on, at
 *  any depth; null where the walk is (`walkDependencies`). */
function dependencyClosure(
  installed: string,
  lookups: Lookups
): string[] | null {
  const walk = walkDependencies(installed, lookups, {});
  return walk && [...walk.reached];
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
  analysed: ReadonlySet<string>
): PackageReach[] {
  const byIdentity = new Map<string, PreparedPackage[]>();
  for (const listed of packages) {
    byIdentity.set(listed.identity, [
      ...(byIdentity.get(listed.identity) ?? []),
      listed,
    ]);
  }
  const reads = new Reads();
  const absolutes = new Map(
    [...analysed].map((file) => [
      file,
      isAbsolute(file) ? file : resolve(root, file),
    ])
  );
  const result: PackageReach[] = [];
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
      decision = decide(root, instances, reads);
      decisions.set(key, decision);
    }
    if (decision.roots === null) continue;
    const roots = new Set(decision.roots);
    const reaches = [...absolutes]
      .filter(([, absolute]) => {
        for (let dir = dirname(absolute); ; dir = dirname(dir)) {
          if (roots.has(dir)) return true;
          if (dirname(dir) === dir) return false;
        }
      })
      .map(([file]) => file);
    result.push({
      identity,
      reaches: reaches.sort(),
      ...(decision.local && { local: true as const }),
    });
  }
  return result;
}

/** One package's decision from the filesystem, with the stamp of every
 *  file it read or looked for and of each lockfile at or above the root. */
function decide(
  root: string,
  instances: readonly PreparedPackage[],
  reads: Reads
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
    const reached = reads.reached(installed, registry, files);
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
  lookups: Pick<Lookups, 'exists' | 'resolve'>
): string | null {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (lookups.exists(join(candidate, 'package.json'))) {
      return lookups.resolve(candidate);
    }
    if (dirname(dir) === dir) return null;
  }
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
