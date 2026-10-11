import { readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { policyCandidates } from './extension-policy';

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
 * opens and how it is spelled, each candidate checked against its own
 * directory's listing; nothing is folded. Each call is a new ingest
 * generation, so no evidence outlives the files it was gathered from.
 *
 * A candidate the analysis holds answers before the filesystem is asked: an
 * adapted original's analysis child need not exist on disk. An original the
 * host opens is analysed as the first later candidate the analysis holds.
 */
export function gatherProbeEvidence(
  rootDir: string,
  analysed: ReadonlySet<string>,
  order: ExtensionOrder | undefined
): (bases: readonly string[]) => string {
  return (bases) => {
    const listings = new Map<string, ReadonlySet<string>>();
    const listing = (dir: string): ReadonlySet<string> => {
      let names = listings.get(dir);
      if (names === undefined) {
        try {
          names = new Set(readdirSync(dir));
        } catch {
          names = new Set();
        }
        listings.set(dir, names);
      }
      return names;
    };
    const opens = (path: string): boolean => {
      try {
        return statSync(path).isFile();
      } catch {
        return false;
      }
    };
    const byBase: Record<string, HostCandidate> = {};
    for (const base of bases) {
      const candidates = policyCandidates(base, { policy: order });
      for (const [index, candidate] of candidates.entries()) {
        if (analysed.has(candidate)) {
          byBase[base] = { candidate, actual: null, analysedAs: candidate };
          break;
        }
        const file = join(rootDir, candidate);
        if (!opens(file)) continue;
        const exact = listing(dirname(file)).has(basename(file));
        byBase[base] = {
          candidate,
          actual: exact ? null : basename(realpathSync.native(file)),
          analysedAs: exact
            ? (candidates
                .slice(index + 1)
                .find((later) => analysed.has(later)) ?? null)
            : null,
        };
        break;
      }
    }
    generations += 1;
    return JSON.stringify({ generation: generations, bases: byBase });
  };
}
