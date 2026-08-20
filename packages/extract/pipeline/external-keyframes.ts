import { parseInternalWire } from './internal-wire';

import type { ManifestDiagnostic } from './manifest-diagnostics';

/** Stable codes for external keyframes discovery. */
export const KEYFRAMES_EXTERNAL_ENTRY_FAILED =
  'animus.keyframes.external-entry-failed';
export const KEYFRAMES_EXPORT_COLLISION = 'animus.keyframes.export-collision';

/**
 * The scanned-keyframes wire: export name → that export's collection. The
 * system loader's `extract_keyframes_blocks` produces this shape on BOTH sides
 * of the merge below — for the consumer system (`SystemConfig.keyframesJson`)
 * and for every external entry (`scanKeyframesExports`) — so one declaration
 * covers both, and a collection that survives the merge is re-serialized
 * unchanged.
 */
interface KeyframesCollections {
  [exportName: string]: KeyframesCollection;
}

/** One branded `Keyframes` export, flattened to its `__frames` record. */
interface KeyframesCollection {
  [keyframeName: string]: KeyframeBlock;
}

/** One keyframe: the emitted `@keyframes` identity plus its authored steps. */
interface KeyframeBlock {
  /** Content-hashed `@keyframes` name the emitter declares and references. */
  name: string;
  frames: KeyframeSteps;
}

/** Step selector (`from`, `to`, `NN%`) → that step's CSS declarations. */
interface KeyframeSteps {
  [step: string]: KeyframeDeclarations;
}

/** CSS property → value as authored: raw CSS, a number, or a `{scale.key}`
 *  token reference the engine resolves at emission. */
interface KeyframeDeclarations {
  [property: string]: string | number;
}

export interface ExternalKeyframesMerge {
  /** Consumer collections merged with every discovered external collection
   *  (consumer wins on name collisions); `null` when nothing exists. */
  keyframesJson: string | null;
  /** Warn-severity diagnostics for failed entries and name collisions —
   *  surfaced through the shared manifest-diagnostics policy point. */
  diagnostics: ManifestDiagnostic[];
}

/**
 * Merge `Keyframes` collections discovered from external package entries into
 * the consumer system's collections. Keyframes are the sole carve-out from
 * the consumer-config singular-authority rule: nothing but branded
 * collections is read from an entry, an entry that fails to evaluate
 * degrades to a coded diagnostic naming it, and a collection whose export
 * name collides keeps the earlier (consumer-first) collection with a coded
 * diagnostic instead of silently reordering names.
 */
export function mergeExternalKeyframes(
  scan: (entryPath: string, rootDir: string) => string | null,
  consumerKeyframesJson: string | null | undefined,
  externalEntries: Iterable<string>,
  rootDir: string
): ExternalKeyframesMerge {
  const merged: KeyframesCollections = {};
  if (consumerKeyframesJson) {
    try {
      Object.assign(merged, JSON.parse(consumerKeyframesJson));
    } catch {
      // Delegation, not a swallow: the consumer payload's owner is the system
      // loader that produced it (`SystemConfig.keyframesJson`), and the caller
      // hands the same field straight to the engine. Returning the ORIGINAL
      // string leaves the malformed bytes to fail at that owner instead of
      // substituting a value this merge invented.
      return { keyframesJson: consumerKeyframesJson, diagnostics: [] };
    }
  }
  const diagnostics: ManifestDiagnostic[] = [];
  const seenEntries = new Set<string>();

  for (const entryPath of externalEntries) {
    if (seenEntries.has(entryPath)) continue;
    seenEntries.add(entryPath);

    let scanned: string | null;
    try {
      scanned = scan(entryPath, rootDir);
    } catch (error) {
      diagnostics.push({
        file: entryPath,
        component: 'keyframes',
        kind: 'warn',
        message:
          `external package entry failed the keyframes scan — any collections it exports are invisible to extraction: ${String(error)}. ` +
          `Each admitted entry is scanned on its own: the package specifier your system entry declares, plus the package root module when that declaration was a subpath. ` +
          `Every scan evaluates that entry's whole module graph framework-free, so a root barrel re-exporting framework components can fail here while the definition entry scans clean. ` +
          `Export keyframe collections (directly or as a named re-export) from an entry that evaluates framework-free, and avoid \`export *\` of framework packages there ` +
          `(${KEYFRAMES_EXTERNAL_ENTRY_FAILED})`,
        code: KEYFRAMES_EXTERNAL_ENTRY_FAILED,
        severity: 'warn',
      });
      continue;
    }
    if (!scanned) continue;

    // The scan RESULT is animus's own wire — `scanKeyframesExports` is a NAPI
    // entry point and the engine serializes it. An entry that fails to
    // EVALUATE is an external-package failure and degrades to the coded
    // diagnostic above; an entry that evaluates and then yields unparseable
    // engine output is an engine bug, and `continue` would drop its
    // collections indistinguishably from "this package ships no keyframes".
    const collections = parseInternalWire<KeyframesCollections>(
      scanned,
      `keyframes collections scanned from '${entryPath}' ` +
        "(the engine's scanKeyframesExports)"
    );
    for (const [exportName, collection] of Object.entries(collections)) {
      const existing = merged[exportName];
      if (existing !== undefined) {
        if (JSON.stringify(existing) !== JSON.stringify(collection)) {
          diagnostics.push({
            file: entryPath,
            component: exportName,
            kind: 'warn',
            message: `keyframes collection export '${exportName}' collides with an earlier collection of the same name — the earlier one wins (${KEYFRAMES_EXPORT_COLLISION})`,
            code: KEYFRAMES_EXPORT_COLLISION,
            severity: 'warn',
          });
        }
        continue;
      }
      merged[exportName] = collection;
    }
  }

  return {
    keyframesJson:
      Object.keys(merged).length > 0 ? JSON.stringify(merged) : null,
    diagnostics,
  };
}
