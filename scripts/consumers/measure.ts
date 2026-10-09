#!/usr/bin/env bun

// measure:consumers — what a change does to real consumers.
// A measurement, not a gate: it fails only when a build cannot run.
//
// Builds Animus at two refs, then runs each consumer app's own build script
// (`build` by default) against each ref and reports, per consumer: the
// emitted CSS bytes (raw, gzip and per @layer) and JS bytes, the
// diagnostics by code, the components and options pruned, and whether the
// build passed. The difference between the refs is the headline.
//
// Nothing is written inside a consumer checkout. Each checkout is copied to
// the work directory without `node_modules` or `.git`; its `node_modules`
// are rebuilt there as links to the originals' packages, binaries and
// stores, with `@animus-ui/*` pointing at the ref's built packages. Cache
// and temp directories are not linked, so a build creates its own in the
// copy. Builds run in the copy with ANIMUS_DEBUG=1, so the host logs its
// reconciliation report. Only Vite apps are measured, and each `&&` step of
// the script runs even after an earlier one fails, so a failing type check
// still lets the bundle be measured.
//
// Usage:
//   bun scripts/consumers/measure.ts --base <ref> --head <ref>
//     [--consumer <app dir>]... [--script <name>] [--config <file>]
//     [--retention] [--work <dir>] [--json <file>]
// --retention adds which @animus-ui/system modules each app's client bundle
// keeps, builder modules (theme and system construction) apart from the
// runtime, with rendered bytes. It costs one extra bundling run per app and
// ref: the script's last step, after the measured build, with the app's
// Vite config wrapped in the copy so @animus-ui/system resolves to the
// ref's sources and a plugin records each module's rendered length.
// Consumers may also come from a local config file,
// scripts/consumers/consumers.local.json by default (gitignored):
//   { "consumers": [{ "app": "<dir>", "outDir": "dist" }] }
// An app's output directory is read from its Vite config (`outDir`), else
// `dist`. Built refs are cached in the work directory, keyed by commit; the
// work directory defaults to a folder in the OS temp directory.

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';

const REPO = resolve(import.meta.dirname, '..', '..');
const LOCAL_CONFIG = join(import.meta.dirname, 'consumers.local.json');
const COPY_SKIP = new Set([
  'node_modules',
  '.git',
  '.animus',
  '.next',
  '.turbo',
]);
/** The dot-entries of a node_modules directory that are linked: binaries,
 *  package stores and install metadata. Every other dot-entry is a cache or
 *  temp directory a build writes to, so the copy starts without it. */
const LINKED_DOT_ENTRIES = new Set([
  '.bin',
  '.bun',
  '.pnpm',
  '.modules.yaml',
  '.package-lock.json',
]);

interface ConsumerSpec {
  app: string;
  outDir?: string;
}

interface Consumer {
  name: string;
  /** The app directory, absolute. */
  app: string;
  /** The checkout the app belongs to, absolute. */
  checkout: string;
  /** The app's build output directory, relative to the app. */
  outDir: string;
}

interface StepOutcome {
  command: string;
  passed: boolean;
  failure?: string;
}

interface Measurement {
  /** Every step of the build script passed. */
  passed: boolean;
  steps: StepOutcome[];
  seconds: number;
  cssRaw?: number;
  cssGzip?: number;
  jsRaw?: number;
  /** Bytes per top-level `@layer`, plus `(unlayered)`. */
  layers?: Map<string, number>;
  diagnostics?: Map<string, number>;
  componentsTotal?: number;
  componentsExtracted?: number;
  variantsPruned?: number;
  statesPruned?: number;
  /** Rendered bytes per retained @animus-ui/system source module, from the
   *  retention run; absent without --retention or when it failed. */
  systemModules?: Map<string, number>;
  retentionFailure?: string;
}

interface RunResult {
  status: number;
  output: string;
}

interface BuiltRef {
  sha: string;
  dir: string;
}

function run(
  command: string,
  args: string[],
  cwd: string,
  logFile?: string
): RunResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (logFile) writeFileSync(logFile, output, { flag: 'a' });
  return { status: result.status ?? 1, output };
}

function fail(message: string): never {
  console.error(`[measure:consumers] ${message}`);
  process.exit(1);
}

