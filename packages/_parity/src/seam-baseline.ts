import {
  renameSync as renameFileSync,
  rmSync as removeFileSync,
  writeFileSync as writeTextFileSync,
} from 'fs';

import { canonicalPrettyJson } from './content-hash';

interface AtomicFileOps {
  writeFileSync: (path: string, content: string) => void;
  renameSync: (from: string, to: string) => void;
  rmSync: (path: string, options: { force: boolean }) => void;
}

const DEFAULT_FILE_OPS: AtomicFileOps = {
  writeFileSync: writeTextFileSync,
  renameSync: renameFileSync,
  rmSync: removeFileSync,
};

export function compareSeamResults(
  baseline: Record<string, unknown>,
  candidate: Record<string, unknown>
): string[] {
  const ids = [
    ...new Set([...Object.keys(baseline), ...Object.keys(candidate)]),
  ].sort();
  const failures: string[] = [];
  for (const id of ids) {
    if (!Object.hasOwn(baseline, id)) {
      failures.push(`${id}: missing from baseline`);
    } else if (!Object.hasOwn(candidate, id)) {
      failures.push(`${id}: missing from candidate`);
    } else if (JSON.stringify(baseline[id]) !== JSON.stringify(candidate[id])) {
      failures.push(`${id}: output differs`);
    }
  }
  return failures;
}

export function writeJsonFileAtomic(
  target: string,
  value: unknown,
  fileOps: AtomicFileOps = DEFAULT_FILE_OPS
): void {
  const next = `${target}.next-${process.pid}-${Date.now()}`;
  try {
    fileOps.writeFileSync(next, canonicalPrettyJson(value));
    fileOps.renameSync(next, target);
  } catch (error) {
    try {
      fileOps.rmSync(next, { force: true });
    } catch {
      // Preserve the original write/publish failure.
    }
    throw error;
  }
}
