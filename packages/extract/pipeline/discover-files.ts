import { readdirSync, statSync } from 'fs';
import { extname, join, relative } from 'path';

/**
 * Recursively discover source files under `dir`, skipping any path that
 * contains one of `excludePatterns` (matched as substrings of both the full
 * and root-relative path) and keeping files whose extension is in
 * `extensionsSet`.
 *
 * Single authoritative copy for both extraction plugins.
 */
export function discoverFiles(
  dir: string,
  rootDir: string,
  excludePatterns: string[],
  extensionsSet: ReadonlySet<string>
): string[] {
  const results: string[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dir, { encoding: 'utf8' });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const relativePath = relative(rootDir, fullPath);

    const shouldExclude = excludePatterns.some(
      (pattern) => fullPath.includes(pattern) || relativePath.includes(pattern)
    );
    if (shouldExclude) continue;

    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      results.push(
        ...discoverFiles(fullPath, rootDir, excludePatterns, extensionsSet)
      );
    } else if (extensionsSet.has(extname(entry))) {
      results.push(fullPath);
    }
  }

  return results;
}
