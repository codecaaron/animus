// The published-set readers are the session's own: the writer hashes raw
// bytes, so re-reading them as utf-8 would mangle binary payload entries.
import {
  decodeCommitRecord,
  verifyCommitRecord,
} from '@animus-ui/extract/session';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const lane = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const bin = join(lane, 'node_modules', '.bin', 'animus');

export const failures = [];

export const check = (name, ok, detail = '') => {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures.push(name);
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

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

/** Apply `mutate` and wait for `probe`, reapplying on a silent window —
 *  macOS FSEvents can drop a change written just after registration. */
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
    get stderr() {
      return stderr;
    },
    get stdout() {
      return stdout;
    },
    get alive() {
      return child.exitCode === null;
    },
    signal(name) {
      if (child.exitCode === null) child.kill(name);
    },
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

export const selfVerifies = (tree) => verifyCommitRecord(tree).length === 0;

export const publishedSet = (tree) => {
  const record = decodeCommitRecord(
    readFileSync(join(tree, 'commit.json'), 'utf-8')
  );
  if (record === null) {
    throw new Error(`${tree} holds no schema-1 commit record`);
  }
  return record.payloads;
};

export const fail = (message, run, cleanup) => {
  console.error(`\nFATAL: ${message}`);
  console.error(`\n── captured stderr ──\n${run.stderr}`);
  run.child.kill('SIGKILL');
  cleanup();
  process.exit(1);
};

export const report = (run, failedLabel, passedLine) => {
  if (failures.length > 0) {
    console.error(`\n${failures.length} ${failedLabel}`);
    console.error(`\n── captured stderr ──\n${run.stderr}`);
    process.exit(1);
  }
  console.log(`\n${passedLine}`);
};
