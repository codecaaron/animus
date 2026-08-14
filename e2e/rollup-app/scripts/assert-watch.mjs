// e2e watch scenario (openspec: standalone-extraction-cli inc 06 — the
// "Watch signals readiness and degradation loudly" requirement's scenario
// instrument, plus D5's keep-last-good and D3's same-writer/lock clauses):
//
//   1. Spawn `animus watch` over a scratch copy of fixtures/watch-root,
//      await the structured `watch ready` stderr line, and assert the
//      published set self-verifies and the session status artifact carries
//      the monotonic `ready: true` (schema 2).
//   2. Edit a source file; await republication; assert the new payload
//      content landed and the commit record verifies.
//   3. Make a failing edit (error-kind diagnostic); await the per-cycle
//      failure report; assert last-good artifacts are untouched, the
//      process stays alive, and the status artifact still says ready.
//   4. Recover; await republication of the recovered content.
//   5. SIGINT; assert exit 130, advisory lock released, session tree
//      removed, and that stdout stayed machine-only (empty).
//
// Orchestration is spawned-process with event/condition waits ONLY — no
// bare sleeps (the repo's dev-lane watcher lesson). One platform caveat is
// handled explicitly: macOS FSEvents can drop a change written moments
// after watcher registration, so each edit step REWRITES its target if its
// observation condition has not appeared within the attempt window —
// attempts are seconds apart (never sub-50ms same-path rewrites) and every
// wait is condition-gated.
//
// The platform-degraded negative (recursive fs.watch unavailable /
// descriptor exhaustion) is NOT portably simulable here; its automated
// equivalent is the `watch degradation reporting` unit suite in
// packages/cli/tests/cli-unit.test.ts.
import { contentHash } from '@animus-ui/extract/pipeline';
import { spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const lane = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(lane, 'node_modules', '.bin', 'animus');
const scratch = join(lane, 'fixtures', `.watch-scratch-${process.pid}`);
const outDir = join(scratch, '.animus');
const widgetPath = join(scratch, 'src', 'Widget.tsx');

const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures.push(name);
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const widgetSource = (
  backgroundColor,
  { glow = false } = {}
) => `import { ds } from './ds';

export const Widget = ds
  .styles({
    padding: '8px',
    backgroundColor: '${backgroundColor}',${glow ? "\n    glow: '0 0 4px red'," : ''}
  })
  .asElement('div');

export const App = () => <Widget>watch me</Widget>;
`;

// ── Scratch project ────────────────────────────────────────────────────
rmSync(scratch, { recursive: true, force: true });
cpSync(join(lane, 'fixtures', 'watch-root'), scratch, { recursive: true });

// ── Spawned watch + condition waits ────────────────────────────────────
const child = spawn(
  bin,
  ['watch', '--root', scratch, '--system', './src/ds.ts'],
  {
    cwd: lane,
    stdio: ['ignore', 'pipe', 'pipe'],
  }
);
let stderrBuf = '';
let stdoutBuf = '';
child.stderr.on('data', (chunk) => {
  stderrBuf += chunk;
});
child.stdout.on('data', (chunk) => {
  stdoutBuf += chunk;
});
const exited = new Promise((res) => {
  child.on('exit', (code, signal) => res({ code, signal }));
});

const fail = (message) => {
  console.error(`\nFATAL: ${message}`);
  console.error(`\n── captured stderr ──\n${stderrBuf}`);
  child.kill('SIGKILL');
  rmSync(scratch, { recursive: true, force: true });
  process.exit(1);
};

/** Poll `probe` until truthy (bounded) — condition waits, never bare sleeps. */
const until = (probe, label, timeoutMs = 90_000, intervalMs = 50) =>
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
 * Write `content` to the widget and wait for `probe`; if the observation
 * window passes with no event (the FSEvents registration race), rewrite
 * and wait again. Attempt windows are seconds long by construction.
 */
const editUntil = async (content, probe, label, attempts = 6) => {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    writeFileSync(widgetPath, content);
    try {
      return await until(probe, label, 10_000);
    } catch {
      if (attempt === attempts) {
        throw new Error(
          `no observation of ${label} after ${attempts} edit attempts`
        );
      }
    }
  }
};

