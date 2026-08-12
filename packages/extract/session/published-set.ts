/**
 * The CLI published-set contract, shared logic (openspec:
 * standalone-extraction-cli D3): ONE implementation of "does this flat
 * artifact set verify against its commit record" and ONE collector for the
 * session's copied asset() files — consumed by the CLI writer
 * (staging/verification) and the session's start hygiene (confinement
 * gate). Two copies of either had already drifted once: the hygiene copy
 * verified payloads as UTF-8 strings while the writer hashed raw bytes, so
 * any asset-carrying set (fonts are not UTF-8) could never verify and a
 * legitimately published set was classified as debris.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { contentHash } from '../pipeline/index';
import { CLI_COMMIT_ARTIFACT, SESSION_ASSETS_DIR } from './session-paths';

/**
 * Recompute every payload hash recorded in the directory's commit record
 * and compare — raw bytes on both sides, matching the writer's hashing
 * domain. Returns failure lines; empty means the set verifies. An absent
 * or unparsable record is itself a failure (the record is written LAST, so
 * a torn or aborted publish cannot verify).
 */
export function verifyCommitRecord(dir: string): string[] {
  let record: {
    schema?: number;
    payloads?: Record<string, { hash?: string }>;
  };
  try {
    record = JSON.parse(readFileSync(join(dir, CLI_COMMIT_ARTIFACT), 'utf-8'));
  } catch (error) {
    return [`commit record unreadable: ${String(error)}`];
  }
  if (
    record.schema !== 1 ||
    typeof record.payloads !== 'object' ||
    record.payloads === null
  ) {
    return ['commit record is not a schema-1 payload record'];
  }
  const failures: string[] = [];
  for (const [name, entry] of Object.entries(record.payloads)) {
    try {
      const actual = contentHash(readFileSync(join(dir, name)));
      if (actual !== entry?.hash) {
        failures.push(`${name}: bytes do not match the commit record`);
      }
    } catch (error) {
      failures.push(`${name}: unreadable (${String(error)})`);
    }
  }
  return failures;
}

/** One published asset file: its session-relative name and raw bytes. */
export interface SessionAsset {
  name: string;
  bytes: Buffer;
}

/**
 * Snapshot the session's copied asset() files (sorted by name) — read
 * BEFORE the session tree is disposed. The emitted stylesheet references
 * them as `./assets/<name>`, so every driver must publish them beside its
 * stylesheet or the urls dangle.
 */
export function collectSessionAssets(
  sessionDir: string | null
): SessionAsset[] {
  if (!sessionDir) return [];
  const dir = join(sessionDir, SESSION_ASSETS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .map((name) => ({ name, bytes: readFileSync(join(dir, name)) }));
}
