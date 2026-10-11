import { realpathSync } from 'node:fs';
import { join, relative } from 'node:path';

import { policyCandidates, seeOnDisk } from './extension-policy';

import type { ExtensionOrder } from './extension-policy';

/** What the host's filesystem opens for one probe base (spec §2.2 A2, A8),
 *  as the engine's `HostCandidate` reads it. */
interface HostCandidate {
  /** The first candidate, in the host's order, the host opens as a file,
   *  spelled as the probe spells it. */
  candidate: string;
  /** The spelling the filesystem lists, where it differs: a case- or
   *  normalization-insensitive host opens the candidate as this file. */
  actual: string | null;
  /** The analysed module the candidate is, where the analysis holds one. */
  analysedAs: string | null;
}

let generations = 0;

/**
 * The session's host-candidate evidence for one analysis (spec §2.3): for
 * each probe base the engine's `prepare` names, the first of its candidates,
 * in the host's order, that the host opens. The filesystem decides what
 * opens, and each name below the session root is checked against its own
 * directory's listing (`seeOnDisk`); nothing is folded. The evidence
 * carries the input identity `prepare` reported, and each call is a new
 * ingest generation, so no evidence is read for other files.
 *
 * A candidate the analysis holds answers before the filesystem is asked: an
 * adapted original's analysis child need not exist on disk. An original the
 * host opens is analysed as the first later candidate the analysis holds.
 */
export function gatherProbeEvidence(
  rootDir: string,
  analysed: ReadonlySet<string>,
  order: ExtensionOrder | undefined
): (bases: readonly string[], identity: string) => string {
  // The filesystem reports a spelling at its real path.
  let realRoot = rootDir;
  try {
    realRoot = realpathSync.native(rootDir);
  } catch {
    // An unreadable root opens nothing below it.
  }
  return (bases, identity) => {
    const byBase: Record<string, HostCandidate> = {};
    for (const base of bases) {
      const candidates = policyCandidates(base, { policy: order });
      for (const [index, candidate] of candidates.entries()) {
        if (analysed.has(candidate)) {
          byBase[base] = { candidate, actual: null, analysedAs: candidate };
          break;
        }
        const seen = seeOnDisk(join(rootDir, candidate), rootDir);
        if (seen.kind === 'missing') continue;
        byBase[base] = {
          candidate,
          actual:
            seen.kind === 'case-only' ? relative(realRoot, seen.actual) : null,
          analysedAs:
            seen.kind === 'file'
              ? (candidates
                  .slice(index + 1)
                  .find((later) => analysed.has(later)) ?? null)
              : null,
        };
        break;
      }
    }
    generations += 1;
    return JSON.stringify({ generation: generations, identity, bases: byBase });
  };
}
