import type { Snapshot, StructureResult } from './snapshot';

/**
 * The correspondence guard as a batch gate (PLACES.md §6): does the working
 * tree still correspond to the generation these artifacts describe, file by
 * file? A failing entry is a settled negative answer about staleness — the
 * CI use the charter gates on correspondence being credible.
 */

export interface CheckEntry {
  file: string;
  ok: boolean;
  reason?: Extract<StructureResult, { ok: false }>['reason'];
  detail?: string;
  divergences?: readonly string[];
}

export interface CheckReport {
  ok: boolean;
  generation: string | undefined;
  programHash: string;
  files: readonly CheckEntry[];
}

export const checkSnapshot = (snapshot: Snapshot): CheckReport => {
  const files = snapshot.files().map((file): CheckEntry => {
    const result = snapshot.structureOf(file);
    if (result.ok) return { file, ok: true };
    return {
      file,
      ok: false,
      reason: result.reason,
      detail: result.detail,
      ...(result.divergences === undefined
        ? {}
        : { divergences: result.divergences }),
    };
  });
  return {
    ok: files.every((entry) => entry.ok),
    generation: snapshot.generation,
    programHash: snapshot.host.program.hash,
    files,
  };
};
