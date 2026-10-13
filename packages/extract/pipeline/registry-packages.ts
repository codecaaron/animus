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

/** An unread package the host installed from a registry, with the analysed
 *  modules it can reach (spec §6.3), as the engine's `RegistryPackage`
 *  reads it. */
export interface RegistryPackage {
  identity: string;
  reaches: string[];
}

/** The most packages a registry package's dependencies are followed
 *  through; past it, the package keeps its reach over every module. */
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

/** A `package.json` by its bytes: a registry tarball's files carry one
 *  fixed modification time, so a swap of the same size keeps it. A lockfile
 *  by its size and modification time, which a write changes. */
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

/** Lockfiles whose change can move what is installed. */
const LOCKFILES = [
  'bun.lock',
  'bun.lockb',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
];

/** Each package's registry decision, by root, identity and instances:
 *  the real roots of the local packages it reaches, or null for a package
 *  that may reach any module, held while every file it read is unchanged. */
interface Decision {
  stamps: Stamps;
  roots: string[] | null;
}

const decisions = new Map<string, Decision>();

/** One call's reads, shared by its decisions, as one snapshot: each file is
 *  read once, and each installed package's local dependencies are walked
 *  once, with the files the walk read. Registry packages share most of
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

  /** `installed`'s local dependencies, adding the files their walk read to
   *  `files`. */
  localDependencies(installed: string, files: Set<string>): string[] | null {
    let walk = this.#walks.get(installed);
    if (walk === undefined) {
      const walked = new Set<string>();
      walk = {
        roots: localDependencies(installed, this.tracked(walked)),
        files: walked,
      };
      this.#walks.set(installed, walk);
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
  manifest(dir: string): Manifest | null;
}

type Manifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

/**
 * Each listed package every instance of which the host installed from a
 * registry (spec §6.3, A4): resolved through `node_modules` to a real path
 * inside one, and declared by its importer's nearest manifest that names it,
 * if any, with no local protocol. Such a package names only published
 * packages, so of the app's own modules it reaches only those of the local
 * packages it, or a registry package it depends on, declares as a
 * dependency or peer. A package that resolves to nothing, or to a local
 * path, is left out: it may reach any module. `root` is the session root's
 * real path, which relative paths resolve against.
 */
export function registryPackages(
  root: string,
  packages: readonly PreparedPackage[],
  analysed: ReadonlySet<string>
): RegistryPackage[] {
  const byIdentity = new Map<string, PreparedPackage[]>();
  for (const listed of packages) {
    byIdentity.set(listed.identity, [
      ...(byIdentity.get(listed.identity) ?? []),
      listed,
    ]);
  }
  const reads = new Reads();
  const result: RegistryPackage[] = [];
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
    const roots = decision.roots;
    const reaches = [...analysed].filter((file) => {
      const absolute = isAbsolute(file) ? file : resolve(root, file);
      return roots.some((local) => absolute.startsWith(local + sep));
    });
    result.push({ identity, reaches: reaches.sort() });
  }
  return result;
}

/** One package's registry decision from the filesystem, with the stamp of
 *  every file it read or looked for and of each lockfile at or above the
 *  root. */
function decide(
  root: string,
  instances: readonly PreparedPackage[],
  reads: Reads
): Decision {
  const files = new Set<string>();
  for (let dir = root; ; dir = dirname(dir)) {
    for (const lockfile of LOCKFILES) files.add(join(dir, lockfile));
    if (dirname(dir) === dir) break;
  }
  const lookups = reads.tracked(files);
  const decided = (roots: string[] | null): Decision => ({
    stamps: new Map([...files].map((path) => [path, reads.file(path).stamp])),
    roots,
  });
  const roots = new Set<string>();
  for (const { importer, specifier } of instances) {
    const name = bareSpecifierPackageName(specifier);
    const from = dirname(
      isAbsolute(importer) ? importer : resolve(root, importer)
    );
    const installed = installedPackage(name, from, lookups.exists);
    if (
      installed === null ||
      !insideNodeModules(installed) ||
      declaredLocally(name, from, lookups.manifest)
    ) {
      return decided(null);
    }
    const reached = reads.localDependencies(installed, files);
    if (reached === null) return decided(null);
    for (const local of reached) roots.add(local);
  }
  return decided([...roots]);
}

/** The real directory of package `name` as Node resolves it from `from`:
 *  the nearest `node_modules/<name>` above it. */
function installedPackage(
  name: string,
  from: string,
  exists: (path: string) => boolean
): string | null {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (exists(join(candidate, 'package.json'))) {
      try {
        return realpathSync.native(candidate);
      } catch {
        return null;
      }
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
 *  null past the bound. */
function localDependencies(
  installed: string,
  { manifest, exists }: Lookups
): string[] | null {
  const local = new Set<string>();
  const seen = new Set<string>([installed]);
  const work = [installed];
  while (work.length > 0) {
    const dir = work.pop()!;
    const declared = manifest(dir);
    const specs = {
      ...declared?.optionalDependencies,
      ...declared?.peerDependencies,
      ...declared?.dependencies,
    };
    for (const [name, spec] of Object.entries(specs)) {
      const dependency = installedPackage(name, dir, exists);
      if (dependency === null || seen.has(dependency)) continue;
      seen.add(dependency);
      if (seen.size > DEPENDENCY_BOUND) return null;
      // A local protocol links or copies a local package, wherever it lands.
      const linked = LOCAL_PROTOCOLS.some((protocol) =>
        spec.startsWith(protocol)
      );
      if (!linked && insideNodeModules(dependency)) work.push(dependency);
      else local.add(dependency);
    }
  }
  return [...local];
}
