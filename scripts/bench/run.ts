#!/usr/bin/env bun

// verify:bench — the speed gate. Measures a candidate against the pinned
// last-known-fast release (scripts/bench/releases.json `reference`) on one
// machine, in paired runs, and gates each row on its own budget:
//
//   loader:large-closure  native loadSystemModule, generated issuer-shaped
//                         closure (fixture.ts)
//   loader:showcase       native loadSystemModule, the showcase's system
//   analysis:showcase     native analysis of a fixed captured input
//   build:vite-app        a full `vite build` of e2e/vite-app
//
// Each row runs one unscored warm-up pair, then nine scored pairs in
// alternating order, every invocation in a fresh process (protocol.ts holds
// the decision). A failed run, a receipt that differs between runs of one
// side, a candidate whose output (digests, counts, diagnostics) differs from
// the reference's without a checked-in explanation (accepted-differences.json),
// or a fixture that changed during the run fails the gate as invalid, never
// as fast. Correctness is checked after the warm-up pair, before any scored
// pair counts.
//
// Usage:
//   bun scripts/bench/run.ts [--candidate <animus checkout>]
//     [--candidate-release <diagnostic version>] [--row <name>]...
//     [--confirm <file>]
// The candidate defaults to this checkout. Its native binary and package
// dists must be built (release profile); a diagnostic release from
// releases.json is measured as a labelled candidate, never as the reference.
// Exits 0 when every row passes; 1 otherwise. The full receipt is written to
// .bench/receipts/. With --confirm, the rows that failed or are unqualified,
// whose ratio another runner's CPU may move, are written to <file> (space-
// separated, empty when every row passes) for a second runner to measure;
// nothing is written when a row is invalid, which no runner can confirm.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { arch, cpus, platform, release } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

import { diagnosticCounts } from '../consumers/measure';
import { fixtureDigest, writeLargeClosure } from './fixture';
import { BENCH, pins, releaseProblems, REPO, tarballPath } from './prepare';
import {
  BLOCK,
  type Budget,
  clearRegression,
  decide,
  FULL_BUILD,
  median,
  NATIVE_ANALYSIS,
  NATIVE_LOADER,
  noise,
  type Pair,
  score,
} from './protocol';

const PACKAGES = ['properties', 'system', 'extract', 'vite-plugin'] as const;
/** The non-Animus dependencies of PACKAGES; React and Vite come from the
 *  app. */
const THIRD_PARTY = ['csstype', 'browserslist', 'lightningcss'] as const;
const APP = join(REPO, 'e2e/vite-app');
const APP_COPY_SKIP = new Set([
  'node_modules',
  'dist',
  '.receipts',
  '.wrangler',
  'prefixed-variant',
]);
const RUNNERS = join(import.meta.dirname, 'runners');

interface Side {
  label: string;
  /** The vite-app copy whose node_modules hold this side's packages. */
  app: string;
  extract: string;
}

/** A run's correctness receipt: counts, sizes and digests, and for a build
 *  its diagnostics by code and the host's phase timings. */
type ReceiptValue = string | number | null | Readonly<Record<string, number>>;

interface Sample {
  ms: number;
  receipt: Readonly<Record<string, ReceiptValue>>;
}

interface Row {
  name: string;
  /** What the row measures, as accepted-differences.json names it. */
  fixture: string;
  budget: Budget;
  run(side: Side): Sample;
  /** Receipt fields that vary between runs and are reported only. */
  volatile?: string[];
}

/** A checked-in explanation of why a candidate's receipt may differ from
 *  the reference's: it covers exactly these two receipt digests. */
interface AcceptedDifference {
  row: string;
  fixture: string;
  baseline: string;
  candidate: string;
  reason: string;
}

type Outcome = 'pass' | 'fail' | 'unqualified' | 'invalid';

interface RowResult {
  row: string;
  outcome: Outcome;
  reason?: string;
  pairs: Pair[];
  receipts: { baseline?: Sample['receipt']; candidate?: Sample['receipt'] };
}

class InvalidRun extends Error {}

function fail(message: string): never {
  console.error(`[verify:bench] ${message}`);
  process.exit(1);
}