/** Builds Animus at `ref` into the work directory once per commit. */
function buildRef(ref: string, work: string): BuiltRef {
  const parsed = run('git', ['rev-parse', '--verify', `${ref}^{commit}`], REPO);
  if (parsed.status !== 0) fail(`unknown ref ${ref}`);
  const sha = parsed.output.trim();
  const dir = join(work, 'builds', sha);
  if (existsSync(join(dir, '.built'))) return { sha, dir };
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const log = join(dir, '..', `${sha}.log`);
  rmSync(log, { force: true });
  console.error(
    `[measure:consumers] building ${ref} (${sha.slice(0, 8)}); log: ${log}`
  );
  const steps: Array<[string, string[]]> = [
    ['sh', ['-c', `git -C "${REPO}" archive ${sha} | tar -x -C "${dir}"`]],
    ['bun', ['install', '--frozen-lockfile']],
    ['bunx', ['vp', 'run', 'build:extract-v2']],
    ['bunx', ['vp', 'run', 'build:ts']],
  ];
  for (const [command, args] of steps) {
    const step = run(command, args, dir, log);
    if (step.status !== 0) {
      fail(
        `building ${ref} failed at \`${command} ${args.join(' ')}\`; see ${log}`
      );
    }
  }
  writeFileSync(join(dir, '.built'), `${ref}\n`);
  return { sha, dir };
}

/** The `outDir` literal in the app's Vite config, else `dist`. */
function readOutDir(app: string): string {
  for (const file of readdirSync(app)) {
    if (!/^vite\.config\.m?[jt]s$/.test(file)) continue;
    const source = readFileSync(join(app, file), 'utf8');
    return /outDir:\s*['"]([^'"]+)['"]/.exec(source)?.[1] ?? 'dist';
  }
  return fail(`${app} has no Vite config; only Vite apps are measured`);
}

function resolveConsumer(spec: ConsumerSpec): Consumer {
  const app = resolve(spec.app);
  if (!existsSync(join(app, 'package.json'))) {
    fail(`consumer app ${spec.app} has no package.json`);
  }
  const top = run('git', ['rev-parse', '--show-toplevel'], app);
  const checkout = top.status === 0 ? realpathSync(top.output.trim()) : app;
  const appPath = relative(checkout, realpathSync(app));
  return {
    name: appPath ? `${basename(checkout)}/${appPath}` : basename(checkout),
    app: realpathSync(app),
    checkout,
    outDir: spec.outDir ?? readOutDir(app),
  };
}

/** Every top-level `node_modules` directory in the checkout. */
function nodeModulesDirs(root: string, at = root): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(at, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.git') continue;
    const path = join(at, entry.name);
    if (entry.name === 'node_modules') found.push(path);
    else found.push(...nodeModulesDirs(root, path));
  }
  return found;
}

/** The ref's built `@animus-ui/*` packages, by package name. */
function refPackages(build: string): Map<string, string> {
  const packages = new Map<string, string>();
  const packagesDir = join(build, 'packages');
  for (const name of readdirSync(packagesDir)) {
    const manifest = join(packagesDir, name, 'package.json');
    if (!existsSync(manifest)) continue;
    // SAFETY: a workspace package.json; only its `name` string is read.
    const { name: packageName } = JSON.parse(
      readFileSync(manifest, 'utf8')
    ) as {
      name?: string;
    };
    if (packageName?.startsWith('@animus-ui/')) {
      packages.set(packageName, join(packagesDir, name));
    }
  }
  return packages;
}

/** Links one node_modules entry into the copy: a relative link inside the
 *  checkout keeps its relative target, so it lands in the copy; anything
 *  else points at the original. */
function linkEntry(
  source: string,
  target: string,
  checkout: string,
  copy: string
): void {
  const stat = lstatSync(source);
  if (stat.isSymbolicLink()) {
    const link = readlinkSync(source);
    const resolved = resolve(dirname(source), link);
    if (!isAbsolute(link) && !relative(checkout, resolved).startsWith('..')) {
      symlinkSync(link, target);
    } else if (!relative(checkout, resolved).startsWith('..')) {
      symlinkSync(join(copy, relative(checkout, resolved)), target);
    } else {
      symlinkSync(resolved, target);
    }
    return;
  }
  symlinkSync(source, target);
}

