import { readdirSync, statSync } from 'fs';
import { extname, join, relative } from 'path';

import type { ExcludeMatcher } from './core-options';

/** A path separator ranks below every other character — no character has a
 *  negative code — and both spellings rank alike, so `a\b` and `a/b` name the
 *  same position. That single rule is the whole difference between this order
 *  and a flat string compare. */
function pathCharRank(code: number): number {
  return code === 0x2f || code === 0x5c ? -1 : code;
}

/**
 * The order source files are analyzed in: segment-wise lexicographic on the
 * path, which is what a depth-first walk over sorted directory entries
 * yields, and not a flat string compare — among siblings the directory `b`
 * sorts before the file `b.tsx`, so `b/c.tsx` precedes `b.tsx`, which
 * comparing the two whole strings gets backwards (`.` is 0x2E, `/` is 0x2F).
 *
 * This is the definition, not a description of one: `discoverFiles` sorts
 * through it, and a caller holding paths rather than a directory to walk
 * (the session's incremental pass, which rebuilds its corpus from a cache)
 * gets the identical order from the identical function.
 */
export function compareDiscoveryOrder(a: string, b: string): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) {
    const left = pathCharRank(a.charCodeAt(i));
    const right = pathCharRank(b.charCodeAt(i));
    if (left !== right) return left - right;
  }
  return a.length - b.length;
}

/**
 * Recursively discover source files under `dir`, skipping excluded paths
 * (an `ExcludeMatcher` — see core-options, the one pattern authority — or
 * undefined for NO exclusion at all: the dist-package walks deliberately
 * run under node_modules, which `createExcludeMatcher`'s structural set
 * would prune) and keeping files whose extension is in `extensionsSet`.
 *
 * Single authoritative copy for both extraction plugins.
 *
 * The result is sorted through `compareDiscoveryOrder`. readdir order is
 * filesystem-dependent (APFS vs ext4, clone vs rsync) and the engine receives
 * files in discovery order, so an unsorted result breaks the
 * identical-inputs → byte-identical-artifacts contract across machines.
 */
export function discoverFiles(
  dir: string,
  rootDir: string,
  exclude: ExcludeMatcher | undefined,
  extensionsSet: ReadonlySet<string>
): string[] {
  return walkFiles(dir, rootDir, exclude, extensionsSet).sort(
    compareDiscoveryOrder
  );
}

/** The walk itself, in whatever order the filesystem hands entries back —
 *  every result shares the walk root as a prefix, so sorting the flat list
 *  above orders it exactly as a depth-first walk of sorted entries would. */
function walkFiles(
  dir: string,
  rootDir: string,
  exclude: ExcludeMatcher | undefined,
  extensionsSet: ReadonlySet<string>
): string[] {
  const results: string[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dir, { encoding: 'utf8' });
  } catch {
    return results;
  }

  const isExcluded = exclude
    ? (full: string, rel: string) => exclude.matches(full, rel)
    : () => false;

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const relativePath = relative(rootDir, fullPath);

    if (isExcluded(fullPath, relativePath)) continue;

    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      results.push(...walkFiles(fullPath, rootDir, exclude, extensionsSet));
    } else if (extensionsSet.has(extname(entry))) {
      results.push(fullPath);
    }
  }

  return results;
}
