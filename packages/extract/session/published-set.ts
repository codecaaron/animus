import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';

import { contentHash } from '../pipeline/index';
import {
  CLI_COMMIT_ARTIFACT,
  CLI_LOCK_ARTIFACT,
  SESSION_ASSETS_DIR,
} from './session-paths';

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

export interface CommitRecord {
  schema: 1;
  payloads: Record<string, { hash: string }>;
}

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

/** Recompute every recorded payload hash over raw bytes — the writer's own
 *  hashing domain — and return the mismatches; empty means the set verifies. */
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

export interface CliLockRecord {
  pid: number;
  startedAt?: string;
  heartbeatAt?: string;
}

export const CLI_LOCK_HEARTBEAT_INTERVAL_MS = 60_000;

/** A claim whose heartbeat is older than this has no live holder. Five missed
 *  refreshes: synchronous extraction can block the holder's refresh timer. */
export const CLI_LOCK_STALE_AFTER_MS = 5 * CLI_LOCK_HEARTBEAT_INTERVAL_MS;

export type CliLockLiveness = { live: true } | { live: false; reason: string };

export type CliLockRead =
  | { kind: 'none' }
  | { kind: 'held'; record: CliLockRecord }
  | { kind: 'indeterminate' };

interface MissingFileError {
  code: 'ENOENT' | 'ENOTDIR';
}

/** Absence of the file — the only read failure that means "no holder".
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
  const heartbeatAt = candidate.heartbeatAt;
  const record: CliLockRecord = { pid: candidate.pid };
  if (isPublishedSetString(startedAt)) record.startedAt = startedAt;
  if (isPublishedSetString(heartbeatAt)) record.heartbeatAt = heartbeatAt;
  return { kind: 'held', record };
}

interface PermissionDeniedError {
  code: 'EPERM';
}

function isPermissionDenied<Value>(
  error: Value
): error is Value & PermissionDeniedError {
  return error instanceof Object && 'code' in error && error.code === 'EPERM';
}

export function isLockHolderAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isPermissionDenied(error);
  }
}

export function checkLockLiveness(record: CliLockRecord): CliLockLiveness {
  if (!isLockHolderAlive(record.pid)) {
    return { live: false, reason: `holder pid ${record.pid} is not running` };
  }
  const beatAt =
    record.heartbeatAt === undefined
      ? Number.NaN
      : Date.parse(record.heartbeatAt);
  if (Number.isNaN(beatAt)) return { live: true };
  const ageMs = Date.now() - beatAt;
  if (ageMs <= CLI_LOCK_STALE_AFTER_MS) return { live: true };
  return {
    live: false,
    reason:
      `holder pid ${record.pid} is running but its lock heartbeat ` +
      `(${record.heartbeatAt}) is ${Math.round(ageMs / 1000)}s old, past the ` +
      `${CLI_LOCK_STALE_AFTER_MS / 1000}s staleness window — the pid names a ` +
      `different process now`,
  };
}

export function lockRecordBytes(startedAt: string): string {
  return JSON.stringify({
    pid: process.pid,
    startedAt,
    heartbeatAt: new Date().toISOString(),
  } satisfies CliLockRecord);
}

const HEARTBEAT_TEMP_PREFIX = '.lock-heartbeat-';

export interface DirectoryClaimOptions {
  /** `in-place` (default) keeps a watched directory's mtime still — renaming
   *  every interval starts phantom rebuilds; `rename` avoids torn reads. */
  write?: 'in-place' | 'rename';
  startedAt?: string;
}

export function holdDirectoryClaim(
  dir: string,
  options: DirectoryClaimOptions = {}
): () => void {
  const startedAt = options.startedAt ?? new Date().toISOString();
  const path = join(dir, CLI_LOCK_ARTIFACT);
  const tempPath = join(dir, `${HEARTBEAT_TEMP_PREFIX}${process.pid}`);
  const rename = options.write === 'rename';
  let refresh: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  const stop = (): void => {
    stopped = true;
    if (refresh !== null) clearInterval(refresh);
    refresh = null;
  };
  const stamp = (): void => {
    try {
      if (rename) {
        writeFileSync(tempPath, lockRecordBytes(startedAt));
        renameSync(tempPath, path);
      } else {
        writeFileSync(path, lockRecordBytes(startedAt));
      }
    } catch (error) {
      stop();
      // A missing tree leaves nothing to claim. Any other failure is loud: an
      // unrefreshed claim reads as abandoned while its owner still publishes.
      if (isMissingFile(error)) return;
      console.error(
        `[animus] Could not write the directory claim ${path}: ${String(error)}`
      );
    }
  };
  stamp();
  if (!stopped) {
    refresh = setInterval(stamp, CLI_LOCK_HEARTBEAT_INTERVAL_MS);
    refresh.unref?.();
  }
  return () => {
    stop();
    if (rename) rmSync(tempPath, { force: true });
    rmSync(path, { force: true });
  };
}

export interface SessionAsset {
  name: string;
  bytes: Buffer;
}

/** Snapshot the session's copied asset() files, sorted, BEFORE the session
 *  tree is disposed. Drivers publish them beside the emitted stylesheet. */
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
