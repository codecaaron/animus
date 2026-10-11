import { readFileSync, realpathSync } from 'fs';
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

/**
 * The packages the session root's `package.json` declares as workspaces, by
 * name, at their real directories, so a linked workspace is one package. The
 * system loader consults them after a `node_modules` lookup misses. Only
 * literal entries name a package; a glob entry (`packages/*`) names none
 * yet. None when the manifest is absent or declares none.
 */
export function declaredWorkspacePackages(rootDir: string): WorkspacePackages {
  const rootPkg = readManifest(rootDir);
  if (!isJsonBlock(rootPkg)) return {};
  const workspaces = rootPkg.workspaces;
  const declared = isJsonBlock(workspaces) ? workspaces.packages : workspaces;
  if (!Array.isArray(declared)) return {};
  // A Map, so a package named `constructor` or `__proto__` is a name like
  // any other.
  const packages = new Map<string, string>();
  for (const entry of declared) {
    if (!isJsonString(entry)) continue;
    let dir: string;
    try {
      dir = realpathSync(resolve(rootDir, entry));
    } catch {
      continue;
    }
    // A directory with no readable manifest, or no name, is no package.
    const manifest = readManifest(dir);
    const name = isJsonBlock(manifest) ? manifest.name : undefined;
    if (isJsonString(name) && name !== '' && !packages.has(name)) {
      packages.set(name, dir);
    }
  }
  return Object.fromEntries(packages);
}
