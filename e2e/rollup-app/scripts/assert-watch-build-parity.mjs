// Watch/build parity check for the standalone CLI: whether a settled watch
// publishes exactly what a fresh build of the same source publishes.
//
// Both runs go over ONE scratch copy of fixtures/parity-root, so they see
// byte-identical source at the same absolute paths. The two `commit.json`
// records name every published payload (styles.css, system-props.js,
// manifest.json, and every `assets/<name>`) with its content hash, so
// comparing the two maps decides both questions at once — a superseded asset
// copy a watch cycle never pruned shows up as an extra `assets/` payload, and
// an entry order that differs from a discovery walk shows up as a differing
// styles.css / manifest.json hash. Each set is verified against its own bytes
// first, so an equal-hash comparison can never pass over a set whose files
// are missing.
//
// The spawn, the condition waits, the mutate-retry loop and the
// published-set readers are the lane's shared harness (watch-harness.mjs).
import { spawnSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  bin,
  check,
  fail,
  lane,
  mutateUntil,
  publishedSet,
  report,
  selfVerifies,
  spawnAnimus,
  until,
} from './watch-harness.mjs';

const scratch = join(lane, 'fixtures', `.parity-scratch-${process.pid}`);
// Outside the root on purpose: the build phase must not discover it, and
// `animus build` would otherwise prune the watch's asset set as it
// republishes over the same directory.
const watchTree = join(lane, 'fixtures', `.parity-watch-tree-${process.pid}`);
const outDir = join(scratch, '.animus');
const assetPath = join(scratch, 'assets', 'brand.woff2');
const alphaPath = join(scratch, 'src', 'Alpha.tsx');

const ASSET_REVISION_TWO = 'animus-parity-asset-revision-two';
const ALPHA_COLOR = '#0ff1ce';
const ALPHA_SOURCE = `import { ds } from './ds';

export const Alpha = ds
  .styles({
    padding: '16px',
    backgroundColor: '${ALPHA_COLOR}',
  })
  .asElement('section');

export const AlphaApp = () => <Alpha>parity</Alpha>;
`;

const cleanup = () => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(watchTree, { recursive: true, force: true });
};

const readStyles = (tree) => readFileSync(join(tree, 'styles.css'), 'utf-8');
const assetNames = (payloads) =>
  Object.keys(payloads)
    .filter((name) => name.startsWith('assets/'))
    .sort();

cleanup();
cpSync(join(lane, 'fixtures', 'parity-root'), scratch, { recursive: true });

// ── 1. Watch: settle over the mutated source ─────────────────────────────
const run = spawnAnimus([
  'watch',
  '--root',
  scratch,
  '--system',
  './src/ds.ts',
]);

try {
  await until(
    () => /watch ready components=\d+ files=\d+/.test(run.stderr),
    'the ready line'
  );
  const stylesAtReady = readStyles(outDir);
  const assetAtReady = stylesAtReady.match(/\.\/assets\/[^)"' ]+/)?.[0];
  check(
    'the first publication references the fixture asset',
    assetAtReady !== undefined,
    stylesAtReady.slice(0, 200)
  );

  // A new revision of the asset mints a new content-hashed copy; the copies
  // are never overwritten, so the superseded one has to be deleted.
  await mutateUntil(
    () => writeFileSync(assetPath, ASSET_REVISION_TWO),
    () => {
      const styles = readStyles(outDir);
      return !styles.includes(assetAtReady) && /\.\/assets\//.test(styles);
    },
    'republication after the asset revision'
  );

  // A file discovery would sort FIRST, added last.
  await mutateUntil(
    () => writeFileSync(alphaPath, ALPHA_SOURCE),
    () => readStyles(outDir).includes(ALPHA_COLOR),
    'republication after the added component'
  );

  run.signal('SIGINT');
  const { code } = await run.exit();
  check('watch exits 130 on SIGINT', code === 130, `got ${code}`);
  check('the watch tree self-verifies', selfVerifies(outDir));
  cpSync(outDir, watchTree, { recursive: true });

  // ── 2. Build: same source, clean artifact directory ────────────────────
  rmSync(outDir, { recursive: true, force: true });
  const built = spawnSync(
    bin,
    ['build', '--root', scratch, '--system', './src/ds.ts'],
    { cwd: lane, encoding: 'utf-8' }
  );
  if (built.status !== 0) {
    fail(
      `animus build exited ${built.status}\n${built.stderr ?? ''}`,
      run,
      cleanup
    );
  }
  check('the build tree self-verifies', selfVerifies(outDir));

  // ── 3. The comparison is only meaningful over a populated set ──────────
  const buildSet = publishedSet(outDir);
  const watchSet = publishedSet(watchTree);
  const buildStyles = readStyles(outDir);
  check(
    'the build publishes exactly one asset copy',
    assetNames(buildSet).length === 1,
    assetNames(buildSet).join(', ')
  );
  check(
    'the build stylesheet carries both components and the font face',
    // Class names, not the authored colors: the CSS lowering shortens
    // `#8899aa` to `#89a`, so a literal-color probe would be vacuous.
    buildStyles.includes('animus-Alpha-') &&
      buildStyles.includes('animus-Widget-') &&
      buildStyles.includes('AnimusParityFont'),
    buildStyles.slice(-300)
  );
  check(
    'the watch republished at least twice',
    (run.stderr.match(/watch republished /g) ?? []).length >= 2
  );

  // ── 4. Watch-vs-build parity ───────────────────────────────────────────
  const names = [
    ...new Set([...Object.keys(buildSet), ...Object.keys(watchSet)]),
  ].sort();
  const divergent = names.filter(
    (name) => buildSet[name]?.hash !== watchSet[name]?.hash
  );
  check(
    'the settled watch published the same set as a fresh build',
    divergent.length === 0,
    divergent
      .map(
        (name) =>
          `${name}: build=${buildSet[name]?.hash ?? '<absent>'} watch=${watchSet[name]?.hash ?? '<absent>'}`
      )
      .join('; ')
  );
  if (divergent.includes('styles.css')) {
    console.error('\n── build styles.css ──\n' + buildStyles);
    console.error('\n── watch styles.css ──\n' + readStyles(watchTree));
  }
} catch (error) {
  fail(String(error), run, cleanup);
} finally {
  run.signal('SIGKILL');
  cleanup();
}

report(
  run,
  'watch/build parity assertion(s) failed',
  'watch and build publish the same set'
);