function sh(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

// ── Preconditions ───────────────────────────────────────────────────

function requireIdleRust(): void {
  for (const name of ['rustc', 'cargo']) {
    const found = sh('pgrep', ['-x', name], REPO);
    if (found.status === 0) {
      fail(
        `ERROR: a ${name} process is running (pid ${found.stdout.trim().replace(/\n/g, ', ')}); timing needs no concurrent Rust build. Run: verify:bench after it finishes`
      );
    }
  }
}

function requireRelease(version: string): void {
  const problems = releaseProblems(version);
  if (problems.length > 0) {
    fail(`ERROR: ${problems.join('; ')}. Run: bun scripts/bench/prepare.ts`);
  }
}

/** A checkout's native binary and package dists, checked by that
 *  checkout's own verify preconditions: present, and newer than their
 *  sources. */
function requireFreshCheckout(root: string, packages: readonly string[]): void {
  const checks = [
    'require_fresh_napi_v2',
    ...packages.map((name) => `require_fresh_package_dist ${name}`),
  ];
  const result = sh(
    'bash',
    [
      '-c',
      `set -euo pipefail; source scripts/verify/_preconditions.sh; ${checks.join('; ')}`,
    ],
    root
  );
  if (result.status !== 0) fail(`${root}: ${result.output.trim()}`);
}

// ── Sides ───────────────────────────────────────────────────────────

function extractTarball(tarball: string, target: string): void {
  mkdirSync(target, { recursive: true });
  const result = sh(
    'tar',
    ['-xzf', tarball, '-C', target, '--strip-components=1'],
    REPO
  );
  if (result.status !== 0)
    fail(`extracting ${tarball} failed:\n${result.output}`);
}

function packCheckout(root: string, into: string): Map<string, string> {
  rmSync(into, { recursive: true, force: true });
  mkdirSync(into, { recursive: true });
  const tarballs = new Map<string, string>();
  for (const name of PACKAGES) {
    const packed = sh(
      'bun',
      ['pm', 'pack', '--destination', into],
      join(root, 'packages', name)
    );
    if (packed.status !== 0)
      fail(`packing ${root}/packages/${name} failed:\n${packed.output}`);
    const file = readdirSync(into).find((entry) =>
      new RegExp(`^animus-ui-${name}-\\d.*\\.tgz$`).test(entry)
    );
    if (file === undefined)
      fail(`packing ${root}/packages/${name} produced no tarball`);
    tarballs.set(name, join(into, file));
  }
  return tarballs;
}

/** The real directory `name` resolves to from `from`'s package. */
function resolvedPackage(name: string, from: string): string {
  return realpathSync(
    dirname(
      createRequire(join(from, 'package.json')).resolve(`${name}/package.json`)
    )
  );
}

/** A copy of e2e/vite-app whose node_modules hold the side's Animus
 *  packages as real directories, this checkout's test-ds kit, and links to
 *  the app's own third-party packages: the sides differ only in Animus. The
 *  copy sits as deep below the repository as the app, whose tsconfig
 *  extends the root's by a relative path. */
function installSide(
  label: string,
  tarballs: ReadonlyMap<string, string>
): Side {
  const app = join(BENCH, `vite-app-${label}`);
  rmSync(app, { recursive: true, force: true });
  cpSync(APP, app, {
    recursive: true,
    filter: (path) => path === APP || !APP_COPY_SKIP.has(basename(path)),
  });
  const modules = join(app, 'node_modules');
  mkdirSync(modules, { recursive: true });
  for (const name of readdirSync(join(APP, 'node_modules'))) {
    if (name.startsWith('.') || name === '@animus-ui') continue;
    const source = join(APP, 'node_modules', name);
    if (name.startsWith('@')) {
      mkdirSync(join(modules, name), { recursive: true });
      for (const sub of readdirSync(source)) {
        symlinkSync(realpathSync(join(source, sub)), join(modules, name, sub));
      }
    } else {
      symlinkSync(realpathSync(source), join(modules, name));
    }
  }
  for (const name of THIRD_PARTY) {
    const owner = name === 'csstype' ? 'system' : 'extract';
    symlinkSync(
      resolvedPackage(name, join(REPO, 'packages', owner)),
      join(modules, name)
    );
  }
  for (const name of PACKAGES) {
    extractTarball(
      tarballs.get(name) ?? fail(`no ${name} tarball for ${label}`),
      join(modules, '@animus-ui', name)
    );
  }
  cpSync(join(REPO, 'packages/test-ds'), join(modules, '@animus-ui/test-ds'), {
    recursive: true,
    filter: (path) => !['node_modules', '__tests__'].includes(basename(path)),
  });
  return { label, app, extract: join(modules, '@animus-ui/extract') };
}

function releaseTarballs(version: string): Map<string, string> {
  return new Map(
    PACKAGES.map((name) => [name, tarballPath(version, `@animus-ui/${name}`)])
  );
}

// ── Measurement ─────────────────────────────────────────────────────

function nodeSample(args: string[]): Sample {
  const result = sh('node', args, BENCH);
  const line = result.stdout.trim().split('\n').at(-1) ?? '';
  if (result.status !== 0 || !line.startsWith('{')) {
    throw new InvalidRun(
      `\`node ${basename(args[0])}\` failed:\n${result.output.slice(-2000)}`
    );
  }
  // SAFETY: the runners print exactly one Sample per invocation.
  return JSON.parse(line) as Sample;
}

function digestFiles(paths: readonly string[]): string {
  const hash = createHash('sha256');
  for (const path of [...paths].sort()) hash.update(readFileSync(path));
  return hash.digest('hex');
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((path) => join(dir, path))
    .filter((path) => statSync(path).isFile());
}

function buildSample(side: Side): Sample {
  rmSync(join(side.app, 'dist'), { recursive: true, force: true });
  rmSync(join(side.app, 'node_modules/.vite'), {
    recursive: true,
    force: true,
  });
  // A cold build: the system load is not served from a kept result.
  rmSync(join(side.app, 'node_modules/.cache/animus'), {
    recursive: true,
    force: true,
  });
  const vite = join(resolvedPackage('vite', side.app), 'bin/vite.js');
  const start = process.hrtime.bigint();
  const result = spawnSync('node', [vite, 'build'], {
    cwd: side.app,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, ANIMUS_DEBUG: '1', ANIMUS_TIMING_JSON: '1' },
  });
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status !== 0) {
    throw new InvalidRun(
      `${side.label} vite build failed:\n${output.slice(-2000)}`
    );
  }
  const files = filesUnder(join(side.app, 'dist'));
  const css = files.filter((path) => path.endsWith('.css'));
  const js = files.filter((path) => path.endsWith('.js'));
  const bytes = (paths: string[]) =>
    paths.reduce((sum, path) => sum + statSync(path).size, 0);
  const timing = /\[animus:timing\] (\{.*\})/.exec(output)?.[1];
  return {
    ms,
    receipt: {
      cssBytes: bytes(css),
      cssDigest: digestFiles(css),
      jsBytes: bytes(js),
      diagnostics: Object.fromEntries(diagnosticCounts(output.split('\n'))),
      phases: timing === undefined ? null : JSON.parse(timing),
    },
  };
}

