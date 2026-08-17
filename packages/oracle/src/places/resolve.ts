import { posix } from 'node:path';

import type { ManifestImportFact } from '../host/animus/manifest-types';
import type { ComponentRecord } from '../providers/identity';

/**
 * Attribute one JSX tag in one file to an extracted component (seam S4). A
 * bare binding that matches two components must never resolve to an
 * arbitrary winner (`IdentityProvider.resolveTarget`'s contract) — but a
 * relative import specifier names one file, so the path can decide what the
 * binding cannot. Anything still ambiguous is returned as such for the
 * analysis to surface, never silently dropped.
 */

export type TagResolution =
  | { kind: 'resolved'; component: ComponentRecord }
  | {
      kind: 'ambiguous';
      candidates: readonly ComponentRecord[];
      specifier?: string;
    }
  | { kind: 'unknown' };

/** Does this component's file answer to the resolved relative specifier? */
const fileAnswersTo = (componentFile: string, resolved: string): boolean =>
  componentFile === resolved ||
  componentFile.startsWith(`${resolved}.`) ||
  componentFile.startsWith(`${resolved}/index.`);

export const resolveComponentTag = (
  components: readonly ComponentRecord[],
  imports: readonly ManifestImportFact[] | undefined,
  file: string,
  tag: string
): TagResolution => {
  const local = components.find(
    (component) => component.file === file && component.binding === tag
  );
  if (local !== undefined) return { kind: 'resolved', component: local };

  const entry = imports?.find((fact) => fact.local === tag);
  const name = entry?.imported ?? tag;
  const candidates = components.filter(
    (component) => component.binding === name
  );
  if (candidates.length === 0) return { kind: 'unknown' };
  if (candidates.length === 1) {
    return { kind: 'resolved', component: candidates[0] };
  }

  const specifier = entry?.source;
  if (specifier !== undefined && specifier.startsWith('.')) {
    const target = posix.join(posix.dirname(file), specifier);
    const byPath = candidates.filter((component) =>
      fileAnswersTo(component.file, target)
    );
    if (byPath.length === 1) {
      return { kind: 'resolved', component: byPath[0] };
    }
  }
  // No import specifier means no `specifier` key — the analysis reads its
  // absence as "the binding was never imported", not "imported from nowhere".
  const ambiguous: Extract<TagResolution, { kind: 'ambiguous' }> = {
    kind: 'ambiguous',
    candidates,
  };
  if (specifier !== undefined) ambiguous.specifier = specifier;
  return ambiguous;
};