/** Removes a previous copy, which may hold read-only directories copied
 *  from the checkout. */
function removeTree(path: string): void {
  if (!existsSync(path)) return;
  run('chmod', ['-R', 'u+w', path], dirname(path));
  rmSync(path, { recursive: true, force: true });
}

/** Copies the checkout's sources and rebuilds its node_modules as links,
 *  with `@animus-ui/*` swapped for the ref's packages. */
function prepareCopy(consumer: Consumer, build: string, copy: string): void {
  removeTree(copy);
  cpSync(consumer.checkout, copy, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (path) =>
      !COPY_SKIP.has(basename(path)) || path === consumer.checkout,
  });
  const animus = refPackages(build);
  for (const modules of nodeModulesDirs(consumer.checkout)) {
    const shadow = join(copy, relative(consumer.checkout, modules));
    mkdirSync(shadow, { recursive: true });
    for (const name of readdirSync(modules)) {
      if (name.startsWith('.') && !LINKED_DOT_ENTRIES.has(name)) continue;
      const source = join(modules, name);
      if (name === '@animus-ui') {
        mkdirSync(join(shadow, name));
        for (const sub of readdirSync(source)) {
          const own = animus.get(`@animus-ui/${sub}`);
          if (own) symlinkSync(own, join(shadow, name, sub));
          else
            linkEntry(
              join(source, sub),
              join(shadow, name, sub),
              consumer.checkout,
              copy
            );
        }
      } else if (name.startsWith('@') && lstatSync(source).isDirectory()) {
        mkdirSync(join(shadow, name));
        for (const sub of readdirSync(source)) {
          linkEntry(
            join(source, sub),
            join(shadow, name, sub),
            consumer.checkout,
            copy
          );
        }
      } else {
        linkEntry(source, join(shadow, name), consumer.checkout, copy);
      }
    }
  }
}

/** Bytes of each top-level `@layer name { … }` block; the rest is
 *  reported as `(unlayered)`. */
function layerBytes(css: string) {
  const layers = new Map<string, number>();
  let unlayered = 0;
  let index = 0;
  const opener = /@layer\s+([\w-]+)\s*\{/y;
  while (index < css.length) {
    opener.lastIndex = index;
    const match = opener.exec(css);
    if (!match) {
      unlayered += 1;
      index += 1;
      continue;
    }
    let depth = 1;
    let cursor = opener.lastIndex;
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === '{') depth += 1;
      else if (css[cursor] === '}') depth -= 1;
      cursor += 1;
    }
    layers.set(match[1], (layers.get(match[1]) ?? 0) + (cursor - index));
    index = cursor;
  }
  layers.set('(unlayered)', unlayered);
  return layers;
}

/** Every file under `dir` whose name ends with `extension`. */
function filesUnder(dir: string, extension: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith(extension))
    .map((path) => join(dir, path))
    .sort();
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/** Diagnostic codes, and the host's uncoded warning kinds, in the build
 *  output; a line counts once per code it names. */
function diagnosticCounts(lines: readonly string[]) {
  const counts = new Map<string, number>();
  const add = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);
  for (const line of lines) {
    const codes = new Set(
      Array.from(
        line.matchAll(
          /[[(](animus\.[a-z0-9.-]+)[\])]|^\s*(animus\.[a-z0-9.-]+) — /g
        ),
        (m) => m[1] ?? m[2]
      )
    );
    for (const code of codes) add(code);
    if (codes.size > 0) continue;
    if (/ not extracted: /.test(line)) add('(not extracted)');
    else if (/ eliminated: /.test(line)) add('(eliminated)');
    else if (/⚠ .*: skipped /.test(line)) add('(skipped)');
  }
  return counts;
}

/** The `.bin` directories a package script sees, nearest first. */
function binPath(app: string, copy: string): string {
  const dirs: string[] = [];
  for (let dir = app; ; dir = dirname(dir)) {
    const bin = join(dir, 'node_modules', '.bin');
    if (existsSync(bin)) dirs.push(bin);
    if (dir === copy || dir === dirname(dir)) break;
  }
  return [...dirs, process.env.PATH ?? ''].join(':');
}