function stableReceipt(row: Row, receipt: Sample['receipt']): string {
  const kept = Object.entries(receipt).filter(
    ([key]) => !row.volatile?.includes(key)
  );
  return JSON.stringify(kept);
}

function receiptDigest(row: Row, receipt: Sample['receipt']): string {
  return createHash('sha256').update(stableReceipt(row, receipt)).digest('hex');
}

/** Why the candidate's receipt may not count: it differs from the
 *  reference's and no accepted-differences entry covers the two. */
function unexplainedDifference(
  row: Row,
  receipts: RowResult['receipts'],
  accepted: readonly AcceptedDifference[]
): string | null {
  const baseline = receiptDigest(row, receipts.baseline ?? {});
  const candidate = receiptDigest(row, receipts.candidate ?? {});
  if (baseline === candidate) return null;
  const covered = accepted.some(
    (entry) =>
      entry.row === row.name &&
      entry.fixture === row.fixture &&
      entry.baseline === baseline &&
      entry.candidate === candidate
  );
  if (covered) return null;
  const fields = Object.keys({ ...receipts.baseline, ...receipts.candidate })
    .filter((key) => !row.volatile?.includes(key))
    .filter(
      (key) =>
        JSON.stringify(receipts.baseline?.[key]) !==
        JSON.stringify(receipts.candidate?.[key])
    );
  const entry = { row: row.name, fixture: row.fixture, baseline, candidate };
  return `the candidate's output differs from the reference's (${fields.join(', ')}) and no entry in scripts/bench/accepted-differences.json explains it; if the difference is intended, add ${JSON.stringify({ ...entry, reason: '<why>' })}`;
}

