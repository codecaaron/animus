import { contentHash } from '@animus-ui/extract/pipeline';
// Positional assertions on the CLI artifact contract (openspec:
// standalone-extraction-cli — "One-shot build emits the artifact set under
// a terminal exit contract" / "Artifact bytes are deterministic and
// identity-free" / "A commit record makes set consistency checkable in one
// read" / "Silent-empty success is impossible").
//
// Rendered-output coverage lives in assert-host.mjs (the transform-host
// standing asserts); this file owns the artifact set and the exit
// taxonomy.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const lane = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(lane, '.animus');
const bin = join(lane, 'node_modules', '.bin', 'animus');

const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures.push(name);
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

// ── 1. The published set exists and self-verifies ────────────────────
const names = ['styles.css', 'system-props.js', 'manifest.json', 'commit.json'];
for (const name of names) {
  check(`artifact ${name} exists`, existsSync(join(outDir, name)));
}
const commit = JSON.parse(readFileSync(join(outDir, 'commit.json'), 'utf-8'));
check('commit schema is 1', commit.schema === 1);
for (const [name, { hash }] of Object.entries(commit.payloads)) {
  // Raw bytes: asset entries (fonts) are not UTF-8.
  const actual = contentHash(readFileSync(join(outDir, name)));
  check(`commit hash verifies: ${name}`, actual === hash);
}
const styles = readFileSync(join(outDir, 'styles.css'), 'utf-8');
check(
  'no session identity in artifact bytes',
  !styles.includes('__animusSession')
);
check('component CSS present', /@layer anm-base/.test(styles));

// ── 1b. Asset reachability: every url(./assets/…) resolves on disk ───
// Vacuity-guarded: the lane's ds.ts carries an asset() font witness, so a
// zero-match scrape means the scrape broke, not that nothing is claimed.
const assetUrls = [...styles.matchAll(/url\(\.\/assets\/([^)'"]+)\)/g)].map(
  (match) => match[1]
);
check(
  'stylesheet references at least one ./assets/ url (witness present)',
  assetUrls.length > 0
);
for (const name of assetUrls) {
  check(
    `published asset resolves: assets/${name}`,
    existsSync(join(outDir, 'assets', name))
  );
  check(
    `commit records assets/${name}`,
    typeof commit.payloads[`assets/${name}`]?.hash === 'string'
  );
}
const manifest = JSON.parse(
  readFileSync(join(outDir, 'manifest.json'), 'utf-8')
);
check(
  'manifest components include the lane Button',
  Object.keys(manifest.components ?? {}).some((key) => key.includes('Button'))
);

// ── 2. Determinism: a second build is byte-identical ─────────────────
const second = mkdtempSync(join(tmpdir(), 'animus-rollup-det-'));
execFileSync(
  bin,
  [
    'build',
    '--root',
    '.',
    '--system',
    './src/ds.ts',
    '--strict',
    // Pinned inputs: the same exclusion verify:build used — the negative
    // fixtures under fixtures/ never enter the lane's own analysis.
    '--exclude',
    'fixtures/**',
    '--out-dir',
    second,
  ],
  { cwd: lane, stdio: ['ignore', 'ignore', 'inherit'] }
);
for (const name of names) {
  check(
    `deterministic: ${name}`,
    readFileSync(join(outDir, name), 'utf-8') ===
      readFileSync(join(second, name), 'utf-8')
  );
}
for (const name of assetUrls) {
  check(
    `deterministic: assets/${name}`,
    existsSync(join(second, 'assets', name)) &&
      readFileSync(join(outDir, 'assets', name)).equals(
        readFileSync(join(second, 'assets', name))
      )
  );
}
rmSync(second, { recursive: true, force: true });

// ── 3. Exit taxonomy negatives ───────────────────────────────────────
const run = (args) => spawnSync(bin, args, { cwd: lane, encoding: 'utf-8' });

const badSystem = run(['build', '--root', '.', '--system', './src/missing.ts']);
check(
  'unresolvable system exits 2',
  badSystem.status === 2,
  `got ${badSystem.status}`
);
check(
  'unresolvable system names the path on stderr',
  badSystem.stderr.includes('missing.ts')
);

// A truly empty root: the system module resolves one level UP from the
// root, so discovery has nothing to walk and no include supplies files.
const zeroFiles = run([
  'build',
  '--root',
  'fixtures/empty-root',
  '--system',
  '../ds-standalone.ts',
  '--out-dir',
  join(tmpdir(), 'animus-rollup-zero'),
]);
check(
  'zero discovered files exits 1',
  zeroFiles.status === 1,
  `got ${zeroFiles.status}`
);
check(
  'zero-files error names the exclusions',
  zeroFiles.stderr.includes('zero source files')
);

const unknownFlagless = run(['definitely-not-a-command']);
check(
  'unknown command exits 2',
  unknownFlagless.status === 2,
  `got ${unknownFlagless.status}`
);

// Extraction error (inc 03 recorded gap): an error-kind manifest
// diagnostic fails the build in EVERY mode (no --strict here) with the
// extraction-failure exit code, naming the component and file.
const extractionError = run([
  'build',
  '--root',
  'fixtures/error-root',
  '--system',
  './ds.ts',
  '--out-dir',
  join(tmpdir(), 'animus-rollup-error'),
]);
check(
  'error-kind diagnostic exits 1',
  extractionError.status === 1,
  `got ${extractionError.status}`
);
check(
  'error diagnostic names the component',
  extractionError.stderr.includes('BadGlow'),
  extractionError.stderr.slice(-300)
);
check(
  'error diagnostic names the file',
  extractionError.stderr.includes('Component.tsx')
);

// System-load failure (inc 03 recorded gap): fatal WITHOUT --strict —
// no warn-and-continue path exists for an unloadable system module.
const brokenSystem = run([
  'build',
  '--root',
  'fixtures/broken-system-root',
  '--system',
  './ds.ts',
  '--out-dir',
  join(tmpdir(), 'animus-rollup-broken'),
]);
check(
  'system-load failure is fatal without strict (exit 1)',
  brokenSystem.status === 1,
  `got ${brokenSystem.status}`
);
check(
  'system-load failure surfaces the load diagnostic',
  /deliberate load failure|system/i.test(brokenSystem.stderr)
);

// ── 4. Stream discipline: print-config stdout is pure JSON ───────────
const printed = run([
  'print-config',
  '--root',
  '.',
  '--system',
  './src/ds.ts',
  '--verbose',
]);
let parsedOk = false;
try {
  const projected = JSON.parse(printed.stdout);
  parsedOk = projected.driver === 'cli' && projected.mode === 'production';
} catch {
  parsedOk = false;
}
check('print-config stdout parses as JSON (mode production)', parsedOk);

if (failures.length > 0) {
  console.error(`\n${failures.length} assertion(s) failed`);
  process.exit(1);
}
console.log('\nall artifact-contract assertions passed');
