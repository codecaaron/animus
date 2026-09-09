/**
 * The CLI published-set contract, shared logic (openspec:
 * standalone-extraction-cli D3): ONE declaration of the two wire artifacts
 * that govern the flat `.animus/` tree — the `commit.json` record and the
 * `lock.json` advisory claim — ONE implementation of "does this flat
 * artifact set verify against its commit record", ONE liveness policy for a
 * lock holder (its pid probe plus its heartbeat staleness window), ONE
 * stamp/refresh/release lifecycle for a holder that keeps a claim, and ONE
 * collector for the session's copied asset() files.
 * Consumed by the CLI writer (the only producer of the commit record, and
 * the claimant of the flat tree it publishes into), by the session's start
 * hygiene (confinement gate), and by the session itself, which claims its
 * own session directory with the SAME record so a sibling reconciling
 * replacement epochs can tell a live session from an abandoned one. The
 * NAMES live in session-paths beside the rest of the artifact vocabulary;
 * the SHAPES and the policies that read them live here.
 *
 * Two copies of the verification had already drifted once: the hygiene copy
 * verified payloads as UTF-8 strings while the writer hashed raw bytes, so
 * any asset-carrying set (fonts are not UTF-8) could never verify and a
 * legitimately published set was classified as debris.
 */

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
 * `lock.json`'s wire shape — an advisory claim on the directory holding it,
 * written by the CLI over the flat tree it publishes into (where it is also
 * the single-writer lock) and by a session over its own session tree.
 * `startedAt` is reported to the user verbatim, so it is decoded as a string
 * or dropped; an unvalidated field renders as `[object Object]` in the
 * conflict message. `heartbeatAt` is the holder's proof of life, rewritten
 * every `CLI_LOCK_HEARTBEAT_INTERVAL_MS` while the claim is held — a pid
 * alone cannot carry that proof, since the operating system hands the number
 * to an unrelated process once the holder dies.
 */
export interface CliLockRecord {
  pid: number;
  startedAt?: string;
  heartbeatAt?: string;
}

/** How often a lock holder rewrites `heartbeatAt` while it owns the tree.
 *  One cadence for every holder: the staleness window below is a count of
 *  missed refreshes, so a holder on its own schedule would be judged by a
 *  window that means nothing for it. A minute, because the timer wakes a
 *  process that is otherwise idle for hours (a dev server holding a session
 *  claim); the window below buys the tolerance. */
export const CLI_LOCK_HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * A claim whose heartbeat is older than this has no live holder. Five missed
 * refreshes: extraction runs synchronously on the holder's main thread, so a
 * large analysis can block the refresh timer for several intervals, and a
 * window a busy holder can miss would let a second writer onto a tree that is
 * mid-publish.
 */
export const CLI_LOCK_STALE_AFTER_MS = 5 * CLI_LOCK_HEARTBEAT_INTERVAL_MS;

/** Whether a decoded claim still has a live holder, and when it does not,
 *  WHICH condition decided it — the steal is logged with its evidence. */
export type CliLockLiveness = { live: true } | { live: false; reason: string };

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

/**
 * Is the process holding the lock still running? Signal 0 is a pure
 * existence probe. EPERM is the decisive case: the process EXISTS and this
 * one may not signal it (a lock taken under another uid), and reading that
 * as "dead" is the unsafe direction on BOTH sides of this seam — the writer
 * would steal a live holder's tree and race it, and the session's hygiene
 * would delete artifacts a live CLI is mid-way through publishing. Every
 * other failure (no such process, an unusable pid value) means no holder.
 *
 * This is the pid primitive, not the lock policy: a pid the kernel reissued
 * to an unrelated process answers `true` here, which is why a decoded claim
 * is judged by `checkLockLiveness` (pid AND heartbeat) instead. Debris named
 * after a pid and nothing else — an interrupted publish's staging tree — has
 * no heartbeat to consult and probes the pid directly.
 */
export function isLockHolderAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isPermissionDenied(error);
  }
}

/**
 * The one liveness policy for a decoded lock claim, shared by both readers
 * that may act destructively on it: the CLI writer, which steals the tree,
 * and the session's start hygiene, which deletes flat payloads. Callers must
 * not add a second.
 *
 * A claim is live when its holder process is running AND its heartbeat is
 * inside the staleness window. The pid probe alone is not enough — nothing
 * stops the kernel from handing a dead run's pid number to an unrelated
 * process, and a reused pid wedges the directory permanently. A record
 * carrying no heartbeat offers no staleness evidence, so the pid probe alone
 * decides it: stealing a tree from a holder that may be alive is the unsafe
 * direction on both sides.
 */
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

/**
 * The bytes of this process's claim on a directory — the one serializer of
 * `lock.json`, shared by the CLI writer and by the session. `heartbeatAt` is
 * re-stamped on every write; it is the proof of life a pid number cannot
 * carry once the kernel reissues it.
 */
export function lockRecordBytes(startedAt: string): string {
  return JSON.stringify({
    pid: process.pid,
    startedAt,
    heartbeatAt: new Date().toISOString(),
  } satisfies CliLockRecord);
}

/** This holder's private scratch name for a write-then-rename refresh,
 *  pid-suffixed so two holders over one tree never share a temp path. */
const HEARTBEAT_TEMP_PREFIX = '.lock-heartbeat-';

export interface DirectoryClaimOptions {
  /**
   * How the holder rewrites the record it already owns.
   *
   * `in-place` (the default) is for a claim whose directory a file watcher
   * observes — the session tree, which carries the epoch artifact a dev
   * server watches: a rename replaces a directory entry and so moves the
   * directory's mtime every interval, which starts phantom rebuilds. Its
   * cost is that a reader can catch a truncated record, which decodes as
   * `indeterminate` — the same outcome that reader would reach anyway.
   *
   * `rename` is for a claim whose reader refuses an undecodable record — the
   * CLI's output tree, where a torn read costs the next run its output
   * directory, and where nothing watches for churn.
   */
  write?: 'in-place' | 'rename';
  /** When the claim began, reported verbatim in a conflict message. Passed
   *  by a holder that took the claim earlier (the CLI's exclusive create). */
  startedAt?: string;
}

/**
 * Claim `dir` for as long as this process owns it: stamp the record now and
 * re-stamp it every `CLI_LOCK_HEARTBEAT_INTERVAL_MS`; the returned release
 * stops the refresh and removes the record. The one stamp/refresh/release
 * lifecycle for every holder — the session over its own session tree, and
 * the CLI writer over the flat tree it publishes into.
 *
 * Not itself an exclusion claim: this call neither creates exclusively nor
 * steals. A holder that needs exclusion (the CLI writer) takes it first and
 * hands the held claim here.
 *
 * A refresh that fails ends the claim and says so once — a record that
 * cannot be written cannot be refreshed either, so retrying every interval
 * would repeat one line forever.
 */
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
      // A tree that is gone leaves nothing to claim and nothing to say. Any
      // other failure is loud, because its consequence is silent: an
      // unrefreshed claim reads as abandoned, and this directory's artifacts
      // become prunable — or its output directory stealable — while their
      // owner is still publishing.
      if (isMissingFile(error)) return;
      console.error(
        `[animus] Could not write the directory claim ${path}: ${String(error)}`
      );
    }
  };
  stamp();
  if (!stopped) {
    refresh = setInterval(stamp, CLI_LOCK_HEARTBEAT_INTERVAL_MS);
    // The refresh must never be a reason for the process to stay alive.
    refresh.unref?.();
  }
  return () => {
    stop();
    if (rename) rmSync(tempPath, { force: true });
    rmSync(path, { force: true });
  };
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
