// @vitest-environment node
/**
 * Step-scheduling contract of `runWatchSession`: scripted edits are
 * BETWEEN-TURNS events. The suite tolerates spontaneous extra compilations
 * (OS event redelivery, cold-artifact re-checks — the probes' record-count
 * bounds say so), and a fixed post-completion timer can land an edit in the
 * MIDDLE of such a turn. A mid-compilation source write makes the loader
 * read newer source than the published analysis and fail closed with
 * ANIMUS_ANALYSIS_CATCHING_UP — an environmental artifact of the harness,
 * not a behavior of the integration under test (observed as CI-only
 * hasErrors failures in the differential N0 probes).
 *
 * Driven by a scripted fake compiler so the hazard reproduces
 * deterministically on every platform.
 */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, test } from 'vitest';

import { createWatchState, runWatchSession } from './harness';

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

interface FakeStats {
  hasErrors: () => boolean;
  compilation: { errors: unknown[]; modules: unknown[] };
}

/**
 * Scripted stand-in for a watching webpack compiler: every turn runs the
 * registered watchRun taps, then completes after `buildMs`. A source write
 * while idle triggers the next turn after `aggregateMs`; a write while a
 * turn is ACTIVE is recorded as a violation and queued for the turn after
 * (real watchpack's changed-during-build behavior). One spontaneous "echo"
 * turn starts `echo.delayMs` after turn `echo.afterTurn` completes —
 * unprompted, empty-handed, exactly like the redelivery/cold-artifact turns
 * the gauntlet probes tolerate.
 */
function makeFakeCompiler(opts: {
  buildMs: number;
  aggregateMs: number;
  echo?: { afterTurn: number; delayMs: number };
}) {
  type WatchRunTap = (c: { modifiedFiles: Set<string> }) => Promise<void>;
  const taps: WatchRunTap[] = [];
  const stats: FakeStats = {
    hasErrors: () => false,
    compilation: { errors: [], modules: [] },
  };
  let doneCb: (err: Error | null, stats: FakeStats) => void = () => {};
  let active = false;
  let closed = false;
  let turnCount = 0;
  let echoFired = false;
  const queued: string[] = [];
  const writesDuringActiveTurn: string[] = [];

  const startTurn = (trigger: string[]): void => {
    if (closed || active) return;
    active = true;
    turnCount += 1;
    const c = { modifiedFiles: new Set(trigger) };
    void Promise.all(taps.map((tap) => tap(c))).then(() => {
      setTimeout(() => {
        active = false;
        if (closed) return;
        doneCb(null, stats);
        afterTurn();
      }, opts.buildMs);
    });
  };

  const afterTurn = (): void => {
    if (opts.echo && !echoFired && turnCount === opts.echo.afterTurn) {
      echoFired = true;
      setTimeout(() => startTurn(['<spontaneous>']), opts.echo.delayMs);
    }
    if (queued.length > 0) {
      const trigger = queued.splice(0);
      setTimeout(() => startTurn(trigger), opts.aggregateMs);
    }
  };

  const write = (file: string): void => {
    if (active) {
      writesDuringActiveTurn.push(`turn ${turnCount}: ${file}`);
      queued.push(file);
      return;
    }
    queued.push(file);
    setTimeout(() => {
      if (queued.length > 0) startTurn(queued.splice(0));
    }, opts.aggregateMs);
  };

  const compiler = {
    options: {},
    hooks: {
      watchRun: {
        tapPromise: (_name: string, fn: WatchRunTap) => {
          taps.push(fn);
        },
      },
    },
    watch: (_watchOptions: unknown, cb: typeof doneCb) => {
      doneCb = cb;
      startTurn(['<cold>']);
      return {
        close: (done: () => void) => {
          closed = true;
          done();
        },
      };
    },
    close: (done: () => void) => done(),
  };

  return {
    compiler,
    write,
    violations: () => [...writesDuringActiveTurn],
  };
}

describe('runWatchSession step scheduling', () => {
  test('scripted edits never land while a compilation is in flight', async () => {
    const root = mkdtempSync(join(tmpdir(), 'animus-harness-sched-'));
    disposers.push(() => rmSync(root, { recursive: true, force: true }));
    const state = createWatchState();
    // Echo turn starts 40ms after the cold build completes and runs 300ms —
    // an unguarded 150ms step timer fires straight into it.
    const fake = makeFakeCompiler({
      buildMs: 300,
      aggregateMs: 30,
      echo: { afterTurn: 1, delayMs: 40 },
    });

    const records = await runWatchSession({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      webpack: (() => fake.compiler) as any,
      root,
      config: {},
      state,
      steps: [
        () => fake.write('src/parent.js'),
        () => fake.write('src/parent.js'),
      ],
      settleMs: 250,
    });

    // The contract under test: between-turns application, every time.
    expect(fake.violations()).toEqual([]);
    // Both edits still applied, each producing its own turn after the echo:
    // cold, echo, edit 1, edit 2.
    expect(records).toHaveLength(4);
    expect(records[1].modifiedFiles).toEqual(['<spontaneous>']);
    expect(records[2].modifiedFiles).toEqual(['src/parent.js']);
    expect(records[3].modifiedFiles).toEqual(['src/parent.js']);
  });
});
