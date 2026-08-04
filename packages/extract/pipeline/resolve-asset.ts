/**
 * Node-side asset specifier resolution shared by the host plugins (the
 * asset() contract, global-styles-system): host path aliases apply FIRST —
 * an alias such as `@fonts` works in application modules, so
 * `asset('@fonts/inter.woff2')` must resolve identically — then direct Node
 * resolution, then the package-root fallback (exports maps rarely list
 * asset subpaths). Bundler-native resolution (Vite's `this.resolve`) is
 * still preferred where available; this resolver covers the paths that have
 * no bundler hook (Next's session, Vite's dev re-analysis).
 */
import { existsSync } from 'fs';
import { createRequire } from 'module';
import { dirname, isAbsolute, join } from 'path';

import type { PathAliasEntry } from './path-aliases';

// One resolution context per root — `createRequire` builds a module system
// anchor with its own cache, so reconstructing it per call throws that
// cache away.
const requireByRoot = new Map<string, ReturnType<typeof createRequire>>();

function requireAnchoredAt(rootDir: string): ReturnType<typeof createRequire> {
  let req = requireByRoot.get(rootDir);
  if (!req) {
    req = createRequire(join(rootDir, 'package.json'));
    requireByRoot.set(rootDir, req);
  }
  return req;
}

// Per-call memo: the alias JSON is a stable string per config lifecycle and
// resolution runs once per specifier, so parse each distinct table once.
const aliasTableCache = new Map<string, PathAliasEntry[]>();

function parseAliasTable(pathAliasesJson: string): PathAliasEntry[] {
  const cached = aliasTableCache.get(pathAliasesJson);
  if (cached) return cached;
  let aliases: PathAliasEntry[];
  try {
    aliases =
      (JSON.parse(pathAliasesJson) as { aliases?: PathAliasEntry[] }).aliases ??
      [];
  } catch {
    aliases = [];
  }
  aliasTableCache.set(pathAliasesJson, aliases);
  return aliases;
}

/**
 * Map a specifier through the harvested host alias table (the same
 * `pathAliasesJson` wire the engine consumes — entries pre-sorted longest
 * pattern first by `buildPathAliasesJson`). Returns an absolute path to an
 * EXISTING file, or null when no alias claims the specifier.
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
 * Resolve an asset specifier to an absolute file: host aliases, then direct
 * Node resolution anchored at `rootDir`, then the package-root fallback.
 * Returns null when nothing matches — strict gating stays at the caller.
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
    // Asset subpaths are rarely listed in exports maps — fall through to
    // package-root resolution.
  }

  const segments = specifier.split('/');
  const packageName = specifier.startsWith('@')
    ? segments.slice(0, 2).join('/')
    : segments[0];
  const subpath = specifier.slice(packageName.length + 1);
  if (!subpath) return null;
  try {
    const pkgJson = requireFromRoot.resolve(`${packageName}/package.json`);
    const candidate = join(dirname(pkgJson), subpath);
    return existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}
