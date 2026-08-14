import { readdirSync, statSync } from 'fs';
import { extname, join, relative } from 'path';

import type { ExcludeMatcher } from './core-options';

/**
 * Recursively discover source files under `dir`, skipping excluded paths
 * (an `ExcludeMatcher` — see core-options, the one pattern authority — or
 * undefined for NO exclusion at all: the dist-package walks deliberately
 * run under node_modules, which `createExcludeMatcher`'s structural set
 * would prune) and keeping files whose extension is in `extensionsSet`.
 *
 * Single authoritative copy for both extraction plugins.
 */
export function discoverFiles(
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
  // readdir order is filesystem-dependent (APFS vs ext4, clone vs rsync);
  // the engine receives files in discovery order, so an unsorted walk breaks
  // the identical-inputs → byte-identical-artifacts contract across machines.
  entries.sort();

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
      results.push(...discoverFiles(fullPath, rootDir, exclude, extensionsSet));
    } else if (extensionsSet.has(extname(entry))) {
      results.push(fullPath);
    }
  }

  return results;
}
