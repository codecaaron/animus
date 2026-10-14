import { realpathSync } from 'node:fs';
import { join, relative } from 'node:path';

import { hostExpansions } from './host-expansions';
import { seeFile, specifierCandidates } from './native-resolution';
import { packageReaches } from './registry-packages';

import type { HostLoadExpander, ListedLoad } from './host-expansions';
import type { ExtensionOrder } from './native-resolution';
import type { PreparedPackage } from './registry-packages';

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
  /** How the analysis reads a candidate it holds no module for, or one a
   *  query loads as an opaque value (spec §2.2 A8); absent where it reads
   *  the module, or the spelling differs. */
  reading?: 'asset' | 'adapted' | 'unanalysed';
}

/** What a session knows beside the analysed paths. */
export interface HostReadings {
  /** The host's asset and stylesheet classification. */
  isAsset?(file: string, query: string): boolean;
  /** Each adapted original (`.mdx`, `.svelte`) and its analysis children. */
  adapted?: ReadonlyMap<string, readonly string[]>;
  /** How the host's bundler expands computed loads (spec §6.3). */
  expander?: HostLoadExpander;
  /** The engine's reading of what each file of an unread local package
   *  loads (`packageLoads`). Without it, a local package may reach any
   *  module. */
  packageLoads?: (filesJson: string) => string;
}

/** The session's evidence for the probe bases, computed loads and unread
 *  packages the engine's `prepare` names, carrying its input identity, as
 *  JSON. */
export type ProbeEvidenceGatherer = (
  bases: readonly string[],
  identity: string,
  loads?: readonly ListedLoad[],
  packages?: readonly PreparedPackage[]
) => string;

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
 * checked against its own directory's listing (`seeFile`); nothing is
 * folded. Null where no candidate opens.
 *
 * A candidate the analysis holds answers before the filesystem is asked: an
 * adapted original's analysis child need not exist on disk. A file the host
 * opens that the analysis holds no module for is read as an adapted
 * original (analysed as its first later child), an asset, or a file
 * analysis never reads.
 */
export function hostCandidate(
  rootDir: string,
  base: string,
  analysed: ReadonlySet<string>,
  order: ExtensionOrder | undefined,
  readings: HostReadings = {},
  root: string = realRoot(rootDir)
): HostCandidate | null {
  // A query (`./x.js?raw`) selects how the host loads the file, not which
  // file: the file is probed without it, and the host reads it with it.
  const at = base.indexOf('?');
  const query = at === -1 ? '' : base.slice(at);
  const candidates = specifierCandidates(at === -1 ? base : base.slice(0, at), {
    policy: order,
  });
  for (const [index, file] of candidates.entries()) {
    const candidate = `${file}${query}`;
    const opaque = () => readings.isAsset?.(join(rootDir, file), query);
    if (analysed.has(file)) {
      // `?raw` or `?url` loads an analysed module as a string.
      return query !== '' && opaque()
        ? { candidate, actual: null, analysedAs: null, reading: 'asset' }
        : { candidate, actual: null, analysedAs: file };
    }
    const seen = seeFile(join(rootDir, file), rootDir);
    if (seen.kind === 'missing') continue;
    if (seen.kind === 'case-only') {
      return {
        candidate,
        actual: relative(root, seen.actual),
        analysedAs: null,
      };
    }
    const children = readings.adapted?.get(file);
    if (children !== undefined) {
      return {
        candidate,
        actual: null,
        analysedAs:
          candidates
            .slice(index + 1)
            .find((later) => children.includes(later)) ?? null,
        reading: 'adapted',
      };
    }
    return {
      candidate,
      actual: null,
      analysedAs: null,
      reading: opaque() ? 'asset' : 'unanalysed',
    };
  }
  return null;
}

/**
 * The session's host-candidate evidence for one analysis (spec §2.3): each
 * probe base the engine's `prepare` names, as `hostCandidate` reads it, the
 * host's expansion of each computed load it lists, and the analysed
 * modules each unread package it lists can reach (spec §6.3). The
 * evidence carries the input identity `prepare` reported, and each call is a
 * new ingest generation, so no evidence is read for other files.
 */
export function gatherProbeEvidence(
  rootDir: string,
  analysed: ReadonlySet<string>,
  order: ExtensionOrder | undefined,
  readings: HostReadings = {}
): ProbeEvidenceGatherer {
  const root = realRoot(rootDir);
  return (bases, identity, loads = [], packages = []) => {
    const byBase: Record<string, HostCandidate> = {};
    for (const base of bases) {
      const host = hostCandidate(
        rootDir,
        base,
        analysed,
        order,
        readings,
        root
      );
      if (host !== null) byBase[base] = host;
    }
    const expansions =
      readings.expander === undefined
        ? []
        : hostExpansions(
            loads,
            rootDir,
            analysed,
            readings.expander,
            readings.isAsset
          );
    const reaches = packageReaches(
      root,
      packages,
      analysed,
      readings.packageLoads
    );
    generations += 1;
    return JSON.stringify({
      generation: generations,
      identity,
      bases: byBase,
      ...(expansions.length > 0 && { expansions }),
      ...(reaches.length > 0 && { packages: reaches }),
    });
  };
}

/** Each adapted original and its analysis children, from ingestion's
 *  ownership: an original whose children are other paths than its own. */
export function adaptedOriginals(
  ownership: Readonly<
    Record<string, { readonly analysisPaths: readonly string[] }>
  >
): ReadonlyMap<string, readonly string[]> {
  return new Map(
    Object.entries(ownership)
      .filter(
        ([original, { analysisPaths }]) =>
          !(analysisPaths.length === 1 && analysisPaths[0] === original)
      )
      .map(([original, { analysisPaths }]) => [original, analysisPaths])
  );
}
