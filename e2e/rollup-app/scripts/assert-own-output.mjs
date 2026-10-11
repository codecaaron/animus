// Contract: a build never silently analyses its own previous output. This
// lane's `exclude` list replaces the default `dist` exclusion, and a `.js`
// entry name puts the bundle in the discovered extensions. Rollup names its
// output directory only after analysis: a watch's later builds exclude it,
// and a new process that read it fails under `strict`, naming the files.
// An output file written beside sources names only itself.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { check, failures, lane, mutateUntil, until } from './watch-harness.mjs';

const rollup = join(lane, 'node_modules', '.bin', 'rollup');
const outDir = join(lane, `own-output-${process.pid}`);
const outRel = relative(lane, outDir);
const outputArgs = [
  '-c',
  'rollup.config.mjs',
  '--dir',
  outDir,
  '--entryFileNames',
  'bundle.js',
];
const sheet = () => readFileSync(join(outDir, 'animus.css'), 'utf-8');
const editedPath = join(lane, 'src', 'Box.tsx');
const editedSource = readFileSync(editedPath, 'utf-8');

const build = () =>
  spawnSync(rollup, outputArgs, { cwd: lane, encoding: 'utf-8' });

// One output file inside `src/`, through a config that names it.
const srcFile = join(lane, 'src', `own-bundle-${process.pid}.js`);
const srcFileRel = relative(lane, srcFile);
const fileConfig = join(lane, `.own-file-${process.pid}.config.mjs`);
// What the file build writes beside the bundle, removed only if new.
const besideSrcFile = [
  join(lane, 'src', 'animus.css'),
  join(lane, 'src', 'assets'),
].filter((path) => !existsSync(path));
const buildFile = () =>
  spawnSync(rollup, ['-c', fileConfig], { cwd: lane, encoding: 'utf-8' });

let watchRun = null;
const cleanup = () => {
  watchRun?.kill('SIGKILL');
  writeFileSync(editedPath, editedSource);
  rmSync(outDir, { recursive: true, force: true });
  for (const path of [srcFile, fileConfig, ...besideSrcFile]) {
    rmSync(path, { recursive: true, force: true });
  }
};

try {
  // A new process over the previous build's output.
  rmSync(outDir, { recursive: true, force: true });
  const first = build();
  check('a first build succeeds', first.status === 0, first.stderr);
  const second = build();
  check(
    'a new build that read its own output fails under strict',
    second.status !== 0,
    `exit ${second.status}`
  );
  check(
    'the failure names the output file and the exclude fix',
    second.stderr.includes(`${outRel}/bundle.js`) &&
      second.stderr.includes(`'${outRel}'`),
    second.stderr.slice(-600)
  );

  // An output file beside sources: the first build reads only sources, and
  // a new build that read the earlier bundle names that file alone.
  writeFileSync(
    fileConfig,
    `import config from './rollup.config.mjs';\n` +
      `export default { ...config, output: { file: ${JSON.stringify(srcFile)}, format: 'esm' } };\n`
  );
  const firstFile = buildFile();
  check(
    'a first build beside sources succeeds',
    firstFile.status === 0,
    firstFile.stderr.slice(-600)
  );
  const secondFile = buildFile();
  check(
    'a new build that read its output file fails naming that file alone',
    secondFile.status !== 0 &&
      secondFile.stderr.includes(srcFileRel) &&
      !secondFile.stderr.includes('src/Box.tsx'),
    secondFile.stderr.slice(-600)
  );

  // One watch process: its later builds exclude the output it wrote.
  rmSync(outDir, { recursive: true, force: true });
  let stderr = '';
  watchRun = spawn(rollup, [...outputArgs, '--watch'], {
    cwd: lane,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  watchRun.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const builds = () => stderr.match(/created /g)?.length ?? 0;
  await until(() => builds() >= 1, 'the first watch build');
  const firstSheet = sheet();
  await mutateUntil(
    () => writeFileSync(editedPath, `${editedSource}\n`),
    () => builds() >= 2,
    'the rebuild after an edit'
  );
  check(
    'a watch rebuild emits the same stylesheet',
    sheet() === firstSheet,
    `${firstSheet.length} bytes, then ${sheet().length}`
  );
  check(
    'a watch rebuild does not read its own output',
    !stderr.includes(`${outRel}/bundle.js`),
    stderr.slice(-600)
  );
} finally {
  cleanup();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} own-output assertion(s) failed`);
  process.exit(1);
}
console.log('\nown output: never analysed silently');
