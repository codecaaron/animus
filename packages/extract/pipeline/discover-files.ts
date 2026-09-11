import { readdirSync, statSync } from 'fs';
import { extname, join, relative } from 'path';

import type { ExcludeMatcher } from './core-options';

function pathCharRank(code: number): number {
  return code === 0x2f || code === 0x5c ? -1 : code;
}

export function compareDiscoveryOrder(a: string, b: string): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) {
    const left = pathCharRank(a.charCodeAt(i));
    const right = pathCharRank(b.charCodeAt(i));
    if (left !== right) return left - right;
  }
  return a.length - b.length;
}

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
