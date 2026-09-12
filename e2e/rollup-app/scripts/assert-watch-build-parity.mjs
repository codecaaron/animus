// Both runs go over one scratch copy of the fixture, so a hash difference
// between the two commit records is a divergence, not a source difference.
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
// Outside the root on purpose: the build phase must not discover it, and a
// build over the same directory would prune the watch's asset set.
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

  // Alpha sorts first in a discovery walk but is added last, so an ordering
  // difference would show up as a differing hash.
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