function measureRow(
  row: Row,
  baseline: Side,
  candidate: Side,
  accepted: readonly AcceptedDifference[]
): RowResult {
  const result: RowResult = {
    row: row.name,
    outcome: 'invalid',
    pairs: [],
    receipts: {},
  };
  const seen = { baseline: new Set<string>(), candidate: new Set<string>() };
  const take = (which: 'baseline' | 'candidate', side: Side) => {
    const sample = row.run(side);
    seen[which].add(stableReceipt(row, sample.receipt));
    result.receipts[which] ??= sample.receipt;
    return sample.ms;
  };
  // Pair 0 (the warm-up) runs baseline first; the order alternates after.
  const runPair = (index: number): Pair => {
    if (index % 2 === 0) {
      const baselineMs = take('baseline', baseline);
      return { baseline: baselineMs, candidate: take('candidate', candidate) };
    }
    const candidateMs = take('candidate', candidate);
    return { baseline: take('baseline', baseline), candidate: candidateMs };
  };

  try {
    runPair(0);
    // Correctness first: no timing counts for output the reference does
    // not share and nothing explains.
    const unexplained = unexplainedDifference(row, result.receipts, accepted);
    if (unexplained !== null) throw new InvalidRun(unexplained);
    let verdict: ReturnType<typeof decide> | 'fail-fast' = 'inconclusive';
    for (const blocks of [1, 2]) {
      while (result.pairs.length < blocks * BLOCK) {
        result.pairs.push(runPair(result.pairs.length + 1));
        if (clearRegression(result.pairs)) {
          verdict = 'fail-fast';
          break;
        }
      }
      if (verdict === 'fail-fast') break;
      verdict = decide(result.pairs, row.budget);
      if (verdict !== 'inconclusive') break;
    }
    for (const which of ['baseline', 'candidate'] as const) {
      if (seen[which].size > 1) {
        throw new InvalidRun(`the ${which}'s receipt differs between runs`);
      }
    }
    if (verdict === 'fail-fast') {
      result.outcome = 'fail';
      result.reason =
        'clear regression: the first three pairs are each over 2x and over 1 s slower';
    } else {
      result.outcome = verdict === 'inconclusive' ? 'unqualified' : verdict;
    }
  } catch (error) {
    if (!(error instanceof InvalidRun)) throw error;
    result.outcome = 'invalid';
    result.reason = error.message;
  }
  return result;
}

// ── Report ──────────────────────────────────────────────────────────

function summarize(result: RowResult, budget: Budget) {
  if (result.pairs.length === 0) return null;
  const pairs = result.pairs;
  return {
    pairs: pairs.length,
    baselineMedianMs: median(pairs.map((pair) => pair.baseline)),
    candidateMedianMs: median(pairs.map((pair) => pair.candidate)),
    medianRatio: median(pairs.map((pair) => pair.candidate / pair.baseline)),
    medianDifferenceMs: median(
      pairs.map((pair) => pair.candidate - pair.baseline)
    ),
    noise: pairs.length >= 3 ? noise(pairs, budget) : null,
    scores: pairs.map((pair) => score(pair, budget)).sort((a, b) => a - b),
  };
}

/** Where the candidate checkout's timed binding came from: its commit and
 *  the bytes of the native binary that was packed. */