/** System source modules the runtime needs; every other retained module
 *  of the package is builder code. */
const RUNTIME_MODULE =
  /^(runtime\/|runtime-entry\.|class-resolver\.|compose\.|composeWithContext\.|appearance\/|bootstrap\/)/;

const RETENTION_PLUGIN = `import { appendFileSync } from 'node:fs';
export function animusMeasureRetention(outFile, systemSrc) {
  return {
    name: 'animus-measure-retention',
    enforce: 'post',
    generateBundle(_options, bundle) {
      if ((this.environment?.name ?? 'client') !== 'client') return;
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const [id, info] of Object.entries(chunk.modules)) {
          if (info.renderedLength > 0 && id.startsWith(systemSrc)) {
            appendFileSync(outFile, JSON.stringify([id.slice(systemSrc.length), info.renderedLength]) + '\\n');
          }
        }
      }
    },
  };
}
`;

/** The app's Vite config, wrapped: the original is imported unchanged, and
 *  only the retention run's environment adds the plugin and aliases. */
function retentionWrapper(original: string, pluginPath: string): string {
  return `// @ts-nocheck
import original from './${original.replace(/\.[mc]?[jt]s$/, '')}';
import { animusMeasureRetention } from ${JSON.stringify(pluginPath)};
export default async (env) => {
  const config = typeof original === 'function' ? await original(env) : await original;
  const out = process.env.ANIMUS_MEASURE_RETENTION;
  if (!out) return config;
  // Longest first: a string alias also matches the specifier's subpaths.
  const aliases = JSON.parse(process.env.ANIMUS_MEASURE_ALIASES)
    .sort((a, b) => b[0].length - a[0].length)
    .map(([find, replacement]) => ({ find, replacement }));
  const existing = config.resolve?.alias ?? [];
  const merged = Array.isArray(existing) ? existing : Object.entries(existing).map(([find, replacement]) => ({ find, replacement }));
  return {
    ...config,
    plugins: [...(config.plugins ?? []), animusMeasureRetention(out, process.env.ANIMUS_MEASURE_SYSTEM_SRC)],
    resolve: { ...config.resolve, alias: [...aliases, ...merged] },
  };
};
`;
}

/** @animus-ui/system and each of its subpath exports, mapped to the ref's
 *  source module: `./dist/x.js` names `./src/x.ts` (or `.tsx`). */
function systemSourceAliases(systemDir: string): Array<[string, string]> {
  // SAFETY: the ref's own package manifest; only `exports` keys and their
  // `import` strings are read, and a missing source file drops the entry.
  const { exports } = JSON.parse(
    readFileSync(join(systemDir, 'package.json'), 'utf8')
  ) as { exports?: Record<string, { import?: string }> };
  const aliases: Array<[string, string]> = [];
  for (const [subpath, conditions] of Object.entries(exports ?? {})) {
    const target = conditions.import;
    if (!target?.startsWith('./dist/')) continue;
    const stem = join(
      systemDir,
      'src',
      target.slice('./dist/'.length).replace(/\.js$/, '')
    );
    const source = ['.ts', '.tsx'].map((ext) => stem + ext).find(existsSync);
    if (source) aliases.push([`@animus-ui/system${subpath.slice(1)}`, source]);
  }
  return aliases;
}

/** Which @animus-ui/system source modules the app's client bundle keeps:
 *  one more run of the script's last step, with the config wrapped. */