const readCommit = () => readFileSync(join(outDir, 'commit.json'), 'utf-8');
const verifySet = () => {
  const commit = JSON.parse(readCommit());
  // Raw bytes, matching the writer's hashing domain — a utf-8 read mangles
  // binary asset entries (fonts) and would fail a correct publication.
  return Object.entries(commit.payloads).every(
    ([name, { hash }]) => contentHash(readFileSync(join(outDir, name))) === hash
  );
};
const readStatus = () => {
  const sessions = join(outDir, 'sessions');
  const [id] = readdirSync(sessions);
  return JSON.parse(
    readFileSync(join(sessions, id, 'analysis-status.json'), 'utf-8')
  );
};

try {
  // ── 1. Readiness is explicit, after a complete first publication ─────
  const ready = await until(
    () => stderrBuf.match(/watch ready components=(\d+) files=(\d+)/),
    'the ready line'
  );
  check('ready line reports components and files', Number(ready[1]) >= 1);
  check('ready publication self-verifies', verifySet());
  check(
    'lock is held for the watch lifetime',
    existsSync(join(outDir, 'lock.json'))
  );
  const status = readStatus();
  check('status artifact schema bumped to 2', status.schema === 2);
  check('status artifact carries monotonic ready', status.ready === true);
  check(
    'session tree stays alive while the watch runs',
    existsSync(join(outDir, 'sessions'))
  );

  // ── 2. Edit → republication with commit-record consistency ───────────
  const commitAtReady = readCommit();
  await editUntil(
    widgetSource('#bada55'),
    () =>
      readCommit() !== commitAtReady &&
      stderrBuf.includes('watch republished '),
    'republication after the color edit'
  );
  check('republication self-verifies', verifySet());
  check(
    'republication carries the edited payload',
    readFileSync(join(outDir, 'styles.css'), 'utf-8').includes('bada55')
  );
  check(
    'republished line reports components and files',
    /watch republished components=\d+ files=\d+/.test(stderrBuf)
  );

  // ── 3. Failing edit keeps last-good and reports per-cycle ────────────
  const commitLastGood = readCommit();
  const stylesLastGood = readFileSync(join(outDir, 'styles.css'), 'utf-8');
  await editUntil(
    widgetSource('#bada55', { glow: true }),
    () => stderrBuf.includes('watch cycle failed'),
    'the per-cycle failure report'
  );
  check(
    'failure report names the keep-last-good policy',
    stderrBuf.includes('keeping last-good artifacts')
  );
  check(
    'failed cycle keeps the last-good commit record',
    readCommit() === commitLastGood
  );
  check(
    'failed cycle keeps the last-good stylesheet',
    readFileSync(join(outDir, 'styles.css'), 'utf-8') === stylesLastGood
  );
  check(
    'the process stays alive after a failed cycle',
    child.exitCode === null
  );
  const failedStatus = await until(() => {
    const s = readStatus();
    return s.state === 'failed' ? s : false;
  }, 'the failed status write');
  check(
    'ready never regresses (failed status still carries ready)',
    failedStatus.ready === true
  );

  // ── 4. Recovery republishes ──────────────────────────────────────────
  await editUntil(
    widgetSource('#c0ffee'),
    () =>
      readCommit() !== commitLastGood &&
      readFileSync(join(outDir, 'styles.css'), 'utf-8').includes('c0ffee'),
    'republication after recovery'
  );
  check('recovered publication self-verifies', verifySet());

  // ── 5. SIGINT: clean shutdown contract ───────────────────────────────
  child.kill('SIGINT');
  const { code } = await Promise.race([
    exited,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error('timed out waiting for exit')), 30_000)
    ),
  ]);
  check('SIGINT exits 130', code === 130, `got ${code}`);
  check(
    'shutdown line names the reason',
    /watch shutdown reason=SIGINT publications=\d+/.test(stderrBuf)
  );
  check(
    'advisory lock released on shutdown',
    !existsSync(join(outDir, 'lock.json'))
  );
  check(
    'session tree removed on clean shutdown',
    !existsSync(join(outDir, 'sessions')) ||
      readdirSync(join(outDir, 'sessions')).length === 0
  );
  check('last-good artifacts survive shutdown', verifySet());
  check(
    'stdout stayed machine-only (empty)',
    stdoutBuf === '',
    stdoutBuf.slice(0, 200)
  );
} catch (error) {
  fail(String(error));
} finally {
  if (child.exitCode === null) child.kill('SIGKILL');
  rmSync(scratch, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\n${failures.length} watch assertion(s) failed`);
  console.error(`\n── captured stderr ──\n${stderrBuf}`);
  process.exit(1);
}
console.log('\nall watch-contract assertions passed');
