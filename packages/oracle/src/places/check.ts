import type { Snapshot, StructureResult } from './snapshot';

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
    const entry: CheckEntry = {
      file,
      ok: false,
      reason: result.reason,
      detail: result.detail,
    };
    if (result.divergences !== undefined)
      entry.divergences = result.divergences;
    return entry;
  });
  return {
    ok: files.every((entry) => entry.ok),
    generation: snapshot.generation,
    programHash: snapshot.host.program.hash,
    files,
  };
};
