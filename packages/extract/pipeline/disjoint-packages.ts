import { existsSync, readFileSync } from 'fs';
import { dirname, join, sep } from 'path';

import { contentHash } from './content-hash';
import { locatePackageRoot, readPackageManifest } from './discover-packages';
import { isJsonBlock, isJsonString } from './tsconfig-paths';

import type { JsonValue } from './tsconfig-paths';

/** The lockfiles a package manager writes beside its workspace root. */
const LOCKFILES = [
  'bun.lock',
  'bun.lockb',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
];

/** A package's dependency names in one of its manifest's fields. */
function dependencyNames(manifest: JsonValue | null, field: string): string[] {
  const deps = isJsonBlock(manifest) ? manifest[field] : undefined;
  return isJsonBlock(deps) ? Object.keys(deps) : [];
}

/** Whether the manifest marks peer `name` optional. */
function optionalPeer(manifest: JsonValue | null, name: string): boolean {
  const meta = isJsonBlock(manifest)
    ? manifest.peerDependenciesMeta
    : undefined;
  const entry = isJsonBlock(meta) ? meta[name] : undefined;
  return isJsonBlock(entry) && entry.optional === true;
}

/**
 * The packages, by name, that import no module the analysis holds, from
 * the dependency graph of each root: the analysis root and every analysed
 * package. A package is disjoint when every package its installed closure
 * reaches (its dependencies, peers and optional dependencies, transitively,
 * each located from its dependent's real directory) is installed under
 * `node_modules`, has a readable manifest, and is none of `analysed`. A
 * linked package, whose real path lies outside `node_modules`, may import
 * any workspace file, so it and what reaches it are not disjoint; so is
 * one whose required dependency is missing. A missing optional dependency
 * or optional peer is not installed, so nothing loads it. A name is listed
 * only when every installed copy of it is disjoint.
 */
export function disjointPackages(
  roots: readonly string[],
  analysed: ReadonlySet<string>
): string[] {
  const verdicts = new Map<string, boolean>();
  const visiting = new Set<string>();
  const byName = new Map<string, boolean>();
  const judge = (
    name: string,
    dir: string | null,
    optional: boolean
  ): boolean => {
    if (analysed.has(name)) return false;
    if (dir === null) return optional;
    const known = verdicts.get(dir);
    if (known !== undefined) return known;
    // A cycle back to a package being judged adds nothing new.
    if (visiting.has(dir)) return true;
    visiting.add(dir);
    const manifest = readPackageManifest(dir);
    let disjoint = manifest !== null && dir.split(sep).includes('node_modules');
    for (const [field, fieldOptional] of [
      ['dependencies', false],
      ['peerDependencies', false],
      ['optionalDependencies', true],
    ] as const) {
      for (const dep of dependencyNames(manifest, field)) {
        if (!disjoint) break;
        const depOptional = fieldOptional || optionalPeer(manifest, dep);
        disjoint = judge(dep, locatePackageRoot(dep, dir), depOptional);
      }
    }
    visiting.delete(dir);
    verdicts.set(dir, disjoint);
    byName.set(name, (byName.get(name) ?? true) && disjoint);
    return disjoint;
  };
  for (const root of roots) {
    const manifest = readPackageManifest(root);
    for (const field of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ]) {
      for (const dep of dependencyNames(manifest, field)) {
        judge(dep, locatePackageRoot(dep, root), false);
      }
    }
  }
  return [...byName]
    .filter(([, disjoint]) => disjoint)
    .map(([name]) => name)
    .sort();
}

/**
 * What the disjoint packages of `roots` depend on, by content: each root's
 * manifest and the nearest lockfile above each, so an install recomputes
 * them.
 */
export function disjointPackagesKey(roots: readonly string[]): string {
  const parts: string[] = [];
  const lockfiles = new Set<string>();
  for (const root of roots) {
    parts.push(root, readOrEmpty(join(root, 'package.json')));
    const lockfile = nearestLockfile(root);
    if (lockfile) lockfiles.add(lockfile);
  }
  for (const lockfile of [...lockfiles].sort()) {
    parts.push(lockfile, readOrEmpty(lockfile));
  }
  return contentHash(parts.join('\0'));
}

function nearestLockfile(from: string): string | null {
  for (let dir = from; ; dir = dirname(dir)) {
    const found = LOCKFILES.map((name) => join(dir, name)).find(existsSync);
    if (found) return found;
    if (dir === dirname(dir)) return null;
  }
}

function readOrEmpty(path: string): string {
  try {
    return readFileSync(path, 'latin1');
  } catch {
    return '';
  }
}

/** The package names `roots` declare: the analysed packages' own names. */
export function declaredPackageNames(roots: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const root of roots) {
    const manifest = readPackageManifest(root);
    const name = isJsonBlock(manifest) ? manifest.name : undefined;
    if (isJsonString(name)) names.add(name);
  }
  return names;
}
