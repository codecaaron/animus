/**
 * What a host's transform reads from a published manifest (SA1): the files
 * it lists components for, which must transform, the extensions it
 * dropped over a parent the analysis could not resolve, which must not be
 * served untransformed (spec §12.2 row 11), and the files whose builder
 * chains the transform marks pure, which may.
 */

import type { ManifestMissingInput, ProjectManifest } from './manifest-schema';

export interface ServedFiles {
  listed: ReadonlySet<string>;
  dropped: ReadonlyMap<string, ManifestMissingInput>;
  builders: ReadonlySet<string>;
}

export function servedFiles(
  manifest: Pick<ProjectManifest, 'files' | 'missing_inputs' | 'builderFiles'>
): ServedFiles {
  const dropped = new Map<string, ManifestMissingInput>();
  for (const input of manifest.missing_inputs ?? []) {
    // SA1 is decided by cause: a parent that resolves but is unextractable
    // is a refusal the analysis completed (PF1), so its extension is
    // delivered with the chain in place and the finding reported, as the
    // parent is.
    if (input.outcome === 'failed-parent') continue;
    if (!dropped.has(input.file)) dropped.set(input.file, input);
  }
  return {
    listed: new Set(
      Object.entries(manifest.files ?? {})
        .filter(([, ids]) => ids.length > 0)
        .map(([file]) => file)
    ),
    dropped,
    builders: new Set(manifest.builderFiles ?? []),
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
