/**
 * The CLI published-set contract, shared logic (openspec:
 * standalone-extraction-cli D3): ONE declaration of the two wire artifacts
 * that govern the flat `.animus/` tree — the `commit.json` record and the
 * `lock.json` advisory claim — ONE implementation of "does this flat
 * artifact set verify against its commit record", ONE liveness predicate for
 * a lock holder, and ONE collector for the session's copied asset() files.
 * Consumed by the CLI writer (the only producer of both artifacts:
 * staging/verification and lock acquisition) and by the session's start
 * hygiene (confinement gate). The NAMES live in session-paths beside the
 * rest of the artifact vocabulary; the SHAPES and the policies that read
 * them live here.
 *
 * Two copies of the verification had already drifted once: the hygiene copy
 * verified payloads as UTF-8 strings while the writer hashed raw bytes, so
 * any asset-carrying set (fonts are not UTF-8) could never verify and a
 * legitimately published set was classified as debris.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { contentHash } from '../pipeline/index';
import {
  CLI_COMMIT_ARTIFACT,
  CLI_LOCK_ARTIFACT,
  SESSION_ASSETS_DIR,
} from './session-paths';

/** The JSON value domain of the flat tree's records. Both artifacts are
 *  decoded from bytes this process did not produce, so an unmodeled key is a
 *  value the reader can decide about rather than dereference on faith. */
type PublishedSetJsonValue =
  | null
  | boolean
  | number
  | string
  | PublishedSetJsonValue[]
  | PublishedSetJsonRecord;

interface PublishedSetJsonRecord {
  [key: string]: PublishedSetJsonValue;
}

/**
 * A keyed JSON block, decided by representation tag: `[object Object]` is
 * what separates a record from a LIST, and an array that slipped through as
 * "an object" is exactly how a payload map naming nothing once verified
 * vacuously.
 */