function retentionRun(
  app: string,
  build: string,
  runDir: string,
  bundleStep: string,
  env: NodeJS.ProcessEnv
): { modules: Map<string, number> } | { failure: string } {
  const config = readdirSync(app).find((file) =>
    /^vite\.config\.m?[jt]s$/.test(file)
  );
  if (!config) return { failure: 'no Vite config' };
  const original = config.replace(
    /^vite\.config/,
    'vite.config.animus-measure-original'
  );
  cpSync(join(app, config), join(app, original));
  const pluginPath = join(runDir, 'retention-plugin.mjs');
  writeFileSync(pluginPath, RETENTION_PLUGIN);
  writeFileSync(join(app, config), retentionWrapper(original, pluginPath));
  const systemDir = join(build, 'packages', 'system');
  const out = join(runDir, 'retention.jsonl');
  rmSync(out, { force: true });
  const result = spawnSync('sh', ['-c', bundleStep], {
    cwd: app,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: {
      ...env,
      ANIMUS_MEASURE_RETENTION: out,
      ANIMUS_MEASURE_SYSTEM_SRC: `${join(systemDir, 'src')}/`,
      ANIMUS_MEASURE_ALIASES: JSON.stringify(systemSourceAliases(systemDir)),
    },
  });
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`.replace(ANSI, '');
  writeFileSync(join(runDir, 'retention.log'), text);
  if (result.status !== 0) return { failure: failureLine(text, result.status) };
  const modules = new Map<string, number>();
  if (existsSync(out)) {
    for (const line of readFileSync(out, 'utf8').split('\n')) {
      if (!line) continue;
      // SAFETY: lines the plugin above wrote, each [module path, bytes].
      const [path, bytes] = JSON.parse(line) as [string, number];
      modules.set(path, (modules.get(path) ?? 0) + bytes);
    }
  }
  return { modules };
}

/** The most telling line of a failed step: a thrown error, else a
 *  compiler error, else any error or failure line. */
function failureLine(text: string, status: number | null): string {
  const lines = text.split('\n').map((line) => line.trim());
  const line =
    lines.find((l) => l.startsWith('Error:')) ??
    lines.find((l) => /\berror TS\d+/.test(l)) ??
    lines.find((l) => /error|failed/i.test(l) && !l.startsWith('⚠'));
  return line?.slice(0, 240) ?? `exit ${status}`;
}

function measure(
  consumer: Consumer,
  build: string,
  runDir: string,
  script: string,
  retention: boolean
): Measurement {
  const copy = join(runDir, 'checkout');
  prepareCopy(consumer, build, copy);
  const app = join(copy, relative(consumer.checkout, consumer.app));
  // SAFETY: the consumer's own package.json; only `scripts` is read.
  const { scripts } = JSON.parse(
    readFileSync(join(app, 'package.json'), 'utf8')
  ) as { scripts?: Record<string, string> };
  const command = scripts?.[script];
  if (!command) fail(`${consumer.name} has no "${script}" script`);
  // Each `&&` step runs even after an earlier one fails, so a failing type
  // check still lets the bundling step be measured.
  const env = {
    ...process.env,
    PATH: binPath(app, copy),
    ANIMUS_DEBUG: '1',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  };
  const started = performance.now();
  const steps: StepOutcome[] = [];
  let output = '';
  for (const step of command.split('&&').map((part) => part.trim())) {
    const result = spawnSync('sh', ['-c', step], {
      cwd: app,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      env,
    });
    const text = `${result.stdout ?? ''}${result.stderr ?? ''}`.replace(
      ANSI,
      ''
    );
    output += `$ ${step}\n${text}\n`;
    const failure =
      result.status === 0 ? undefined : failureLine(text, result.status);
    steps.push({ command: step, passed: result.status === 0, failure });
  }
  const seconds = Math.round((performance.now() - started) / 100) / 10;
  writeFileSync(join(runDir, 'build.log'), output);
  const lines = output.split('\n');
  const passed = steps.every((step) => step.passed);
  if (!steps[steps.length - 1]?.passed) {
    return { passed, steps, seconds, diagnostics: diagnosticCounts(lines) };
  }
  const outDir = join(app, consumer.outDir);
  const css = Buffer.concat(
    filesUnder(outDir, '.css').map((file) => readFileSync(file))
  );
  const jsRaw = filesUnder(outDir, '.js').reduce(
    (total, file) => total + readFileSync(file).length,
    0
  );
  const extracted = output.match(/Extracted (\d+)\/(\d+) components/);
  const reconciled = output.match(
    /Reconciliation: \d+ kept, (\d+) variants pruned, (\d+) states pruned/
  );
  // After the measured output is read, since the run rewrites it.
  const retained = retention
    ? retentionRun(app, build, runDir, steps[steps.length - 1].command, env)
    : null;
  return {
    passed,
    steps,
    seconds,
    systemModules:
      retained && 'modules' in retained ? retained.modules : undefined,
    retentionFailure:
      retained && 'failure' in retained ? retained.failure : undefined,
    cssRaw: css.length,
    cssGzip: gzipSync(css, { level: 9 }).length,
    jsRaw,
    layers: layerBytes(css.toString('utf8')),
    diagnostics: diagnosticCounts(lines),
    componentsExtracted: extracted ? Number(extracted[1]) : undefined,
    componentsTotal: extracted ? Number(extracted[2]) : undefined,
    variantsPruned: reconciled ? Number(reconciled[1]) : undefined,
    statesPruned: reconciled ? Number(reconciled[2]) : undefined,
  };
}

function delta(base: number | undefined, head: number | undefined): string {
  if (base === undefined || head === undefined) return '';
  const change = head - base;
  if (change === 0) return '0';
  const percent =
    base === 0
      ? ''
      : ` (${change > 0 ? '+' : ''}${((change / base) * 100).toFixed(1)}%)`;
  return `${change > 0 ? '+' : ''}${change.toLocaleString('en-US')}${percent}`;
}

function cell(value: number | undefined): string {
  return value === undefined ? '—' : value.toLocaleString('en-US');
}

function report(
  consumer: Consumer,
  refs: { base: string; head: string },
  base: Measurement,
  head: Measurement
): string {
  const lines = [
    `### ${consumer.name}`,
    '',
    `The app's \`build\` output in \`${consumer.outDir}\`.`,
    '',
    `| | ${refs.base} | ${refs.head} | Change |`,
    '|---|---:|---:|---:|',
  ];
  const outcome = (m: Measurement, index: number) => {
    const step = m.steps[index];
    if (!step) return '—';
    return step.passed ? 'passed' : '**failed**';
  };
  const stepCount = Math.max(base.steps.length, head.steps.length);
  for (let index = 0; index < stepCount; index += 1) {
    const command = (head.steps[index] ?? base.steps[index]).command;
    lines.push(
      `| step \`${command}\` | ${outcome(base, index)} | ${outcome(head, index)} | |`
    );
  }
  const rows: Array<[string, (m: Measurement) => number | undefined]> = [
    ['CSS bytes, raw', (m) => m.cssRaw],
    ['CSS bytes, gzip', (m) => m.cssGzip],
    ['JS bytes, raw', (m) => m.jsRaw],
    ['components found', (m) => m.componentsTotal],
    ['components extracted', (m) => m.componentsExtracted],
    ['variant options pruned', (m) => m.variantsPruned],
    ['states pruned', (m) => m.statesPruned],
  ];
  const layerNames = new Set([
    ...(base.layers?.keys() ?? []),
    ...(head.layers?.keys() ?? []),
  ]);
  for (const layer of [...layerNames].sort()) {
    rows.push([
      `CSS bytes in \`${layer}\``,
      (m) => (m.layers ? (m.layers.get(layer) ?? 0) : undefined),
    ]);
  }
  if (base.systemModules || head.systemModules) {
    const sum = (m: Measurement, builder: boolean) =>
      m.systemModules
        ? [...m.systemModules].reduce(
            (total, [path, bytes]) =>
              RUNTIME_MODULE.test(path) === builder ? total : total + bytes,
            0
          )
        : undefined;
    rows.push([
      '@animus-ui/system builder bytes (rendered)',
      (m) => sum(m, true),
    ]);
    rows.push([
      '@animus-ui/system runtime bytes (rendered)',
      (m) => sum(m, false),
    ]);
    const modules = new Set([
      ...(base.systemModules?.keys() ?? []),
      ...(head.systemModules?.keys() ?? []),
    ]);
    for (const path of [...modules].sort()) {
      if (RUNTIME_MODULE.test(path)) continue;
      rows.push([
        `builder \`${path}\``,
        (m) => (m.systemModules ? (m.systemModules.get(path) ?? 0) : undefined),
      ]);
    }
  }
  const codes = new Set([
    ...(base.diagnostics?.keys() ?? []),
    ...(head.diagnostics?.keys() ?? []),
  ]);
  for (const code of [...codes].sort()) {
    rows.push([
      `diagnostic \`${code}\``,
      (m) => (m.diagnostics ? (m.diagnostics.get(code) ?? 0) : undefined),
    ]);
  }
  for (const [label, read] of rows) {
    lines.push(
      `| ${label} | ${cell(read(base))} | ${cell(read(head))} | ${delta(read(base), read(head))} |`
    );
  }
  lines.push(`| build seconds | ${base.seconds} | ${head.seconds} | |`);
  for (const [ref, m] of [
    [refs.base, base],
    [refs.head, head],
  ] as const) {
    if (m.retentionFailure) {
      lines.push(
        '',
        `At ${ref}, the retention run failed: \`${m.retentionFailure}\``
      );
    }
    for (const step of m.steps) {
      if (step.failure) {
        lines.push(
          '',
          `At ${ref}, \`${step.command}\` failed: \`${step.failure}\``
        );
      }
    }
  }
  return lines.join('\n');
}

