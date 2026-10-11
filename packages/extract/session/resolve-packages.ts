import { existsSync, readFileSync } from 'fs';
import { join, relative, resolve } from 'path';

/** Package specifier → rootDir-relative entry path. An unresolved specifier
 *  has no key at all, never a key with an empty target. */
export interface ResolvedPackageMap {
  [specifier: string]: string;
}

/** A file a resolution names, by its real path, or why it names none. */
export interface ResolvedFile {
  path?: string | null;
  unresolved?: string | null;
}

/** Package resolution as the system loader resolves (the native module),
 *  under the host's export conditions. */
export interface PackageResolution {
  /** A specifier, resolved from a directory. */
  resolveSpecifier(
    specifier: string,
    fromDir: string,
    conditions: readonly string[]
  ): ResolvedFile;
  /** The root entry of the package in a directory, located some other way. */
  resolvePackageEntry(
    packageDir: string,
    conditions: readonly string[]
  ): ResolvedFile;
}

/** The packages a session includes: each entry, and for each package that
 *  names no file, why. */
export interface ResolvedPackages {
  entries: ResolvedPackageMap;
  unresolved: { [specifier: string]: string };
}

/** The session root's declared workspace directories; none when its
 *  manifest is absent or declares none. */
function workspaceDirs(rootDir: string): string[] {
  try {
    const rootPkg = JSON.parse(
      readFileSync(join(rootDir, 'package.json'), 'utf-8')
    );
    const workspaces: string[] = Array.isArray(rootPkg.workspaces)
      ? rootPkg.workspaces
      : (rootPkg.workspaces?.packages ?? []);
    return workspaces.map((ws) => resolve(rootDir, ws));
  } catch {
    return [];
  }
}

/** A workspace directory's package name; null for a directory that holds
 *  no readable manifest, which is no package. */
function workspaceName(wsDir: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(wsDir, 'package.json'), 'utf-8'));
    return pkg.name || null;
  } catch {
    return null;
  }
}

export function resolvePackagesByName(
  rootDir: string,
  names: string[],
  resolution: PackageResolution,
  conditions: readonly string[]
): ResolvedPackages {
  const packageMap: ResolvedPackageMap = {};
  const unresolved: ResolvedPackages['unresolved'] = {};
  if (names.length === 0) return { entries: packageMap, unresolved };

  const nameSet = new Set(names);
  const resolved = new Set<string>();
  // Why a located workspace package named no entry: its own evidence wins
  // over the installed lookup's when neither finds a file.
  const workspaceFailures = new Map<string, string>();

  // The walk locates a workspace package; the loader selects its entry.
  for (const wsDir of workspaceDirs(rootDir)) {
    if (!existsSync(wsDir)) continue;
    const name = workspaceName(wsDir);
    if (name === null || !nameSet.has(name)) continue;
    const entry = resolution.resolvePackageEntry(wsDir, conditions);
    if (entry.path) {
      packageMap[name] = relative(rootDir, entry.path);
      resolved.add(name);
    } else {
      workspaceFailures.set(
        name,
        entry.unresolved ??
          `${join(wsDir, 'package.json')} selects no entry file`
      );
    }
  }

  // Every other package resolves as the system loader resolves it: its
  // `animus` source condition first, then the host's conditions, `import`
  // and `default`, then `module` before `main`.
  for (const name of nameSet) {
    if (resolved.has(name)) continue;
    const entry = resolution.resolveSpecifier(name, rootDir, conditions);
    if (entry.path) packageMap[name] = relative(rootDir, entry.path);
    else {
      unresolved[name] =
        workspaceFailures.get(name) ?? entry.unresolved ?? 'it names no file';
    }
  }

  return { entries: packageMap, unresolved };
}
