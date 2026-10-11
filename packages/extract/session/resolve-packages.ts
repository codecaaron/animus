import { relative } from 'path';

import type { HostExtensionPolicy } from '../pipeline/host-extensions';
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

/** What a session resolves under, as system loading does: the host's
 *  export conditions, the session root's declared workspaces, and the
 *  host's extension order. */
export interface SessionResolutionContext {
  readonly conditions: readonly string[];
  readonly workspaces: WorkspacePackages;
  readonly extensions: HostExtensionPolicy;
}

/** Package resolution as the system loader resolves (the native module). */
export interface PackageResolution {
  /** A specifier, resolved from a directory. */
  resolveSpecifier(
    specifier: string,
    fromDir: string,
    context: SessionResolutionContext
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
  context: SessionResolutionContext
): ResolvedPackages {
  const packageMap: ResolvedPackageMap = {};
  const unresolved: ResolvedPackages['unresolved'] = {};
  for (const name of new Set(names)) {
    const entry = resolution.resolveSpecifier(name, rootDir, context);
    if (entry.path) packageMap[name] = relative(rootDir, entry.path);
    else unresolved[name] = entry.unresolved ?? 'it names no file';
  }
  return { entries: packageMap, unresolved };
}
