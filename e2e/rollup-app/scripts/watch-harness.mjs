// The shared instrument both `animus watch` scenarios in this lane run on.
//
// Orchestration is spawned-process with event/condition waits ONLY — no bare
// sleeps. One platform caveat is handled explicitly: macOS FSEvents can drop a
// change written moments after watcher registration, so `mutateUntil` REWRITES
// its target if the observation condition has not appeared within the attempt
// window — attempts are seconds apart, never sub-50ms same-path rewrites.
//
// The published-set readers are the SESSION's own
// (`@animus-ui/extract/session`): the writer hashes raw bytes, so a scenario
// that recomputed hashes over a utf-8 read would mangle binary asset entries
// (fonts) and fail a correct publication.
import {
  decodeCommitRecord,
  verifyCommitRecord,
} from '@animus-ui/extract/session';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The lane root (e2e/rollup-app) and the CLI its assertions drive. */
export const lane = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const bin = join(lane, 'node_modules', '.bin', 'animus');

/** Assertions that did not hold, in the order they were checked. */
export const failures = [];

/** Record one assertion, naming it on stdout either way. */
export const check = (name, ok, detail = '') => {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures.push(name);
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

/** Poll `probe` until truthy (bounded) — condition waits, never bare sleeps. */
export const until = (probe, label, timeoutMs = 90_000, intervalMs = 50) =>
  new Promise((res, rej) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      let value;
      try {
        value = probe();
      } catch {
        value = false;
      }
      if (value) return res(value);
      if (Date.now() > deadline) {
        return rej(new Error(`timed out waiting for ${label}`));
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });

/**
 * Apply `mutate` and wait for `probe`; if the observation window passes with
 * no event, apply it again and wait again. Attempt windows are seconds long
 * by construction.
 */
export const mutateUntil = async (mutate, probe, label, attempts = 6) => {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    mutate();
    try {
      return await until(probe, label, 10_000);
    } catch {
      if (attempt === attempts) {
        throw new Error(
          `no observation of ${label} after ${attempts} mutation attempts`
        );
      }
    }
  }
};

/** Spawn the lane's `animus` with both streams buffered and its exit
 *  observable — the one spawn shape every scenario here uses. */
export const spawnAnimus = (args) => {
  const child = spawn(bin, args, {
    cwd: lane,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  let stdout = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  const exited = new Promise((res) => {
    child.on('exit', (code, signal) => res({ code, signal }));
  });
  return {
    child,
    /** Everything written to stderr so far. */
    get stderr() {
      return stderr;
    },
    /** Everything written to stdout so far. */
    get stdout() {
      return stdout;
    },
    /** True while the process is still running. */
    get alive() {
      return child.exitCode === null;
    },
    /** Signal it only while it is running: signalling a process that already
     *  exited is the ordinary ending, not the one under test. */
    signal(name) {
      if (child.exitCode === null) child.kill(name);
    },
    /** `{ code, signal }`, or a rejection when the exit takes too long. */
    exit(timeoutMs = 30_000) {
      return Promise.race([
        exited,
        new Promise((_, rej) =>
          setTimeout(
            () => rej(new Error('timed out waiting for exit')),
            timeoutMs
          )
        ),
      ]);
    },
  };
};

/** Do a tree's bytes match the hashes its commit record claims? */
export const selfVerifies = (tree) => verifyCommitRecord(tree).length === 0;

/** The published payload map of a flat artifact tree — name → `{ hash }`,
 *  read from the tree's own commit record. */
export const publishedSet = (tree) => {
  const record = decodeCommitRecord(
    readFileSync(join(tree, 'commit.json'), 'utf-8')
  );
  if (record === null) {
    throw new Error(`${tree} holds no schema-1 commit record`);
  }
  return record.payloads;
};

/** The scenario never reached its assertions: say why, dump what the CLI
 *  said, clean up, and exit 1. */
export const fail = (message, run, cleanup) => {
  console.error(`\nFATAL: ${message}`);
  console.error(`\n── captured stderr ──\n${run.stderr}`);
  run.child.kill('SIGKILL');
  cleanup();
  process.exit(1);
};

/** The closing report: exit 1 naming the failed assertions, or the pass
 *  line. */
export const report = (run, failedLabel, passedLine) => {
  if (failures.length > 0) {
    console.error(`\n${failures.length} ${failedLabel}`);
    console.error(`\n── captured stderr ──\n${run.stderr}`);
    process.exit(1);
  }
  console.log(`\n${passedLine}`);
};
