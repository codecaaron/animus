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

interface TsconfigNode {
  dir: string;
  compilerOptions: {
    baseUrl?: unknown;
    paths?: unknown;
  };
  extends?: unknown;
}

function readConfig(path: string): TsconfigNode | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
  try {
    const json = JSON.parse(stripJsonc(raw)) as {
      compilerOptions?: TsconfigNode['compilerOptions'];
      extends?: unknown;
    };
    return {
      dir: dirname(path),
      compilerOptions: json.compilerOptions ?? {},
      extends: json.extends,
    };
  } catch {
    return null;
  }
}

function resolveExtendsTarget(specifier: string, fromDir: string): string | null {
  if (specifier.startsWith('.') || isAbsolute(specifier)) {
    const base = resolve(fromDir, specifier);
    for (const candidate of [base, `${base}.json`, join(base, 'tsconfig.json')]) {
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

    const parents = Array.isArray(node.extends)
      ? node.extends
      : node.extends !== undefined
        ? [node.extends]
        : [];
    for (const parent of parents) {
      if (typeof parent !== 'string') continue;
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
  const pathsOwner = chain.find(
    (node) =>
      node.compilerOptions.paths &&
      typeof node.compilerOptions.paths === 'object'
  );
  if (!pathsOwner) return [];
  const paths = pathsOwner.compilerOptions.paths as Record<string, unknown>;

  // Nearest baseUrl (resolved from ITS declaring config), else the
  // paths-declaring config's directory.
  const baseOwner = chain.find(
    (node) => typeof node.compilerOptions.baseUrl === 'string'
  );
  const base = baseOwner
    ? resolve(baseOwner.dir, baseOwner.compilerOptions.baseUrl as string)
    : pathsOwner.dir;

  const pairs: PathAliasPair[] = [];
  for (const [pattern, targets] of Object.entries(paths)) {
    const target = Array.isArray(targets) ? targets[0] : undefined;
    if (typeof target !== 'string') continue;

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
