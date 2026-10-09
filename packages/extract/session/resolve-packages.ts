import { existsSync, readFileSync, realpathSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';

import { parseInternalWire } from '../pipeline/internal-wire';
import { isJsonBlock, isJsonString } from '../pipeline/tsconfig-paths';

import type { JsonValue } from '../pipeline/tsconfig-paths';

/** Package specifier → rootDir-relative entry path. An unresolved specifier
 *  has no key at all, never a key with an empty target. */
export interface ResolvedPackageMap {
  [specifier: string]: string;
}

/** An exports target under the `import` condition, then `default`, as the
 *  system loader reads it; an array offers its targets in order. */
function importTarget(value: JsonValue | undefined): string | null {
  if (isJsonString(value)) return value;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const target = importTarget(entry);
      if (target !== null) return target;
    }
    return null;
  }
  if (!isJsonBlock(value)) return null;
  return importTarget(value.import) ?? importTarget(value.default);
}

/** The exports entry for `subpath`: an exact key answers alone; otherwise
 *  the pattern with the longest prefix, then the longest suffix, wins. */
function exportsTarget(exports: JsonValue, subpath: string): string | null {
  const isMap =
    isJsonBlock(exports) && Object.keys(exports).some((k) => k.startsWith('.'));
  const map = isMap ? exports : { '.': exports };
  if (subpath in map) return importTarget(map[subpath]);
  let best: { prefix: string; suffix: string; value: JsonValue } | null = null;
  for (const [pattern, value] of Object.entries(map)) {
    const star = pattern.indexOf('*');
    if (star === -1 || pattern.indexOf('*', star + 1) !== -1) continue;
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (
      !subpath.startsWith(prefix) ||
      !subpath.endsWith(suffix) ||
      subpath.length < prefix.length + suffix.length
    ) {
      continue;
    }
    if (
      !best ||
      prefix.length > best.prefix.length ||
      (prefix.length === best.prefix.length &&
        suffix.length > best.suffix.length)
    ) {
      best = { prefix, suffix, value };
    }
  }
  if (!best) return null;
  const matched = subpath.slice(
    best.prefix.length,
    subpath.length - best.suffix.length
  );
  return importTarget(best.value)?.replaceAll('*', matched) ?? null;
}

/** The entry an ES import of `name` resolves to through the package's
 *  `exports`, under the `import` condition, then `default`: what the Vite
 *  host and the system loader resolve. Null without an `exports` field, or
 *  when no target exists. */
function resolveImportEntry(rootDir: string, name: string): string | null {
  const segments = name.split('/');
  const packageName = segments.slice(0, name.startsWith('@') ? 2 : 1).join('/');
  const subpath = `.${name.slice(packageName.length)}`;
  for (let dir = rootDir; ; dir = dirname(dir)) {
    const manifest = join(dir, 'node_modules', packageName, 'package.json');
    if (existsSync(manifest)) {
      let exports: JsonValue | undefined;
      try {
        const parsed = parseInternalWire<JsonValue>(
          readFileSync(manifest, 'utf-8'),
          `${manifest} (a package manifest)`
        );
        exports = isJsonBlock(parsed) ? parsed.exports : undefined;
      } catch {
        return null;
      }
      if (exports === undefined || exports === null) return null;
      const target = exportsTarget(exports, subpath);
      if (target === null) return null;
      // Real path, as `require.resolve` and Vite return it: a workspace
      // kit is reached through a node_modules link.
      const entryPath = resolve(dirname(manifest), target);
      return existsSync(entryPath) ? realpathSync(entryPath) : null;
    }
    if (dir === dirname(dir)) return null;
  }
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

  // An ES import first, as the Vite host resolves it; `require.resolve`
  // still answers for a package without `exports` or without an import or
  // default target.
  for (const name of nameSet) {
    if (resolved.has(name)) continue;
    const importEntry = resolveImportEntry(rootDir, name);
    if (importEntry !== null) {
      packageMap[name] = relative(rootDir, importEntry);
      continue;
    }
    try {
      const entryPath = require.resolve(name, { paths: [rootDir] });
      packageMap[name] = relative(rootDir, entryPath);
    } catch {}
  }

  return packageMap;
}
