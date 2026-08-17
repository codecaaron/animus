import { parseInternalWire } from './internal-wire';

import type { ManifestDiagnostic } from './manifest-diagnostics';

/** Stable codes for external keyframes discovery. */
export const KEYFRAMES_EXTERNAL_ENTRY_FAILED =
  'animus.keyframes.external-entry-failed';
export const KEYFRAMES_EXPORT_COLLISION = 'animus.keyframes.export-collision';

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
  const merged: Record<string, unknown> = {};
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
          `external package entry failed the keyframes scan — its collections are invisible to extraction: ${String(error)}. ` +
          `Keyframe collections must be reachable from the package's definition entry without evaluating framework re-exports: ` +
          `export them (directly or as a named re-export) from the definition entry, and avoid \`export *\` of framework packages there ` +
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
    const collections = parseInternalWire<Record<string, unknown>>(
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
