/**
 * Sibling-epoch reconciliation against a live sibling session.
 *
 * Every epoch value move deletes each sibling session's
 * `replacements-epoch` artifact whose bytes disagree, so restored webpack
 * snapshots built by a session that is gone invalidate. A sibling that is
 * still running is a different case: its snapshots are valid for its own
 * epoch, deleting its artifact reconciles nothing, and the deletion costs it
 * a full rebuild (`animus build --mode production` beside a dev server). A
 * sibling whose directory carries a live owner claim — the same `lock.json`
 * record and `checkLockLiveness` policy the CLI's advisory lock uses — is
 * skipped with one warning; every other sibling prunes.
 *
 * NAPI boundary mocked; the session and the pure pipeline helpers run for
 * real over a temp project.
 */
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSystemModule: vi.fn(),
  analyzeProject: vi.fn(),
  clearAnalysisCache: vi.fn(),
}));

import { setEngineApiOverride } from '../../session/singleton';

// Engine API injection through the singleton's globalThis-keyed test seam.
setEngineApiOverride(() => ({
  extractFacts: () => '{"files":{},"parseCount":0}',
  loadSystemModule: mocks.loadSystemModule,
  analyzeProject: mocks.analyzeProject,
  clearAnalysisCache: mocks.clearAnalysisCache,
}));

import {
  checkLockLiveness,
  CLI_LOCK_STALE_AFTER_MS,
  readCliLockRecord,
} from '../../session/published-set';
import {
  CLI_LOCK_ARTIFACT,
  REPLACEMENT_EPOCH_ARTIFACT,
  sessionsRootDir,
} from '../../session/session-paths';
import {
  buildManifest,
  createProject as createFixtureProject,
  disposeTempRoots,
  lockRecord,
  PLAN_A,
  resetAnimusGlobals,
  startSession,
  SYSTEM_CONFIG,
} from './session-fixtures';

import type { CliLockRecord } from '../../session/published-set';

let restoreGlobals: () => void;
let warned: string[];

/** A sibling session directory holding an epoch this session disagrees with,
 *  plus whatever owner claim the case under test gives it. */
function createSibling(
  root: string,
  id: string,
  lock: CliLockRecord | null
): string {
  const dir = join(sessionsRootDir(root), id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, REPLACEMENT_EPOCH_ARTIFACT),
    JSON.stringify({ schema: 1, sessionId: id, epoch: 'a-different-epoch' })
  );
  if (lock !== null) {
    writeFileSync(join(dir, CLI_LOCK_ARTIFACT), JSON.stringify(lock));
  }
  return dir;
}

/**
 * Pid 1 as the foreign live owner: it exists on every POSIX host this suite
 * runs on and is never this process, so the shared pid probe answers "alive"
 * for it either way (the signal succeeds, or it is refused with EPERM, which
 * the probe reads as a process that exists). A fabricated pid number would be
 * a guess about what the kernel has handed out.
 */
const FOREIGN_LIVE_PID = 1;

/** A foreign owner whose heartbeat is stamped now. */
const liveClaim = (): CliLockRecord => lockRecord({ pid: FOREIGN_LIVE_PID });

/** A running pid whose heartbeat stopped long enough ago that the shared
 *  liveness policy calls it dead — deterministic where killing a process and
 *  hoping its number stays unassigned is not. */
const stoppedClaim = (): CliLockRecord =>
  lockRecord({ pid: FOREIGN_LIVE_PID, ageMs: CLI_LOCK_STALE_AFTER_MS * 2 });

/** A fresh claim naming THIS process — a tree this process abandoned, since
 *  only one session per process publishes at a time. */
const ownProcessClaim = (): CliLockRecord => lockRecord();

beforeEach(() => {
  restoreGlobals = resetAnimusGlobals();
  mocks.loadSystemModule.mockReset().mockReturnValue({ ...SYSTEM_CONFIG });
  mocks.analyzeProject
    .mockReset()
    .mockImplementation(() => buildManifest(PLAN_A));
  mocks.clearAnalysisCache.mockReset();
  warned = [];
  vi.spyOn(console, 'warn').mockImplementation((...parts: unknown[]) => {
    warned.push(parts.map(String).join(' '));
  });
});

afterEach(() => {
  restoreGlobals();
  vi.restoreAllMocks();
  disposeTempRoots();
});

describe('a session publishes its own owner claim', () => {
  test('the session directory carries a live claim while the session owns it, and none after close()', async () => {
    const root = createFixtureProject('animus-sibling-live-');
    const session = await startSession(root);

    const claim = readCliLockRecord(session.sessionDir);
    expect(claim.kind).toBe('held');
    if (claim.kind !== 'held') return;
    expect(claim.record.pid).toBe(process.pid);
    expect(checkLockLiveness(claim.record)).toEqual({ live: true });

    session.close();
    expect(readCliLockRecord(session.sessionDir)).toEqual({ kind: 'none' });
  });
});

describe('sibling epoch reconciliation', () => {
  test('a live sibling keeps its epoch artifact and is named in one warning', async () => {
    const root = createFixtureProject('animus-sibling-live-');
    const sibling = createSibling(root, 'live-sibling', liveClaim());

    const session = await startSession(root);

    expect(existsSync(join(sibling, REPLACEMENT_EPOCH_ARTIFACT))).toBe(true);
    const lines = warned.filter((line) => line.includes('live-sibling'));
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('epoch');
    session.close();
  });

  test('a sibling whose owner stopped is pruned', async () => {
    const root = createFixtureProject('animus-sibling-dead-');
    const sibling = createSibling(root, 'stopped-sibling', stoppedClaim());

    const session = await startSession(root);

    expect(existsSync(join(sibling, REPLACEMENT_EPOCH_ARTIFACT))).toBe(false);
    session.close();
  });

  test('a sibling that claims nothing is pruned', async () => {
    const root = createFixtureProject('animus-sibling-none-');
    const sibling = createSibling(root, 'unclaimed-sibling', null);

    const session = await startSession(root);

    expect(existsSync(join(sibling, REPLACEMENT_EPOCH_ARTIFACT))).toBe(false);
    session.close();
  });

  test('the retention prune leaves a live sibling tree alone and removes an abandoned one', async () => {
    const root = createFixtureProject('animus-sibling-retention-');
    const live = createSibling(root, 'live-old-sibling', liveClaim());
    const abandoned = createSibling(root, 'abandoned-sibling', stoppedClaim());
    // Older than the sibling-directory retention window (design D2, 24h).
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000);
    utimesSync(live, stale, stale);
    utimesSync(abandoned, stale, stale);

    const session = await startSession(root);

    expect(existsSync(live)).toBe(true);
    expect(existsSync(abandoned)).toBe(false);
    session.close();
  });

  test('a sibling claiming this process is pruned (one publisher per process)', async () => {
    const root = createFixtureProject('animus-sibling-self-');
    const sibling = createSibling(
      root,
      'own-process-sibling',
      ownProcessClaim()
    );

    const session = await startSession(root);

    expect(existsSync(join(sibling, REPLACEMENT_EPOCH_ARTIFACT))).toBe(false);
    session.close();
  });

  test('a sibling whose claim cannot be decoded is pruned', async () => {
    const root = createFixtureProject('animus-sibling-torn-');
    const sibling = createSibling(root, 'torn-sibling', null);
    writeFileSync(join(sibling, CLI_LOCK_ARTIFACT), '{"pid":');

    const session = await startSession(root);

    expect(existsSync(join(sibling, REPLACEMENT_EPOCH_ARTIFACT))).toBe(false);
    session.close();
  });
});
