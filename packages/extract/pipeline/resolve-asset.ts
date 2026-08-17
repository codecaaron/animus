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

import { parseInternalWire } from './internal-wire';

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

function packageRootFromEntry(entry: string): string | null {
  let current = dirname(entry);
  while (true) {
    if (existsSync(join(current, 'package.json'))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

// Module-level memo, keyed by the alias JSON itself and never cleared: the
// table is a stable string per config lifecycle and resolution runs once per
// specifier, so each distinct table is parsed once for the process. Keying on
// the payload is what makes an unbounded cache safe — a new config mints a new
// key rather than reading a stale one.
const aliasTableCache = new Map<string, PathAliasEntry[]>();

/**
 * `pathAliasesJson` has exactly one encoder — `buildPathAliasesJson`, "the
 * single authoritative encoder of the wire format" — and every host assignment
 * routes through it. A parse failure is therefore a broken encoder, so it
 * throws: an empty table would disable ALL alias-based `asset()` resolution and
 * ship dangling `url()`s as a successful build. Only successful parses enter
 * the memo, so a failure can never harden into process-lifetime policy.
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

  // Locate the physical package directory through Node's module search
  // paths before asking for an exported entry. This also supports packages
  // that intentionally expose only subpaths and have no `"."` export.
  for (const modulesDir of requireFromRoot.resolve.paths(packageName) ?? []) {
    const packageRoot = join(modulesDir, packageName);
    if (!existsSync(join(packageRoot, 'package.json'))) continue;
    const candidate = join(packageRoot, subpath);
    if (existsSync(candidate)) return candidate;
  }

  try {
    // Resolve an actually exported entry, then walk to its package root.
    // `package.json` itself is commonly hidden by an exports map.
    const packageEntry = requireFromRoot.resolve(packageName);
    const packageRoot = packageRootFromEntry(packageEntry);
    if (!packageRoot) return null;
    const candidate = join(packageRoot, subpath);
    return existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}
