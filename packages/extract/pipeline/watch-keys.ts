import { realpathSync } from 'node:fs';
import { basename, dirname, join, normalize } from 'node:path';

/**
 * Membership keys for a filesystem path in the system-dependency watch set.
 *
 * The loader reports symlink-resolved canonical paths; watcher events carry
 * lexical absolute paths that may traverse symlinks (bun workspace links) and
 * — for deletions — may no longer exist, so `realpathSync` on the event path
 * alone cannot produce the canonical form. Both insertion and lookup go
 * through this one normalizer: the lexical form plus a canonical form
 * reconstructed through the nearest existing ancestor.
 */
export function toWatchKeys(input: string): string[] {
  const lexical = normalize(input);
  const canonical = realpathThroughNearestExistingAncestor(lexical);
  return canonical === lexical ? [lexical] : [lexical, canonical];
}

/**
 * Canonicalize a path that may not exist: walk up to the nearest existing
 * ancestor, realpath it, and re-append the missing suffix. Handles deleted
 * files under still-existing (possibly symlinked) directories and atomic
 * unlink/rename saves. Falls back to the input when no ancestor resolves.
 *
 * Known limit: a symlink retargeted AFTER the system load canonicalizes to
 * the new target, which cannot match the recorded (old-target) dependency —
 * the membership test then fails open (no reset), identical to not having
 * this reconstruction at all. Retarget sensitivity is a resolution-input
 * concern, deliberately out of scope for the watch set.
 */
function realpathThroughNearestExistingAncestor(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    // fall through to the ancestor walk
  }
  const suffix: string[] = [];
  let current = path;
  for (;;) {
    const parent = dirname(current);
    if (parent === current) return path;
    suffix.unshift(basename(current));
    current = parent;
    try {
      return join(realpathSync(current), ...suffix);
    } catch {
      // keep walking up
    }
  }
}
