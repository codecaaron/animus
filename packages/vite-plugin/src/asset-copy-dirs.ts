/**
 * Each process's dev asset copies live in their own directory, named by its
 * pid and start time, so a sweep can tell an abandoned directory from a
 * live server's even when the pid has been reused.
 */

import { isLockHolderAlive } from '@animus-ui/extract/session';
import { execFileSync } from 'child_process';
import { readdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';

/** A directory left this long is swept unless its owner proves live. */
const ABANDONED_AFTER_MS = 24 * 60 * 60 * 1000;
/** `ps` reports start times to the second. */
const START_TIME_TOLERANCE_MS = 2000;

const processStartMs = Math.round(Date.now() - process.uptime() * 1000);

/** This process's copy directory name: `<pid>-<start ms>`. */
export function processCopyDir(): string {
  return `${process.pid}-${processStartMs}`;
}

/** When `pid` started, as `ps` reports it: null where `ps` ran and could
 *  not say, `'unavailable'` where there is no `ps` (Windows). */
function startTimeOf(pid: number): number | null | 'unavailable' {
  if (process.platform === 'win32') return 'unavailable';
  try {
    const started = Date.parse(
      execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    );
    return Number.isNaN(started) ? null : started;
  } catch (error) {
    // SAFETY: `error` is execFileSync's throw; only a missing executable's
    // `ENOENT` code is acted on.
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return 'unavailable';
    }
    return null;
  }
}

/** Whether the process that named `entry` is still running. A young
 *  directory needs only a live pid; one past ABANDONED_AFTER_MS needs its
 *  recorded start time to match the running process too. */
function ownerLive(copyRoot: string, entry: string): boolean {
  const match = /^(\d+)-(\d+)$/.exec(entry);
  if (match === null) return false;
  const pid = Number(match[1]);
  const startMs = Number(match[2]);
  if (!isLockHolderAlive(pid)) return false;
  let ageMs: number;
  try {
    ageMs = Date.now() - statSync(join(copyRoot, entry)).mtimeMs;
  } catch {
    return false;
  }
  if (ageMs < ABANDONED_AFTER_MS) return true;
  const started = startTimeOf(pid);
  // Without `ps`, a live pid keeps its directory: a reused pid may then keep
  // an abandoned one, which beats sweeping a live server's served copies.
  if (started === 'unavailable') return true;
  return (
    started !== null && Math.abs(started - startMs) <= START_TIME_TOLERANCE_MS
  );
}

/** The copy roots this process has swept: once per process. */
const sweptCopyRoots = new Set<string>();

/** Removes every other process's copy directory whose owner is not live. */
export function sweepAbandonedCopyDirs(copyRoot: string): void {
  if (sweptCopyRoots.has(copyRoot)) return;
  sweptCopyRoots.add(copyRoot);
  let entries: string[];
  try {
    entries = readdirSync(copyRoot);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === processCopyDir() || ownerLive(copyRoot, entry)) continue;
    rmSync(join(copyRoot, entry), { recursive: true, force: true });
  }
}
