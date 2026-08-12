import { existsSync, readFileSync } from 'fs';
import { join, relative, resolve } from 'path';

/**
 * Resolve external DS package specifiers to rootDir-relative entry paths.
 * Node-generic (no webpack APIs): Pass 1 walks the consumer's workspaces for
 * matching package names; Pass 2 falls back to `require.resolve`. Specifiers
 * that resolve nowhere are simply omitted (spec: silent skip).
 */
export function resolvePackagesByName(
  rootDir: string,
  names: string[]
): Record<string, string> {
  if (names.length === 0) return {};

  const nameSet = new Set(names);
  const resolved = new Set<string>();
  const packageMap: Record<string, string> = {};

  // Pass 1: workspace resolution
  try {
    const rootPkg = JSON.parse(
      readFileSync(join(rootDir, 'package.json'), 'utf-8')
    );
    // Both workspace forms: ["packages/*"] and { packages: ["packages/*"] }.
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
      } catch {
        // Benign existence probe: a workspace entry without a readable
        // package.json simply contributes no package — skip it.
      }
    }
  } catch {
    // Benign existence probe: no readable root package.json means no
    // workspace resolution; Pass 2 (require.resolve) still runs.
  }

  // Pass 2: require.resolve fallback for non-workspace packages
  for (const name of nameSet) {
    if (resolved.has(name)) continue;
    try {
      const entryPath = require.resolve(name, { paths: [rootDir] });
      packageMap[name] = relative(rootDir, entryPath);
    } catch {
      // Benign resolution probe: require.resolve throws for an
      // unresolvable specifier — that package just goes unmapped.
    }
  }

  return packageMap;
}