function isPublishedSetRecord(
  value: PublishedSetJsonValue
): value is PublishedSetJsonRecord {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function isPublishedSetString(value: PublishedSetJsonValue): value is string {
  return Object.prototype.toString.call(value) === '[object String]';
}

function isPublishedSetNumber(value: PublishedSetJsonValue): value is number {
  return Object.prototype.toString.call(value) === '[object Number]';
}

/**
 * `commit.json`'s wire shape (openspec: standalone-extraction-cli D3) — the
 * externally-verifiable record the CLI writer publishes LAST, carrying one
 * content hash per payload (asset files included) so a reader holding only
 * the record and the bytes can decide set completeness for itself.
 */
export interface CommitRecord {
  schema: 1;
  payloads: Record<string, { hash: string }>;
}

/**
 * Decode `commit.json` bytes, or null when they are not a schema-1 record —
 * the ONE acceptance policy for this artifact. Everything the record claims
 * is checked before any of it is believed: a `payloads` that is an array
 * (or anything but a keyed block) and an entry whose hash is not a string
 * are rejected here rather than enumerated into a vacuous pass.
 */
export function decodeCommitRecord(bytes: string): CommitRecord | null {
  let candidate: PublishedSetJsonValue;
  try {
    candidate = JSON.parse(bytes);
  } catch {
    return null;
  }
  if (!isPublishedSetRecord(candidate) || candidate.schema !== 1) return null;
  const declared = candidate.payloads;
  if (!isPublishedSetRecord(declared)) return null;
  const payloads: CommitRecord['payloads'] = {};
  for (const [name, entry] of Object.entries(declared)) {
    if (!isPublishedSetRecord(entry) || !isPublishedSetString(entry.hash))
      return null;
    payloads[name] = { hash: entry.hash };
  }
  return { schema: 1, payloads };
}

/**
 * Recompute every payload hash recorded in the directory's commit record
 * and compare — raw bytes on both sides, matching the writer's hashing
 * domain. Returns failure lines; empty means the set verifies. An absent
 * or undecodable record is itself a failure (the record is written LAST, so
 * a torn or aborted publish cannot verify).
 */
export function verifyCommitRecord(dir: string): string[] {
  let bytes: string;
  try {
    bytes = readFileSync(join(dir, CLI_COMMIT_ARTIFACT), 'utf-8');
  } catch (error) {
    return [`commit record unreadable: ${String(error)}`];
  }
  const record = decodeCommitRecord(bytes);
  if (record === null) {
    return ['commit record is not a schema-1 payload record'];
  }
  const failures: string[] = [];
  for (const [name, entry] of Object.entries(record.payloads)) {
    try {
      const actual = contentHash(readFileSync(join(dir, name)));
      if (actual !== entry.hash) {
        failures.push(`${name}: bytes do not match the commit record`);
      }
    } catch (error) {
      failures.push(`${name}: unreadable (${String(error)})`);
    }
  }
  return failures;
}

/**
 * `lock.json`'s wire shape — the CLI's single-writer advisory claim on a
 * flat tree. `startedAt` is reported to the user verbatim, so it is decoded
 * as a string or dropped; an unvalidated field renders as `[object Object]`
 * in the conflict message.
 */
export interface CliLockRecord {
  pid: number;
  startedAt?: string;
}

/**
 * What `dir`'s advisory lock says about its holder. Both readers sit on a
 * DESTRUCTIVE path — the writer may steal the tree, the session's hygiene
 * may delete its payloads — so "no holder" is a claim that must be earned:
 * - `none` — the lock file is not there (ENOENT; a `.animus` that is not a
 *   directory cannot hold one either). Nothing claims the tree.
 * - `held` — a decoded claim, whose pid liveness the caller probes.
 * - `indeterminate` — the file EXISTS but its bytes are not a lock record
 *   (torn write, hand edit). The holder is unknown, never absent.
 * Any other read failure (EACCES on a tree you may be about to bulldoze,
 * EISDIR, …) throws: an unreadable lock is not an unlocked tree.
 */
export type CliLockRead =
  | { kind: 'none' }
  | { kind: 'held'; record: CliLockRecord }
  | { kind: 'indeterminate' };

interface MissingFileError {
  code: 'ENOENT' | 'ENOTDIR';
}

/** Absence of the lock FILE — the only read failure that means "no holder".
 *  ENOTDIR joins ENOENT: the path cannot exist under a non-directory. */
function isMissingFile<Value>(error: Value): error is Value & MissingFileError {
  return (
    error instanceof Object &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}

export function readCliLockRecord(dir: string): CliLockRead {
  let bytes: string;
  try {
    bytes = readFileSync(join(dir, CLI_LOCK_ARTIFACT), 'utf-8');
  } catch (error) {
    if (isMissingFile(error)) return { kind: 'none' };
    throw error;
  }
  let candidate: PublishedSetJsonValue;
  try {
    candidate = JSON.parse(bytes);
  } catch {
    return { kind: 'indeterminate' };
  }
  if (
    !isPublishedSetRecord(candidate) ||
    !isPublishedSetNumber(candidate.pid)
  ) {
    return { kind: 'indeterminate' };
  }
  const startedAt = candidate.startedAt;
  return {
    kind: 'held',
    record: isPublishedSetString(startedAt)
      ? { pid: candidate.pid, startedAt }
      : { pid: candidate.pid },
  };
}

interface PermissionDeniedError {
  code: 'EPERM';
}

function isPermissionDenied<Value>(
  error: Value
): error is Value & PermissionDeniedError {
  return error instanceof Object && 'code' in error && error.code === 'EPERM';
}

/**
 * Is the process holding the lock still running? Signal 0 is a pure
 * existence probe. EPERM is the decisive case: the process EXISTS and this
 * one may not signal it (a lock taken under another uid), and reading that
 * as "dead" is the unsafe direction on BOTH sides of this seam — the writer
 * would steal a live holder's tree and race it, and the session's hygiene
 * would delete artifacts a live CLI is mid-way through publishing. Every
 * other failure (no such process, an unusable pid value) means no holder.
 */
export function isLockHolderAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isPermissionDenied(error);
  }
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
