import { realpathSync } from 'node:fs';
import { join, relative } from 'node:path';

import { policyCandidates, seeOnDisk } from './extension-policy';

import type { ExtensionOrder } from './extension-policy';

/** What the host's filesystem opens for one probe base (spec §2.2 A2, A8),
 *  as the engine's `HostCandidate` reads it. */
export interface HostCandidate {
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

/** `rootDir` at its real path, where the filesystem reports spellings. */
function realRoot(rootDir: string): string {
  try {
    return realpathSync.native(rootDir);
  } catch {
    // An unreadable root opens nothing below it.
    return rootDir;
  }
}

/**
 * What the host's filesystem opens for `base` (spec §2.2 A2, A8): the first
 * of its candidates, in the host's order, that the host opens. The
 * filesystem decides what opens, and each name below the session root is
 * checked against its own directory's listing (`seeOnDisk`); nothing is
 * folded. Null where no candidate opens.
 *
 * A candidate the analysis holds answers before the filesystem is asked: an
 * adapted original's analysis child need not exist on disk. An original the
 * host opens is analysed as the first later candidate the analysis holds.
 */
export function hostCandidate(
  rootDir: string,
  base: string,
  analysed: ReadonlySet<string>,
  order: ExtensionOrder | undefined,
  root: string = realRoot(rootDir)
): HostCandidate | null {
  const candidates = policyCandidates(base, { policy: order });
  for (const [index, candidate] of candidates.entries()) {
    if (analysed.has(candidate)) {
      return { candidate, actual: null, analysedAs: candidate };
    }
    const seen = seeOnDisk(join(rootDir, candidate), rootDir);
    if (seen.kind === 'missing') continue;
    return {
      candidate,
      actual: seen.kind === 'case-only' ? relative(root, seen.actual) : null,
      analysedAs:
        seen.kind === 'file'
          ? (candidates.slice(index + 1).find((later) => analysed.has(later)) ??
            null)
          : null,
    };
  }
  return null;
}

/**
 * The session's host-candidate evidence for one analysis (spec §2.3): each
 * probe base the engine's `prepare` names, as `hostCandidate` reads it. The
 * evidence carries the input identity `prepare` reported, and each call is a
 * new ingest generation, so no evidence is read for other files.
 */
export function gatherProbeEvidence(
  rootDir: string,
  analysed: ReadonlySet<string>,
  order: ExtensionOrder | undefined
): (bases: readonly string[], identity: string) => string {
  const root = realRoot(rootDir);
  return (bases, identity) => {
    const byBase: Record<string, HostCandidate> = {};
    for (const base of bases) {
      const host = hostCandidate(rootDir, base, analysed, order, root);
      if (host !== null) byBase[base] = host;
    }
    generations += 1;
    return JSON.stringify({ generation: generations, identity, bases: byBase });
  };
}
