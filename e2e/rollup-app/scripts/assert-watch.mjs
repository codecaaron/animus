import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  check,
  fail,
  lane,
  mutateUntil,
  report,
  selfVerifies,
  spawnAnimus,
  until,
} from './watch-harness.mjs';

const scratch = join(lane, 'fixtures', `.watch-scratch-${process.pid}`);
const outDir = join(scratch, '.animus');
const widgetPath = join(scratch, 'src', 'Widget.tsx');

const systemPath = join(scratch, 'src', 'ds.ts');
const widgetSource = (backgroundColor) => `import { ds } from './ds';

export const Widget = ds
  .styles({
    padding: '8px',
    backgroundColor: '${backgroundColor}',
  })
  .asElement('div');

export const App = () => <Widget>watch me</Widget>;
`;

const cleanup = () => rmSync(scratch, { recursive: true, force: true });

cleanup();
cpSync(join(lane, 'fixtures', 'watch-root'), scratch, { recursive: true });

const run = spawnAnimus([
  'watch',
  '--root',
  scratch,
  '--system',
  './src/ds.ts',
]);

const editUntil = (content, probe, label) =>
  mutateUntil(() => writeFileSync(widgetPath, content), probe, label);

const readCommit = () => readFileSync(join(outDir, 'commit.json'), 'utf-8');
const readStatus = () => {
  const sessions = join(outDir, 'sessions');
  const [id] = readdirSync(sessions);
  return JSON.parse(
    readFileSync(join(sessions, id, 'analysis-status.json'), 'utf-8')
  );
};

try {
  // The held-events window is not asserted here: whether an edit lands inside
  // the first analysis depends on FSEvents delivery latency.
  const ready = await until(
    () => run.stderr.match(/watch ready components=(\d+) files=(\d+)/),
    'the ready line'
  );
  check('ready line reports components and files', Number(ready[1]) >= 1);
  check('ready publication self-verifies', selfVerifies(outDir));
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

  const commitAtReady = readCommit();
  await editUntil(
    widgetSource('#bada55'),
    () =>
      readCommit() !== commitAtReady &&
      run.stderr.includes('watch republished '),
    'republication after the color edit'
  );
  check('republication self-verifies', selfVerifies(outDir));
  check(
    'republication carries the edited payload',
    readFileSync(join(outDir, 'styles.css'), 'utf-8').includes('bada55')
  );
  check(
    'republished line reports components and files',
    /watch republished components=\d+ files=\d+/.test(run.stderr)
  );

  const commitLastGood = readCommit();
  const stylesLastGood = readFileSync(join(outDir, 'styles.css'), 'utf-8');
  // A system that throws while it loads fails the cycle in every mode; an
  // error-level diagnostic would only be reported, since this is a watch.
  const systemSource = readFileSync(systemPath, 'utf-8');
  await mutateUntil(
    () =>
      writeFileSync(
        systemPath,
        `${systemSource}\nthrow new Error('broken system');\n`
      ),
    () => run.stderr.includes('watch cycle failed'),
    'the per-cycle failure report'
  );
  check(
    'failure report names the keep-last-good policy',
    run.stderr.includes('keeping last-good artifacts')
  );
  check(
    'failed cycle keeps the last-good commit record',
    readCommit() === commitLastGood
  );
  check(
    'failed cycle keeps the last-good stylesheet',
    readFileSync(join(outDir, 'styles.css'), 'utf-8') === stylesLastGood
  );
  check('the process stays alive after a failed cycle', run.alive);
  const failedStatus = await until(() => {
    const s = readStatus();
    return s.state === 'failed' ? s : false;
  }, 'the failed status write');
  check(
    'ready never regresses (failed status still carries ready)',
    failedStatus.ready === true
  );

  writeFileSync(systemPath, systemSource);
  await editUntil(
    widgetSource('#c0ffee'),
    () =>
      readCommit() !== commitLastGood &&
      readFileSync(join(outDir, 'styles.css'), 'utf-8').includes('c0ffee'),
    'republication after recovery'
  );
  check('recovered publication self-verifies', selfVerifies(outDir));

  // One SIGINT, sent while a cycle is in flight, drains it before the claims
  // go. A second signal is not sent: once the drain finishes the listeners
  // are gone, and a second SIGINT ends the process by the signal itself. The
  // CLI's unit test of the shutdown signals pins the abandoned drain.
  writeFileSync(widgetPath, widgetSource('#0ff0ff'));
  try {
    await until(
      () =>
        ['debouncing', 'starting', 'analyzing', 'committing'].includes(
          readStatus().state
        ),
      'a cycle to enter analysis',
      5_000
    );
  } catch {
    // The cycle finished first: the drain is short. Every assertion still
    // holds.
  }
  run.signal('SIGINT');
  await until(
    () => run.stderr.includes('watch shutdown starting reason=SIGINT'),
    'the shutdown acknowledgement'
  );
  const { code } = await run.exit();
  check('SIGINT exits 130', code === 130, `got ${code}`);
  check(
    'shutdown line names the reason',
    /watch shutdown reason=SIGINT publications=\d+/.test(run.stderr)
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
  check('last-good artifacts survive shutdown', selfVerifies(outDir));
  check(
    'stdout stayed machine-only (empty)',
    run.stdout === '',
    run.stdout.slice(0, 200)
  );
} catch (error) {
  fail(String(error), run, cleanup);
} finally {
  run.signal('SIGKILL');
  cleanup();
}

report(
  run,
  'watch assertion(s) failed',
  'all watch-contract assertions passed'
);
