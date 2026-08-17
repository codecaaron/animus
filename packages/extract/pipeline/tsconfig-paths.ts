import { existsSync, readFileSync } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';

import type { PathAliasPair } from './path-aliases';

/**
 * tsconfig `paths` → alias pairs for the Rust `pathAliasesJson` contract
 * (via `buildPathAliasesJson`). Used by drivers that cannot harvest aliases
 * from a live bundler config — Turbopack exposes none.
 *
 * Semantics (deliberately the TypeScript subset that matters for import
 * provenance): JSONC tolerated (comments + trailing commas); `extends`
 * chains followed (string or array; missing parents and cycles skipped);
 * the NEAREST config declaring `paths` wins wholesale (TS replaces the
 * object, never merges); targets resolve against the nearest `baseUrl`
 * (resolved from its declaring config's directory) or, absent one, the
 * directory of the config declaring `paths`; first target per pattern.
 * `x/*` patterns become prefix pairs, non-wildcard patterns exact pairs,
 * bare `*` catch-alls and mid-pattern wildcards are skipped.
 */

/** String-aware JSONC → JSON: strips // and block comments + trailing commas. */
function stripJsonc(text: string): string {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLine) {
      if (ch === '\n') {
        inLine = false;
        out += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLine = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlock = true;
      i++;
      continue;
    }
    out += ch;
  }
  // Trailing commas before } or ]
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/**
 * The value domain of a tsconfig's bytes — exactly what `JSON.parse` produces
 * for one. A tsconfig is CONSUMER-authored, so nothing about its contents is
 * guaranteed; every value below is decided by a guard before this reader acts
 * on it, and the decisions all happen in `readConfig`, at the file boundary.
 */
type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | JsonBlock;

interface JsonBlock {
  readonly [key: string]: JsonValue;
}

/** A keyed JSON block, decided by identity rather than by a representation
 *  tag: `Object(value) === value` holds for exactly the blocks and lists
 *  `JSON.parse` produces, and the `[object Object]` tag separates the two. */
function isJsonBlock(value: JsonValue | undefined): value is JsonBlock {
  return (
    Object(value) === value &&
    Object.prototype.toString.call(value) === '[object Object]'
  );
}

/** A JSON value with keys to enumerate — a block or a list. `paths` need only
 *  be one of these for its config to OWN the setting, matching TypeScript's
 *  wholesale replacement: a declared `paths` blocks its parents' even when it
 *  contributes nothing usable. */
function isJsonKeyed(
  value: JsonValue | undefined
): value is JsonBlock | readonly JsonValue[] {
  return Object(value) === value;
}

/** A JSON string, excluding the boxed `String` object (which JSON.parse never
 *  produces and which no path join would accept). */
function isJsonString(value: JsonValue | undefined): value is string {
  return (
    Object(value) !== value &&
    Object.prototype.toString.call(value) === '[object String]'
  );
}

/**
 * One config in the extends chain, decoded to the three facts this reader
 * consumes. The walkers below branch on these domain values only.
 */
interface TsconfigNode {
  dir: string;
  /** `compilerOptions.baseUrl` as written, or null when the config declares
   *  none — or declares a non-string, which resolves against nothing. */
  baseUrl: string | null;
  /** `compilerOptions.paths` reduced to pattern → FIRST target, or null when
   *  the config declares no `paths` at all. An EMPTY map is deliberately
   *  distinct from null: a config declaring an unusable `paths` still owns
   *  the setting and must not let a parent's leak through. */
  paths: ReadonlyMap<string, string> | null;
  /** Every string `extends` specifier, in declaration order. */
  extends: readonly string[];
}

function decodePaths(
  value: JsonValue | undefined
): ReadonlyMap<string, string> | null {
  if (!isJsonKeyed(value)) return null;
  const decoded = new Map<string, string>();
  for (const [pattern, targets] of Object.entries(value)) {
    // First target per pattern (module header); a pattern whose targets are
    // not a list of strings names nothing this reader can alias to.
    const [first] = Array.isArray(targets) ? targets : [];
    if (isJsonString(first)) decoded.set(pattern, first);
  }
  return decoded;
}

