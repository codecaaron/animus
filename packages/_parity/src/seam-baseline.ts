import {
  renameSync as renameFileSync,
  rmSync as removeFileSync,
  writeFileSync as writeTextFileSync,
} from 'fs';

import { canonicalPrettyJson } from './content-hash';

import type { JsonObject, JsonValue } from '@animus-ui/assertions';

/**
 * One recorded seam case. A wire contract — it is the value stored under a
 * case id in `tools/seam-baseline.json` — so it is a `type`, and its
 * `diagnostics` stay an uninterpreted JSON value: the battery records what the
 * engine reported and compares it by canonical form, and nothing here decides
 * what a diagnostic means.
 */
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

/**
 * Compare a recorded seam document against a fresh one, case id by case id.
 *
 * Both sides are JSON documents keyed by case id — the baseline is bytes read
 * back off disk — and this comparator deliberately does not interpret a case's
 * value: it decides presence, and then identity under the writer's canonical
 * form. Anything that reads a FIELD of a case is `SeamCaseResult`'s business,
 * not this function's.
 */
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
      // Same canonical form the writer publishes: recorded baselines are
      // key-sorted, fresh engine output is not — raw JSON.stringify would
      // flag any non-empty object on key order alone.
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