function main(): void {
  const { values } = parseArgs({
    options: {
      base: { type: 'string' },
      head: { type: 'string' },
      consumer: { type: 'string', multiple: true },
      script: { type: 'string', default: 'build' },
      retention: { type: 'boolean', default: false },
      config: { type: 'string' },
      work: { type: 'string' },
      json: { type: 'string' },
    },
  });
  if (!values.base || !values.head) fail('pass --base <ref> and --head <ref>');
  const specs: ConsumerSpec[] = (values.consumer ?? []).map((app) => ({ app }));
  const configFile = values.config ?? LOCAL_CONFIG;
  if (existsSync(configFile)) {
    // SAFETY: the user's own local config; each entry is validated below.
    const config = JSON.parse(readFileSync(configFile, 'utf8')) as {
      consumers?: ConsumerSpec[];
    };
    for (const entry of config.consumers ?? []) {
      if (!entry.app) fail(`${configFile}: every consumer needs "app"`);
      specs.push(entry);
    }
  }
  if (specs.length === 0)
    fail('pass --consumer <app dir>, or list consumers in a local config file');
  const consumers = specs.map(resolveConsumer);
  const work = resolve(
    values.work ?? join(tmpdir(), 'animus-measure-consumers')
  );
  mkdirSync(work, { recursive: true });

  const refs = { base: values.base, head: values.head };
  const builds = {
    base: buildRef(refs.base, work),
    head: buildRef(refs.head, work),
  };
  const sections: string[] = [];
  const results: Record<string, { base: Measurement; head: Measurement }> = {};
  for (const consumer of consumers) {
    const runFor = (side: 'base' | 'head'): Measurement => {
      const runDir = join(
        work,
        'runs',
        builds[side].sha.slice(0, 12),
        consumer.name.replace(/[^\w.-]+/g, '_')
      );
      mkdirSync(runDir, { recursive: true });
      console.error(`[measure:consumers] ${consumer.name} at ${refs[side]}`);
      return measure(
        consumer,
        builds[side].dir,
        runDir,
        values.script,
        values.retention
      );
    };
    const base = runFor('base');
    const head = runFor('head');
    results[consumer.name] = { base, head };
    sections.push(report(consumer, refs, base, head));
  }
  console.log(
    [
      `## Consumer impact: ${refs.base} (${builds.base.sha.slice(0, 8)}) → ${refs.head} (${builds.head.sha.slice(0, 8)})`,
      '',
      ...sections.flatMap((section) => [section, '']),
    ].join('\n')
  );
  if (values.json) {
    // A Map serializes as `{}`, so layer counts become plain objects here.
    const toPlain = (
      _key: string,
      value:
        | Measurement['layers']
        | Measurement['diagnostics']
        | Measurement['systemModules']
        | string
    ) => (value instanceof Map ? Object.fromEntries(value) : value);
    writeFileSync(
      values.json,
      `${JSON.stringify({ refs, results }, toPlain, 2)}\n`
    );
  }
  // Unmeasurable: the bundling step, the last, failed at both refs.
  const bundled = (m: Measurement) => m.steps[m.steps.length - 1]?.passed;
  const unrunnable = Object.values(results).some(
    (r) => !bundled(r.base) && !bundled(r.head)
  );
  if (unrunnable) process.exitCode = 1;
}

main();
