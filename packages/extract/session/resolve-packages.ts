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

/** A specifier resolved as the system loader resolves it (the native
 *  module's `resolveSpecifier`), under the host's export conditions. */
export type ResolveSpecifier = (
  specifier: string,
  fromDir: string,
  conditions: readonly string[]
) => ResolvedFile;

/** The packages a session includes: each entry, and for each package that
 *  names no file, why. */
export interface ResolvedPackages {
  entries: ResolvedPackageMap;
  unresolved: { [specifier: string]: string };
}

export function resolvePackagesByName(
  rootDir: string,
  names: string[],
  resolveSpecifier: ResolveSpecifier,
  conditions: readonly string[]
): ResolvedPackages {
  const packageMap: ResolvedPackageMap = {};
  const unresolved: ResolvedPackages['unresolved'] = {};
  if (names.length === 0) return { entries: packageMap, unresolved };

  const nameSet = new Set(names);
  const resolved = new Set<string>();

  try {
    const rootPkg = JSON.parse(
      readFileSync(join(rootDir, 'package.json'), 'utf-8')
    );
    const workspaces: string[] = Array.isArray(rootPkg.workspaces)
      ? rootPkg.workspaces
      : (rootPkg.workspaces?.packages ?? []);

    for (const ws of workspaces) {
      const wsDir = resolve(rootDir, ws);
      if (!existsSync(wsDir)) continue;

      try {
        const pkg = JSON.parse(
          readFileSync(join(wsDir, 'package.json'), 'utf-8')
        );
        const name: string = pkg.name || '';

        if (nameSet.has(name)) {
          const main = pkg.main || pkg.module || 'index.ts';
          const entryPath = resolve(wsDir, main);
          if (existsSync(entryPath)) {
            packageMap[name] = relative(rootDir, entryPath);
            resolved.add(name);
          }
        }
      } catch {}
    }
  } catch {}

  // Every other package resolves as the system loader resolves it: its
  // `animus` source condition first, then the host's conditions, `import`
  // and `default`, then `module` before `main`.
  for (const name of nameSet) {
    if (resolved.has(name)) continue;
    const entry = resolveSpecifier(name, rootDir, conditions);
    if (entry.path) packageMap[name] = relative(rootDir, entry.path);
    else unresolved[name] = entry.unresolved ?? 'it names no file';
  }

  return { entries: packageMap, unresolved };
}
