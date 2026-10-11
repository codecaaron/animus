/**
 * What a host's transform reads from a published manifest (SA1): the files
 * it lists components for, which must transform, and the extensions it
 * dropped over a parent the analysis could not resolve, which must not be
 * served untransformed (spec §12.2 row 11).
 */

import type { ManifestMissingInput, ProjectManifest } from './manifest-schema';

export interface ServedFiles {
  listed: ReadonlySet<string>;
  dropped: ReadonlyMap<string, ManifestMissingInput>;
}

export function servedFiles(
  manifest: Pick<ProjectManifest, 'files' | 'missing_inputs'>
): ServedFiles {
  const dropped = new Map<string, ManifestMissingInput>();
  for (const input of manifest.missing_inputs ?? []) {
    if (!dropped.has(input.file)) dropped.set(input.file, input);
  }
  return {
    listed: new Set(
      Object.entries(manifest.files ?? {})
        .filter(([, ids]) => ids.length > 0)
        .map(([file]) => file)
    ),
    dropped,
  };
}

/** Why a file dropped over its extension parent is not served: its builder
 *  code would render with empty classes. */
export function droppedExtensionMessage(drop: ManifestMissingInput): string {
  const from = drop.specifier === null ? '' : ` from '${drop.specifier}'`;
  return (
    `[animus-extract] cannot serve ${drop.file}: '${drop.component}' ` +
    `extends '${drop.parent}'${from}, which the analysis could not resolve ` +
    `(${drop.outcome}); serving it untransformed would render it without ` +
    `its styles. Make the parent an analysed Animus component, or remove ` +
    `the extension.`
  );
}
