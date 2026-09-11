import {
  renameSync as renameFileSync,
  rmSync as removeFileSync,
  writeFileSync as writeTextFileSync,
} from 'fs';

import { canonicalPrettyJson } from './content-hash';

import type { JsonObject, JsonValue } from '@animus-ui/assertions';

/** One recorded seam case, stored under a case id in `seam-baseline.json`.
 *  `diagnostics` stays uninterpreted: recorded and compared, never read. */
export type SeamCaseResult = {
  css: string;
  diagnostics: JsonValue;
};

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
  baseline: JsonObject,
  candidate: JsonObject
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
    } else if (
      // Recorded baselines are key-sorted and fresh engine output is not, so
      // a raw `JSON.stringify` compare would flag key order alone.
      canonicalPrettyJson(baseline[id]) !== canonicalPrettyJson(candidate[id])
    ) {
      failures.push(`${id}: output differs`);
    }
  }
  return failures;
}

export function writeJsonFileAtomic(
  target: string,
  value: JsonValue,
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
