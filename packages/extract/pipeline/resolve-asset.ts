/**
 * Asset resolution for hosts with no bundler hook. Host path aliases apply
 * FIRST, so `asset('@fonts/x')` resolves as the alias does in app modules.
 */
import { existsSync } from 'fs';
import { createRequire } from 'module';
import { dirname, isAbsolute, join } from 'path';

import { parseInternalWire } from './internal-wire';

import type { PathAliasEntry } from './path-aliases';

// One require anchor per root: `createRequire` carries its own resolution
// cache, which rebuilding per call would throw away.
const requireByRoot = new Map<string, ReturnType<typeof createRequire>>();

function requireAnchoredAt(rootDir: string): ReturnType<typeof createRequire> {
  let req = requireByRoot.get(rootDir);
  if (!req) {
    req = createRequire(join(rootDir, 'package.json'));
    requireByRoot.set(rootDir, req);
  }
  return req;
}

function packageRootFromEntry(entry: string): string | null {
  let current = dirname(entry);
  while (true) {
    if (existsSync(join(current, 'package.json'))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

// Keyed by the alias JSON itself and never cleared: keying on the payload is
// what makes the unbounded cache safe — a new config mints a new key.
const aliasTableCache = new Map<string, PathAliasEntry[]>();

/**
 * A parse failure throws: an empty table would disable every alias-based
 * `asset()` and ship dangling `url()`s as a successful build.
 */
function parseAliasTable(pathAliasesJson: string): PathAliasEntry[] {
  const cached = aliasTableCache.get(pathAliasesJson);
  if (cached) return cached;
  const table = parseInternalWire<{ aliases?: PathAliasEntry[] }>(
    pathAliasesJson,
    'pathAliasesJson (the host alias table from buildPathAliasesJson)'
  );
  const aliases = table.aliases ?? [];
  aliasTableCache.set(pathAliasesJson, aliases);
  return aliases;
}

/**
 * Map a specifier through the host alias table, whose entries arrive sorted
 * longest-pattern-first. Returns an absolute path to an EXISTING file.
 */
export function resolveThroughPathAliases(
  specifier: string,
  rootDir: string,
  pathAliasesJson: string | null | undefined
): string | null {
  if (!pathAliasesJson) return null;
  const aliases = parseAliasTable(pathAliasesJson);
  for (const alias of aliases) {
    let mapped: string | null = null;
    if (alias.type === 'exact') {
      if (alias.pattern === specifier) mapped = alias.replacement;
    } else if (specifier.startsWith(alias.pattern)) {
      mapped = alias.replacement + specifier.slice(alias.pattern.length);
    }
    if (mapped === null) continue;
    const absolute = isAbsolute(mapped) ? mapped : join(rootDir, mapped);
    if (existsSync(absolute)) return absolute;
  }
  return null;
}

/**
 * Resolve an asset specifier: host aliases, then Node resolution anchored at
 * `rootDir`, then the package root. Strict gating stays at the caller.
 */
export function resolveAssetFile(
  specifier: string,
  rootDir: string,
  pathAliasesJson?: string | null
): string | null {
  const aliased = resolveThroughPathAliases(
    specifier,
    rootDir,
    pathAliasesJson
  );
  if (aliased) return aliased;

  const requireFromRoot = requireAnchoredAt(rootDir);
  try {
    return requireFromRoot.resolve(specifier);
  } catch {
    // Asset subpaths are rarely listed in exports maps.
  }

  const segments = specifier.split('/');
  const packageName = specifier.startsWith('@')
    ? segments.slice(0, 2).join('/')
    : segments[0];
  const subpath = specifier.slice(packageName.length + 1);
  if (!subpath) return null;

  // Search Node's module paths for the package directory first: a package
  // may expose only subpaths and have no `"."` export.
  for (const modulesDir of requireFromRoot.resolve.paths(packageName) ?? []) {
    const packageRoot = join(modulesDir, packageName);
    if (!existsSync(join(packageRoot, 'package.json'))) continue;
    const candidate = join(packageRoot, subpath);
    if (existsSync(candidate)) return candidate;
  }

  try {
    // Walk to the package root from an exported entry: `package.json` itself
    // is commonly hidden by an exports map.
    const packageEntry = requireFromRoot.resolve(packageName);
    const packageRoot = packageRootFromEntry(packageEntry);
    if (!packageRoot) return null;
    const candidate = join(packageRoot, subpath);
    return existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}
