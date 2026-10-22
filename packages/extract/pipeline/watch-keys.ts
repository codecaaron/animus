import { realpathSync } from 'node:fs';
import { basename, dirname, join, normalize } from 'node:path';

export function toWatchKeys(input: string): string[] {
  return watchKeysThrough(input, new Map());
}

/**
 * The watch keys of `paths`, resolved on the first lookup: a build that
 * never watches never pays for them. Each path's key is its lexical form
 * and its canonical one, as `toWatchKeys` gives them, read when first
 * asked rather than when the paths were recorded.
 */
export class LazyWatchKeys {
  private keys: Set<string> | undefined;

  constructor(private readonly paths: readonly string[]) {}

  has(key: string): boolean {
    this.keys ??= watchKeySet(this.paths);
    return this.keys.has(key);
  }

  /** These keys' paths and `other`'s, resolved together on first use. */
  union(other: LazyWatchKeys): LazyWatchKeys {
    return new LazyWatchKeys([...this.paths, ...other.paths]);
  }
}

/** Every path's watch keys, with each ancestor directory resolved at most
 *  once for the whole set: absent paths under one directory share its walk. */
function watchKeySet(paths: readonly string[]): Set<string> {
  const resolved = new Map<string, string | null>();
  const keys = new Set<string>();
  for (const path of paths) {
    for (const key of watchKeysThrough(path, resolved)) keys.add(key);
  }
  return keys;
}

function watchKeysThrough(
  input: string,
  resolved: Map<string, string | null>
): string[] {
  const lexical = normalize(input);
  const canonical = realpathThroughNearestExistingAncestor(lexical, resolved);
  return canonical === lexical ? [lexical] : [lexical, canonical];
}

/** `path`'s real path, or `null` where it does not resolve, read once per
 *  `resolved`. */
function realpathOnce(
  path: string,
  resolved: Map<string, string | null>
): string | null {
  let real = resolved.get(path);
  if (real === undefined) {
    try {
      real = realpathSync(path);
    } catch {
      real = null;
    }
    resolved.set(path, real);
  }
  return real;
}

/** Canonicalizes a path that may not exist, through its nearest existing
 *  ancestor, as the disk stands when asked. `LazyWatchKeys` asks at its
 *  first lookup, so a link retargeted before then resolves to its new
 *  target, and a link whose target is gone resolves to where it sits. */
function realpathThroughNearestExistingAncestor(
  path: string,
  resolved: Map<string, string | null>
): string {
  const own = realpathOnce(path, resolved);
  if (own !== null) return own;
  const suffix: string[] = [];
  let current = path;
  for (;;) {
    const parent = dirname(current);
    if (parent === current) return path;
    suffix.unshift(basename(current));
    current = parent;
    const real = realpathOnce(current, resolved);
    if (real !== null) return join(real, ...suffix);
  }
}
