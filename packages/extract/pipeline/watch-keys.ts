import { realpathSync } from 'node:fs';
import { basename, dirname, join, normalize } from 'node:path';

export function toWatchKeys(input: string): string[] {
  const lexical = normalize(input);
  const canonical = realpathThroughNearestExistingAncestor(lexical);
  return canonical === lexical ? [lexical] : [lexical, canonical];
}

/** Canonicalizes a path that may not exist, through its nearest existing
 *  ancestor. A symlink retargeted after load fails open: no match. */
function realpathThroughNearestExistingAncestor(path: string): string {
  try {
    return realpathSync(path);
  } catch {}
  const suffix: string[] = [];
  let current = path;
  for (;;) {
    const parent = dirname(current);
    if (parent === current) return path;
    suffix.unshift(basename(current));
    current = parent;
    try {
      return join(realpathSync(current), ...suffix);
    } catch {}
  }
}
