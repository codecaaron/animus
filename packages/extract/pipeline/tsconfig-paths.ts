import { existsSync, readFileSync } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';

import type { PathAliasPair } from './path-aliases';

/**
 * tsconfig `paths` → alias pairs, for drivers with no live bundler config.
 * The nearest config declaring `paths` wins wholesale — TS never merges.
 */

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
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/**
 * Exactly what `JSON.parse` produces for a consumer-authored tsconfig:
 * nothing is guaranteed, so every value is guarded at the file boundary.
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

/** `Object(value) === value` holds for exactly the blocks and lists
 *  `JSON.parse` produces; the `[object Object]` tag separates the two. */
function isJsonBlock(value: JsonValue | undefined): value is JsonBlock {
  return (
    Object(value) === value &&
    Object.prototype.toString.call(value) === '[object Object]'
  );
}

/** A block or a list. A declared `paths` OWNS the setting and blocks its
 *  parents' even when it contributes nothing usable. */
function isJsonKeyed(
  value: JsonValue | undefined
): value is JsonBlock | readonly JsonValue[] {
  return Object(value) === value;
}

/** A JSON string, excluding the boxed `String` object, which no path join
 *  accepts. */
function isJsonString(value: JsonValue | undefined): value is string {
  return (
    Object(value) !== value &&
    Object.prototype.toString.call(value) === '[object String]'
  );
}

interface TsconfigNode {
  dir: string;
  /** `compilerOptions.baseUrl` as written; null when absent or non-string. */
  baseUrl: string | null;
  /** Pattern → FIRST target; null only when the config declares no `paths`.
   *  An empty map still owns the setting and blocks a parent's. */
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
    // First target per pattern; a pattern whose targets are not a list of
    // strings aliases nothing.
    const [first] = Array.isArray(targets) ? targets : [];
    if (isJsonString(first)) decoded.set(pattern, first);
  }
  return decoded;
}

/** TypeScript accepts one specifier or an array; a non-string member names
 *  no config and is dropped here. */
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
    if (visited.has(key)) continue;
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
 * The project's tsconfig path aliases as `buildPathAliasesJson` pairs; empty
 * when no readable tsconfig, or no usable `paths`, exists.
 */
export function readTsconfigAliasPairs(rootDir: string): PathAliasPair[] {
  const chain = loadChain(join(rootDir, 'tsconfig.json'));
  if (chain.length === 0) return [];

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
