import { existsSync, readFileSync, realpathSync } from 'node:fs';
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
  const manifests = new Map<string, Manifest | null>();
  const manifest = (dir: string): Manifest | null => {
    let found = manifests.get(dir);
    if (found === undefined) {
      try {
        // SAFETY: a package.json is a JSON object; only its dependency maps are read.
        found = JSON.parse(
          readFileSync(join(dir, 'package.json'), 'utf-8')
        ) as Manifest;
      } catch {
        found = null;
      }
      manifests.set(dir, found);
    }
    return found;
  };
  const byIdentity = new Map<string, PreparedPackage[]>();
  for (const listed of packages) {
    byIdentity.set(listed.identity, [
      ...(byIdentity.get(listed.identity) ?? []),
      listed,
    ]);
  }
  const reachedRoots = new Map<string, string[] | null>();
  const result: RegistryPackage[] = [];
  for (const [identity, instances] of byIdentity) {
    const roots = new Set<string>();
    let registry = true;
    for (const { importer, specifier } of instances) {
      const name = bareSpecifierPackageName(specifier);
      const from = dirname(
        isAbsolute(importer) ? importer : resolve(root, importer)
      );
      const installed = installedPackage(name, from);
      if (
        installed === null ||
        !insideNodeModules(installed) ||
        declaredLocally(name, from, manifest)
      ) {
        registry = false;
        break;
      }
      let reached = reachedRoots.get(installed);
      if (reached === undefined) {
        reached = localDependencies(installed, manifest);
        reachedRoots.set(installed, reached);
      }
      if (reached === null) {
        registry = false;
        break;
      }
      for (const local of reached) roots.add(local);
    }
    if (!registry) continue;
    const reaches = [...analysed].filter((file) => {
      const absolute = isAbsolute(file) ? file : resolve(root, file);
      return [...roots].some((local) => absolute.startsWith(local + sep));
    });
    result.push({ identity, reaches: reaches.sort() });
  }
  return result;
}

/** The real directory of package `name` as Node resolves it from `from`:
 *  the nearest `node_modules/<name>` above it. */
function installedPackage(name: string, from: string): string | null {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) {
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
  manifest: (dir: string) => Manifest | null
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
      const dependency = installedPackage(name, dir);
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
