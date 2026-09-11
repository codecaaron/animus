import { existsSync, readFileSync } from 'fs';
import { join, relative, resolve } from 'path';

/** Package specifier → rootDir-relative entry path. An unresolved specifier
 *  has no key at all, never a key with an empty target. */
export interface ResolvedPackageMap {
  [specifier: string]: string;
}

export function resolvePackagesByName(
  rootDir: string,
  names: string[]
): ResolvedPackageMap {
  if (names.length === 0) return {};

  const nameSet = new Set(names);
  const resolved = new Set<string>();
  const packageMap: ResolvedPackageMap = {};

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

  for (const name of nameSet) {
    if (resolved.has(name)) continue;
    try {
      const entryPath = require.resolve(name, { paths: [rootDir] });
      packageMap[name] = relative(rootDir, entryPath);
    } catch {}
  }

  return packageMap;
}