function checkoutProvenance(root: string) {
  const dir = join(root, 'packages/extract/crates/extractor');
  const binary = readdirSync(dir).find((name) =>
    name.startsWith(`animus-extractor.${platform()}-${arch()}`)
  );
  return {
    checkout: root,
    git: gitState(root),
    native:
      binary === undefined
        ? null
        : { file: binary, sha256: digestFiles([join(dir, binary)]) },
  };
}

function readAccepted(): AcceptedDifference[] {
  // SAFETY: a committed file this script owns, read whole.
  return JSON.parse(
    readFileSync(join(import.meta.dirname, 'accepted-differences.json'), 'utf8')
  ) as AcceptedDifference[];
}

function gitState(root: string): string {
  const head = sh('git', ['rev-parse', 'HEAD'], root);
  if (head.status !== 0) return 'not a git checkout';
  const dirty = sh('git', ['status', '--porcelain'], root).stdout.trim() !== '';
  return `${head.stdout.trim()}${dirty ? ' (uncommitted changes)' : ''}`;
}

function main(): void {
  const { values } = parseArgs({
    options: {
      candidate: { type: 'string' },
      'candidate-release': { type: 'string' },
      row: { type: 'string', multiple: true },
      confirm: { type: 'string' },
    },
  });
  if (
    values.candidate !== undefined &&
    values['candidate-release'] !== undefined
  ) {
    fail('pass --candidate or --candidate-release, not both');
  }
  const diagnostic = values['candidate-release'];
  if (diagnostic !== undefined && !pins.diagnostic.includes(diagnostic)) {
    fail(
      `--candidate-release ${diagnostic} is not a diagnostic release in releases.json`
    );
  }

  requireIdleRust();
  requireRelease(pins.reference);
  if (diagnostic !== undefined) requireRelease(diagnostic);
  requireFreshCheckout(REPO, [...PACKAGES, 'test-ds']);
  const candidateRoot = realpathSync(values.candidate ?? REPO);
  if (candidateRoot !== realpathSync(REPO)) {
    requireFreshCheckout(candidateRoot, PACKAGES);
  }
  const accepted = readAccepted();

  const candidateLabel =
    diagnostic === undefined
      ? `checkout ${candidateRoot} at ${gitState(candidateRoot)}`
      : `release ${diagnostic} (DIAGNOSTIC reference, not a gate candidate)`;
  console.error(`[verify:bench] reference: release ${pins.reference}`);
  console.error(`[verify:bench] candidate: ${candidateLabel}`);

  const baseline = installSide('baseline', releaseTarballs(pins.reference));
  const candidate = installSide(
    'candidate',
    diagnostic === undefined
      ? packCheckout(candidateRoot, join(BENCH, 'packed'))
      : releaseTarballs(diagnostic)
  );

  const closure = writeLargeClosure(
    join(BENCH, 'fixtures', 'large-closure'),
    realpathSync(join(REPO, 'packages/system'))
  );
  const closureDigest = fixtureDigest(closure);
  const showcase = join(REPO, 'packages/showcase');
  const capture = join(BENCH, 'fixtures', 'analysis-showcase.json');
  rmSync(capture, { force: true });
  const captured = spawnSync(
    'node',
    [
      join(resolvedPackage('vite', showcase), 'bin/vite.js'),
      'build',
      '--outDir',
      join(BENCH, 'fixtures', 'showcase-dist'),
      '--emptyOutDir',
    ],
    {
      cwd: showcase,
      encoding: 'utf8',
      env: {
        ...process.env,
        ANIMUS_BENCH_CAPTURE: capture,
        NODE_OPTIONS: `--require ${join(RUNNERS, 'capture.cjs')}`,
      },
    }
  );
  if (captured.status !== 0 || !existsSync(capture)) {
    fail(
      `capturing the showcase's analysis input failed:\n${`${captured.stdout}${captured.stderr}`.slice(-2000)}`
    );
  }
  const captureDigest = digestFiles([capture]);

  const rows: Row[] = [
    {
      name: 'loader:large-closure',
      fixture: 'large-closure',
      budget: NATIVE_LOADER,
      run: (side) =>
        nodeSample([
          join(RUNNERS, 'loader.cjs'),
          side.extract,
          closure.systemPath,
          closure.root,
        ]),
    },
    {
      name: 'loader:showcase',
      fixture: 'showcase',
      budget: NATIVE_LOADER,
      run: (side) =>
        nodeSample([
          join(RUNNERS, 'loader.cjs'),
          side.extract,
          join(showcase, 'src/ds.ts'),
          showcase,
        ]),
    },
    {
      name: 'analysis:showcase',
      fixture: 'showcase-analysis',
      budget: NATIVE_ANALYSIS,
      run: (side) =>
        nodeSample([join(RUNNERS, 'analysis.cjs'), side.extract, capture]),
    },
    {
      name: 'build:vite-app',
      fixture: 'vite-app',
      budget: FULL_BUILD,
      run: buildSample,
      volatile: ['phases'],
    },
  ];
  const selected = values.row ?? rows.map((row) => row.name);
  for (const name of selected) {
    if (!rows.some((row) => row.name === name)) fail(`unknown --row ${name}`);
  }

  const results: RowResult[] = [];
  for (const row of rows.filter((candidateRow) =>
    selected.includes(candidateRow.name)
  )) {
    console.error(`[verify:bench] ${row.name}…`);
    results.push(measureRow(row, baseline, candidate, accepted));
  }
  if (
    fixtureDigest(closure) !== closureDigest ||
    digestFiles([capture]) !== captureDigest
  ) {
    for (const result of results) {
      result.outcome = 'invalid';
      result.reason = 'a fixture changed during the run';
    }
  }

  const rustc = sh('rustc', ['-V'], REPO);
  const receipt = {
    date: new Date().toISOString(),
    host: {
      platform: `${platform()} ${release()} ${arch()}`,
      cpu: cpus()[0]?.model,
      node: sh('node', ['--version'], REPO).stdout.trim(),
      rustc: rustc.status === 0 ? rustc.stdout.trim() : null,
    },
    reference: pins.reference,
    candidate: candidateLabel,
    provenance: {
      reference: {
        release: pins.reference,
        integrity: pins.releases[pins.reference],
      },
      candidate:
        diagnostic === undefined
          ? checkoutProvenance(candidateRoot)
          : { release: diagnostic, integrity: pins.releases[diagnostic] },
    },
    fixtures: { largeClosure: closureDigest, analysisShowcase: captureDigest },
    rows: results.map((result) => ({
      ...result,
      summary: summarize(
        result,
        rows.find((row) => row.name === result.row)?.budget ?? FULL_BUILD
      ),
    })),
  };
  const receiptPath = join(
    BENCH,
    'receipts',
    `${receipt.date.replace(/[:.]/g, '-')}.json`
  );
  mkdirSync(dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

  const ms = (value: number) => `${value.toFixed(1)} ms`;
  for (const row of receipt.rows) {
    const summary = row.summary;
    const timing =
      summary === null
        ? ''
        : ` reference ${ms(summary.baselineMedianMs)}, candidate ${ms(summary.candidateMedianMs)}, ratio ${summary.medianRatio.toFixed(3)}, difference ${ms(summary.medianDifferenceMs)} over ${summary.pairs} pairs; noise ${summary.noise === null ? 'n/a' : `baseline ${(summary.noise.baseline * 100).toFixed(1)}%, paired ${(summary.noise.paired * 100).toFixed(1)}%, candidate ${(summary.noise.candidate * 100).toFixed(1)}%`}`;
    console.log(`${row.outcome.toUpperCase().padEnd(11)} ${row.row}:${timing}`);
    if (row.reason !== undefined) console.log(`            ${row.reason}`);
  }
  console.log(`receipt: ${receiptPath}`);
  if (
    values.confirm !== undefined &&
    results.every((result) => result.outcome !== 'invalid')
  ) {
    const unpassed = results.filter((result) => result.outcome !== 'pass');
    writeFileSync(
      values.confirm,
      unpassed.map((result) => result.row).join(' ')
    );
  }
  if (results.some((result) => result.outcome !== 'pass')) process.exitCode = 1;
}

main();
