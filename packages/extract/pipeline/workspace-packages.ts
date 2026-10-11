import { readdirSync, readFileSync, realpathSync } from 'fs';
import { join, resolve } from 'path';

import { isJsonBlock, isJsonString } from './tsconfig-paths';

import type { JsonValue } from './tsconfig-paths';

/** Package name → the real directory of the workspace that declares it. */
export interface WorkspacePackages {
  readonly [name: string]: string;
}

/** The parsed `package.json` in `dir`, or null when it cannot be read. */
function readManifest(dir: string): JsonValue | null {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
  } catch {
    return null;
  }
}

/** A path segment's pattern: `*` matches any run of characters within the
 *  segment, and a leading dot only when the pattern spells it. */
function segmentMatcher(pattern: string): (name: string) => boolean {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*');
  const matcher = new RegExp(`^${source}$`);
  return (name) =>
    matcher.test(name) && (!name.startsWith('.') || pattern.startsWith('.'));
}

/** The subdirectories of `dir`, sorted, without `node_modules`. */
function childDirectories(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/** The directories under `rootDir` a workspace entry names, in path order:
 *  a literal entry names itself; `*` matches within one segment and `**`
 *  any number of directories, never through `node_modules`. */
function entryDirectories(rootDir: string, entry: string): string[] {
  if (!entry.includes('*')) return [resolve(rootDir, entry)];
  let dirs = [resolve(rootDir)];
  for (const segment of entry.split('/').filter((s) => s !== '' && s !== '.')) {
    if (segment === '**') {
      const descendants: string[] = [];
      const visit = (dir: string) => {
        descendants.push(dir);
        for (const child of childDirectories(dir)) {
          if (!child.startsWith('.')) visit(join(dir, child));
        }
      };
      dirs.forEach(visit);
      dirs = descendants;
    } else if (segment.includes('*')) {
      const matches = segmentMatcher(segment);
      dirs = dirs.flatMap((dir) =>
        childDirectories(dir)
          .filter(matches)
          .map((child) => join(dir, child))
      );
    } else {
      dirs = dirs.map((dir) => resolve(dir, segment));
    }
  }
  return dirs;
}

/**
 * The packages the session root's `package.json` declares as workspaces, by
 * name, at their real directories, so a linked workspace is one package. The
 * system loader consults them after a `node_modules` lookup misses. A glob
 * entry (`packages/*`, `apps/**`) names each package directory it matches,
 * and a `!` entry removes the directories it matches, as npm and Yarn read
 * them; the first entry to name a package keeps it. None when the manifest
 * is absent or declares none.
 */
export function declaredWorkspacePackages(rootDir: string): WorkspacePackages {
  const rootPkg = readManifest(rootDir);
  if (!isJsonBlock(rootPkg)) return {};
  const workspaces = rootPkg.workspaces;
  const declared = isJsonBlock(workspaces) ? workspaces.packages : workspaces;
  if (!Array.isArray(declared)) return {};
  const entries = declared.filter(isJsonString);
  const excluded = new Set(
    entries
      .filter((entry) => entry.startsWith('!'))
      .flatMap((entry) => entryDirectories(rootDir, entry.slice(1)))
  );
  const packages: Record<string, string> = {};
  for (const entry of entries) {
    if (entry.startsWith('!')) continue;
    for (const candidate of entryDirectories(rootDir, entry)) {
      if (excluded.has(candidate)) continue;
      let dir: string;
      try {
        dir = realpathSync(candidate);
      } catch {
        continue;
      }
      // A directory with no readable manifest, or no name, is no package.
      const manifest = readManifest(dir);
      const name = isJsonBlock(manifest) ? manifest.name : undefined;
      if (isJsonString(name) && name !== '' && !(name in packages)) {
        packages[name] = dir;
      }
    }
  }
  return packages;
}