/** TypeScript accepts one specifier or an array of them; a non-string member
 *  names no config, so it is dropped here rather than at the resolution site. */
function decodeExtends(value: JsonValue | undefined): readonly string[] {
  return (Array.isArray(value) ? value : [value]).filter(isJsonString);
}

function readConfig(path: string): TsconfigNode | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(stripJsonc(raw));
  } catch {
    return null;
  }
  // A tsconfig that is not a JSON object declares no compiler options — the
  // same nothing the old property reads produced for it.
  const root: JsonBlock = isJsonBlock(parsed) ? parsed : {};
  const compilerOptions: JsonBlock = isJsonBlock(root.compilerOptions)
    ? root.compilerOptions
    : {};
  return {
    dir: dirname(path),
    baseUrl: isJsonString(compilerOptions.baseUrl)
      ? compilerOptions.baseUrl
      : null,
    paths: decodePaths(compilerOptions.paths),
    extends: decodeExtends(root.extends),
  };
}

function resolveExtendsTarget(
  specifier: string,
  fromDir: string
): string | null {
  if (specifier.startsWith('.') || isAbsolute(specifier)) {
    const base = resolve(fromDir, specifier);
    for (const candidate of [
      base,
      `${base}.json`,
      join(base, 'tsconfig.json'),
    ]) {
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }
  // Bare specifier (@tsconfig/... presets)
  try {
    return require.resolve(
      specifier.endsWith('.json') ? specifier : `${specifier}/tsconfig.json`,
      { paths: [fromDir] }
    );
  } catch {
    try {
      return require.resolve(specifier, { paths: [fromDir] });
    } catch {
      return null;
    }
  }
}

/** Child-first flattened extends chain starting at `entryPath`. */
function loadChain(entryPath: string): TsconfigNode[] {
  const chain: TsconfigNode[] = [];
  const visited = new Set<string>();
  const queue: string[] = [entryPath];

  while (queue.length > 0) {
    const path = queue.shift()!;
    const key = resolve(path);
    if (visited.has(key)) continue; // cycle guard
    visited.add(key);

    const node = readConfig(key);
    if (!node) continue;
    chain.push(node);

    for (const parent of node.extends) {
      const resolved = resolveExtendsTarget(parent, node.dir);
      if (resolved) queue.push(resolved);
    }
  }
  return chain;
}

/**
 * Read the project's tsconfig path aliases as pairs consumable by
 * `buildPathAliasesJson`. Returns an empty array when no readable tsconfig
 * (or no usable `paths`) exists.
 */
export function readTsconfigAliasPairs(rootDir: string): PathAliasPair[] {
  const chain = loadChain(join(rootDir, 'tsconfig.json'));
  if (chain.length === 0) return [];

  // Nearest paths wins wholesale.
  const pathsOwner = chain.find((node) => node.paths !== null);
  const paths = pathsOwner?.paths ?? null;
  if (pathsOwner === undefined || paths === null) return [];

  // Nearest baseUrl (resolved from ITS declaring config), else the
  // paths-declaring config's directory.
  const baseOwner = chain.find((node) => node.baseUrl !== null);
  const baseUrl = baseOwner?.baseUrl ?? null;
  const base =
    baseOwner !== undefined && baseUrl !== null
      ? resolve(baseOwner.dir, baseUrl)
      : pathsOwner.dir;

  const pairs: PathAliasPair[] = [];
  for (const [pattern, target] of paths) {
    const patternStars = pattern.split('*').length - 1;
    const targetStars = target.split('*').length - 1;
    if (pattern === '*' || patternStars > 1 || targetStars > 1) continue;

    if (pattern.endsWith('/*')) {
      if (!target.endsWith('/*')) continue;
      pairs.push({
        pattern: pattern.slice(0, -2),
        target: resolve(base, target.slice(0, -2)),
        kind: 'prefix',
      });
      continue;
    }
    if (patternStars > 0 || targetStars > 0) continue;

    pairs.push({
      pattern,
      target: resolve(base, target),
      kind: 'exact',
    });
  }
  return pairs;
}
