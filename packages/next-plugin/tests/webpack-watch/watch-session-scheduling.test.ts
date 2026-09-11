// @vitest-environment node
/**
 * Scripted edits must land between compilation turns: a write during a turn
 * makes the loader read newer source than the published analysis.
 */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, test } from 'vitest';

import { createWatchState, runWatchSession } from './watch-session';

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

type HarnessWebpack = Parameters<typeof runWatchSession>[0]['webpack'];
type HarnessCompiler = ReturnType<HarnessWebpack>;
type HarnessWatch = HarnessCompiler['watch'];
type WatchRunTap = Parameters<
  HarnessCompiler['hooks']['watchRun']['tapPromise']
>[1];
type WatchDoneCallback = Parameters<HarnessWatch>[1];
type HarnessStats = Parameters<WatchDoneCallback>[1];

function makeFakeCompiler(opts: {
  buildMs: number;
  aggregateMs: number;
  echo?: { afterTurn: number; delayMs: number };
}) {
  const taps: WatchRunTap[] = [];
  const stats: HarnessStats = {
    hasErrors: () => false,
    compilation: { errors: [], modules: [] },
  };
  let doneCb: WatchDoneCallback = () => {};
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

  const compiler: HarnessCompiler = {
    options: {},
    hooks: {
      watchRun: {
        tapPromise: (_name, fn) => {
          taps.push(fn);
        },
      },
      invalid: {
        tap: (_name, _fn) => {},
      },
    },
    watch: (_watchOptions, cb) => {
      doneCb = cb;
      startTurn(['<cold>']);
      return {
        close: (done) => {
          closed = true;
          done();
        },
      };
    },
    close: (done) => done(),
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
    // Calibrated so the echo turn is still in flight when an unguarded step
    // timer would fire; without that overlap the hazard does not reproduce.
    const fake = makeFakeCompiler({
      buildMs: 300,
      aggregateMs: 30,
      echo: { afterTurn: 1, delayMs: 40 },
    });

    const records = await runWatchSession({
      webpack: () => fake.compiler,
      root,
      config: {},
      state,
      steps: [
        () => fake.write('src/parent.js'),
        () => fake.write('src/parent.js'),
      ],
      settleMs: 250,
    });

    expect(fake.violations()).toEqual([]);
    expect(records).toHaveLength(4);
    expect(records[1].modifiedFiles).toEqual(['<spontaneous>']);
    expect(records[2].modifiedFiles).toEqual(['src/parent.js']);
    expect(records[3].modifiedFiles).toEqual(['src/parent.js']);
  });
});
