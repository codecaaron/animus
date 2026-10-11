import { relative } from 'path';

import type { WorkspacePackages } from '../pipeline/workspace-packages';

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
 *  under the host's export conditions and the session root's declared
 *  workspaces. */
export interface PackageResolution {
  /** A specifier, resolved from a directory. */
  resolveSpecifier(
    specifier: string,
    fromDir: string,
    conditions: readonly string[],
    workspaces: WorkspacePackages
  ): ResolvedFile;
}

/** The packages a session includes: each entry, and for each package that
 *  names no file, why. */
export interface ResolvedPackages {
  entries: ResolvedPackageMap;
  unresolved: { [specifier: string]: string };
}

/** Each package resolved as the system loader resolves it: from
 *  `node_modules`, then a declared workspace, selecting its `animus` source
 *  condition first, then the host's conditions, `import` and `default`, then
 *  `module` before `main`. */
export function resolvePackagesByName(
  rootDir: string,
  names: string[],
  resolution: PackageResolution,
  conditions: readonly string[],
  workspaces: WorkspacePackages
): ResolvedPackages {
  const packageMap: ResolvedPackageMap = {};
  const unresolved: ResolvedPackages['unresolved'] = {};
  for (const name of new Set(names)) {
    const entry = resolution.resolveSpecifier(
      name,
      rootDir,
      conditions,
      workspaces
    );
    if (entry.path) packageMap[name] = relative(rootDir, entry.path);
    else unresolved[name] = entry.unresolved ?? 'it names no file';
  }
  return { entries: packageMap, unresolved };
}
