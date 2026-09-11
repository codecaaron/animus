import { isJsonObject, isJsonString } from '@animus-ui/assertions';
import {
  lutimesSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { dirname, join, relative, sep } from 'path';

import { getReplacementEpoch } from '../../../extract/session/singleton';
import {
  buildManifest,
  makeComponent,
  SYSTEM_CONFIG,
} from '../../../extract/tests/session/session-fixtures';

import type { ReplacementPlan } from '../../../extract/tests/session/session-fixtures';
import type { JsonValue } from '@animus-ui/assertions';
import type { ManifestComponentDescriptor } from '@animus-ui/extract/pipeline';
import type { Mock } from 'vitest';

const requireCjs = createRequire(import.meta.url);

interface HarnessWatchCompilerState {
  modifiedFiles?: Iterable<string>;
  removedFiles?: Iterable<string>;
}

interface HarnessCompiledModule {
  resource?: string;
  buildInfo?: {
    fileDependencies?: Iterable<string>;
    snapshot?: { getFileIterable?: () => Iterable<string> };
  };
}

interface HarnessCompilationError {
  message?: string;
}

interface HarnessStats {
  hasErrors?: () => boolean;
  compilation: {
    modules: Iterable<HarnessCompiledModule>;
    errors: HarnessCompilationError[];
  };
}

type WatchIgnoreEntry = string | RegExp;
type WatchIgnoreMatcher = (path: string) => boolean;
type WatchIgnored =
  | WatchIgnoreEntry
  | readonly WatchIgnoreEntry[]
  | WatchIgnoreMatcher
  | null
  | undefined;

interface HarnessWatchOptions {
  aggregateTimeout?: number;
  ignored?: WatchIgnored;
}

interface HarnessCompiler {
  options?: { watchOptions?: HarnessWatchOptions };
  hooks: {
    watchRun: {
      tapPromise(
        name: string,
        callback: (compiler: HarnessWatchCompilerState) => Promise<void>
      ): void;
    };
    invalid: {
      tap(
        name: string,
        callback: (file: string | null, changeTime: number | null) => void
      ): void;
    };
  };
  watch(
    options: HarnessWatchOptions,
    callback: (error: Error | null, stats: HarnessStats) => void
  ): { close(callback: () => void): void };
  close(callback: () => void): void;
}

interface HarnessWebpackConfig {
  mode?: 'development';
}

type FixtureWebpack = (config: HarnessWebpackConfig) => HarnessCompiler;

interface FixtureWebpackModuleCandidate {
  init?: object | null;
  webpack?: object | null;
}

function initializeFixtureWebpackModule(
  candidate: FixtureWebpackModuleCandidate
): void {
  if (candidate.init === undefined) return;
  if (Object.prototype.toString.call(candidate.init) !== '[object Function]') {
    throw new TypeError('fixture webpack module has an invalid init export');
  }
  // SAFETY: The function tag validates the optional init method; calling it
  // through the module keeps the receiver its lazy webpack export needs.
  (candidate as FixtureWebpackModuleCandidate & { init(): void }).init();
}

export function loadFixtureWebpack(webpackPath: string): FixtureWebpack {
  const webpackModule: FixtureWebpackModuleCandidate = requireCjs(webpackPath);
  // Next 15 ships `{ init, webpack }` (init required before use); Next 16's
  // compiled bundle exposes the same surface via lazy getters with no init.
  initializeFixtureWebpackModule(webpackModule);
  if (
    Object.prototype.toString.call(webpackModule.webpack) !==
    '[object Function]'
  ) {
    throw new TypeError('fixture webpack module has an invalid webpack export');
  }
  // SAFETY: The post-init function tag establishes the callable webpack
  // factory both supported Next fixture module surfaces return.
  return webpackModule.webpack as FixtureWebpack;
}

export {
  ANIMUS_GLOBAL_KEYS,
  buildManifest,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from '../../../extract/tests/session/session-fixtures';

/** Key the on-disk shim delegates to: webpack requires loaders from disk and
 *  cannot load TS, so the real loader stays inside the vitest process. */
export const LOADER_IMPL_KEY = '__ANIMUS_HARNESS_LOADER_IMPL__';

export function writeLoaderShim(root: string): string {
  const shimPath = join(root, 'animus-loader-shim.js');
  const content = `'use strict';
module.exports = function (source) {
  return globalThis[${JSON.stringify(LOADER_IMPL_KEY)}].call(this, source);
};
`;
  try {
    if (readFileSync(shimPath, 'utf-8') === content) return shimPath;
  } catch {}
  writeFileSync(shimPath, content);
  const stamp = new Date(Date.now() - 10_000);
  utimesSync(shimPath, stamp, stamp);
  return shimPath;
}

export const PARENT_REL = 'src/parent.js';
export const CHILD_REL = 'src/child.js';
export const NEWCOMER_REL = 'src/newcomer.js';

export function parentSource(generation: string, style: string): string {
  return `module.exports = 'parent'; // shape:${generation} style:${style}\n`;
}

export function childSource(): string {
  return `module.exports = 'child';\n`;
}

export function newcomerRawSource(): string {
  return `module.exports = 'newcomer';\n`;
}

export function newcomerChainSource(): string {
  return `module.exports = 'newcomer'; // chain\n`;
}

export interface HarnessProject {
  root: string;
  write(relPath: string, content: string): void;
  read(relPath: string): string;
  /** Valid only before a project's first session: later calls perturb the
   *  mtimes persistent-cache snapshots depend on. */
  backdateAll(): void;
  dispose(): void;
}

export function createHarnessProject(opts?: {
  entryModules?: string[];
}): HarnessProject {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), 'animus-webpack-watch-'))
  );
  const write = (relPath: string, content: string): void => {
    const abs = join(root, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  };
  const entryModules = opts?.entryModules ?? [PARENT_REL, CHILD_REL];
  write('entry.js', entrySource(entryModules));
  write('src/system.ts', 'export const system = {};\n');
  write(PARENT_REL, parentSource('G0', 'S0'));
  write(CHILD_REL, childSource());
  // Creating these mid-session would bump the watched root's mtime (webpack
  // watches it via resolution probes) and fire a phantom compilation.
  mkdirSync(join(root, '.animus'), { recursive: true });
  mkdirSync(join(root, 'out'), { recursive: true });
  return {
    root,
    write,
    read: (relPath: string) => readFileSync(join(root, relPath), 'utf-8'),
    backdateAll: () => backdateTree(root),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** Backdate files and directories 10s: watchpack treats a too-new mtime as a
 *  change and fires a phantom compilation on a newly watched tree. */
export function backdateTree(dir: string): void {
  const stamp = new Date(Date.now() - 10_000);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      // Stamp the LINK, never its target: utimesSync follows links, and
      // fixtures symlink real packages whose mtimes must not move.
      lutimesSync(abs, stamp, stamp);
      continue;
    }
    if (entry.isDirectory()) {
      backdateTree(abs);
    }
    utimesSync(abs, stamp, stamp);
  }
  utimesSync(dir, stamp, stamp);
}

export function entrySource(relModules: string[]): string {
  return relModules.map((rel) => `require('./${rel}');`).join('\n') + '\n';
}

export interface CannedEngineMocks {
  loadSystemModule: Mock;
  analyzeProject: Mock;
  clearAnalysisCache: Mock;
  transformFile: Mock;
}

interface CannedAnalysisFile {
  path: string;
  source: string;
}

type CannedTransformResult =
  | { code: string; hasComponents: false }
  | { code: string; hasComponents: true };

function parseCannedAnalysisFiles(serialized: string): CannedAnalysisFile[] {
  const candidate: JsonValue = JSON.parse(serialized);
  if (!Array.isArray(candidate)) {
    throw new TypeError('canned analysis files must be an array');
  }
  return candidate.map((file, index) => {
    if (
      !isJsonObject(file) ||
      !isJsonString(file.path) ||
      !isJsonString(file.source)
    ) {
      throw new TypeError(`canned analysis file ${index} is malformed`);
    }
    return { path: file.path, source: file.source };
  });
}

function parseCannedManifestComponents(serialized: string): ReplacementPlan[] {
  const manifest: JsonValue = JSON.parse(serialized);
  if (!isJsonObject(manifest)) {
    throw new TypeError('canned transform manifest must be an object');
  }
  if (!isJsonObject(manifest.components)) {
    throw new TypeError('canned transform components must be an object');
  }

  return Object.entries(manifest.components).map(([componentId, component]) => {
    if (
      !isJsonObject(component) ||
      !isJsonString(component.file) ||
      !isJsonString(component.replacement)
    ) {
      throw new TypeError(
        `canned manifest component ${componentId} is malformed`
      );
    }
    return { file: component.file, replacement: component.replacement };
  });
}

export function armCannedEngine(
  mocks: CannedEngineMocks,
  extra?: () => void
): void {
  mocks.loadSystemModule.mockReset().mockReturnValue({ ...SYSTEM_CONFIG });
  mocks.analyzeProject.mockReset().mockImplementation(cannedAnalyzeProject);
  mocks.clearAnalysisCache.mockReset();
  mocks.transformFile.mockReset().mockImplementation(cannedTransformFile);
  extra?.();
}

export function cannedAnalyzeProject(filesJson: string): string {
  const files = parseCannedAnalysisFiles(filesJson);
  const parent = files.find((f) => f.path === PARENT_REL);
  const generation = parent?.source.match(/shape:(\w+)/)?.[1] ?? 'G?';
  const style = parent?.source.match(/style:(\w+)/)?.[1] ?? 'S?';
  const components: Record<string, ManifestComponentDescriptor> = {};
  if (parent) {
    components[`${PARENT_REL}::Parent`] = makeComponent(
      PARENT_REL,
      `parent@${generation}`
    );
  }
  if (files.some((f) => f.path === CHILD_REL)) {
    components[`${CHILD_REL}::Child`] = makeComponent(
      CHILD_REL,
      `child@${generation}`
    );
  }
  const newcomer = files.find((f) => f.path === NEWCOMER_REL);
  if (newcomer && newcomer.source.includes('chain')) {
    components[`${NEWCOMER_REL}::Newcomer`] = makeComponent(
      NEWCOMER_REL,
      `newcomer@${generation}`
    );
  }
  return buildManifest(components, `.p{--style:${style}}`);
}

export function cannedTransformFile(
  source: string,
  filename: string,
  manifestJson: string
): CannedTransformResult {
  const owned = parseCannedManifestComponents(manifestJson).filter(
    (component) => component.file === filename
  );
  if (owned.length === 0) return { code: source, hasComponents: false };
  const markers = owned
    .map((c) => `/* animus:${filename}=${c.replacement} */`)
    .join('\n');
  return { code: `${source}\n${markers}\n`, hasComponents: true };
}

export function bundleMarker(bundle: string, relPath: string): string | null {
  const match = bundle.match(
    new RegExp(
      `animus:${relPath.replace(/[.\\/]/g, (c) => `\\${c}`)}=([\\w@]+)`
    )
  );
  return match?.[1] ?? null;
}

export interface LoaderRun {
  file: string;
  turn: number;
  epoch: string | null;
}

export interface WatchState {
  turn: number;
  log: LoaderRun[];
  modifiedByTurn: Map<number, string[]>;
  removedByTurn: Map<number, string[]>;
}

interface LoaderExecutionContext {
  resourcePath: string;
}

type HarnessLoader = (this: LoaderExecutionContext, source: string) => string;

export function createWatchState(): WatchState {
  return {
    turn: 0,
    log: [],
    modifiedByTurn: new Map(),
    removedByTurn: new Map(),
  };
}

export function installLoaderRecorder(
  root: string,
  state: WatchState,
  loaderFn: HarnessLoader,
  onCode?: (file: string, turn: number, code: string) => void
): () => void {
  const recorder: HarnessLoader = function (
    this: LoaderExecutionContext,
    source: string
  ): string {
    const file = relative(root, this.resourcePath).split(sep).join('/');
    state.log.push({ file, turn: state.turn, epoch: getReplacementEpoch() });
    const code = loaderFn.call(this, source);
    onCode?.(file, state.turn, code);
    return code;
  };
  Reflect.set(globalThis, LOADER_IMPL_KEY, recorder);
  return () => {
    Reflect.deleteProperty(globalThis, LOADER_IMPL_KEY);
  };
}

interface HarnessWebpackConfigArguments {
  root: string;
  shimPath: string;
  plugins: object[];
  cache?: { type: 'memory' } | { type: 'filesystem'; cacheDirectory: string };
  resolve?: { extensions: string[] };
  rulesTest?: RegExp;
}

interface HarnessWebpackConfig {
  mode: 'development';
  context: string;
  entry: string;
  output: { path: string; filename: string };
  devtool: false;
  cache: { type: 'memory' } | { type: 'filesystem'; cacheDirectory: string };
  resolve?: { extensions: string[] };
  module: {
    rules: Array<{ test: RegExp; use: string[] }>;
  };
  plugins: object[];
}

export function buildHarnessWebpackConfig(
  args: HarnessWebpackConfigArguments
): HarnessWebpackConfig {
  const config: HarnessWebpackConfig = {
    mode: 'development',
    context: args.root,
    entry: join(args.root, 'entry.js'),
    output: { path: join(args.root, 'out'), filename: 'bundle.js' },
    devtool: false,
    cache: args.cache ?? { type: 'memory' },
    module: {
      rules: [
        { test: args.rulesTest ?? /src[\\/].*\.js$/, use: [args.shimPath] },
      ],
    },
    plugins: args.plugins,
  };
  if (args.resolve !== undefined) config.resolve = args.resolve;
  return config;
}

/** Ignores directory paths and everything outside the project: a busy tmpdir
 *  makes watchpack report ancestor dirs changed with no write inside. */
function scopeWatcherToProjectFiles(
  root: string,
  base: WatchIgnored,
  extraRoots: readonly string[]
): (path: string) => boolean {
  const baseMatches = (path: string): boolean => {
    if (base === undefined || base === null) return false;
    if (base instanceof RegExp) return base.test(path);
    if (Array.isArray(base)) {
      return base.some((entry) =>
        entry instanceof RegExp ? entry.test(path) : path === entry
      );
    }
    if (Object.prototype.toString.call(base) === '[object Function]') {
      // SAFETY: WatchIgnored admits one callable variant, and the function tag
      // distinguishes it once null, RegExp, and array are excluded.
      return Boolean((base as WatchIgnoreMatcher)(path));
    }
    return path === base;
  };
  return (path: string): boolean => {
    if (
      extraRoots.some((extra) => path === extra || path.startsWith(extra + sep))
    ) {
      return baseMatches(path);
    }
    if (path === root || !path.startsWith(root + sep)) return true;
    try {
      if (statSync(path).isDirectory()) return true;
    } catch {
      // Absent path = a missing-dep probe inside the project — keep it.
    }
    return baseMatches(path);
  };
}

export interface CompilationRecord {
  n: number;
  turn: number;
  bundle: string;
  loaderRuns: LoaderRun[];
  modifiedFiles: string[];
  removedFiles: string[];
  invalidations: Array<{ file: string | null; changeTime: number | null }>;
  hasErrors: boolean;
  errors: string[];
  /** src-module resource (project-relative) → buildInfo.fileDependencies. */
  moduleFileDependencies: Map<string, string[]>;
}

/** Serializable per-turn evidence: vitest truncates nested objects in a
 *  failure preview, so pass a JSON.stringify of this as the message. */
export function turnEvidence(records: CompilationRecord[]): Array<{
  n: number;
  turn: number;
  modifiedFiles: string[];
  removedFiles: string[];
  invalidations: Array<{ file: string | null; changeTime: number | null }>;
  loaderRuns: LoaderRun[];
  errors: string[];
}> {
  return records.map((r) => ({
    n: r.n,
    turn: r.turn,
    modifiedFiles: r.modifiedFiles,
    removedFiles: r.removedFiles,
    invalidations: r.invalidations,
    loaderRuns: r.loaderRuns,
    errors: r.errors,
  }));
}

/** Steps are deferred while a compilation is in flight: a mid-build write
 *  makes the loader read newer source than the published analysis. */
export function runWatchSession(opts: {
  webpack: FixtureWebpack;
  root: string;
  config: HarnessWebpackConfig;
  state: WatchState;
  steps?: Array<(record: CompilationRecord) => void>;
  settleMs?: number;
  /** Watch surfaces outside the project root that the scope must not
   *  filter. */
  watchRoots?: readonly string[];
}): Promise<CompilationRecord[]> {
  const { webpack, root, config, state } = opts;
  const steps = opts.steps ?? [];
  const settleMs = opts.settleMs ?? 900;

  return new Promise((resolvePromise, rejectPromise) => {
    const compiler = webpack(config);

    let building = false;

    // Registered after the plugin's own taps (config.plugins apply first) so
    // the turn number is stable by the time loaders run.
    compiler.hooks.watchRun.tapPromise(
      'coherence-recorder',
      async (c: HarnessWatchCompilerState) => {
        building = true;
        state.turn += 1;
        state.modifiedByTurn.set(state.turn, [...(c.modifiedFiles ?? [])]);
        state.removedByTurn.set(state.turn, [...(c.removedFiles ?? [])]);
      }
    );

    const pendingInvalidations: Array<{
      file: string | null;
      changeTime: number | null;
    }> = [];
    compiler.hooks.invalid.tap(
      'coherence-recorder',
      (file: string | null, changeTime: number | null) => {
        pendingInvalidations.push({
          file: file ?? null,
          changeTime: changeTime ?? null,
        });
      }
    );

    const records: CompilationRecord[] = [];
    let doneCount = 0;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (): void => {
      watching.close(() => {
        compiler.close(() => resolvePromise(records));
      });
    };

    let nextStep = 0;
    let stepPending = false;
    const scheduleNextStep = (record: CompilationRecord): boolean => {
      if (stepPending || nextStep >= steps.length) return false;
      const step = steps[nextStep++];
      stepPending = true;
      const fireWhenQuiet = (): void => {
        if (building) {
          setTimeout(fireWhenQuiet, 50);
          return;
        }
        stepPending = false;
        step(record);
      };
      setTimeout(fireWhenQuiet, 150);
      return true;
    };

    // Reuse the compiler's watchOptions so the plugin's epoch `ignored` entry
    // governs the live watcher; webpack's config schema rejects a function.
    const baseWatchOptions = compiler.options?.watchOptions ?? {};
    const watching = compiler.watch(
      {
        aggregateTimeout: 50,
        ...baseWatchOptions,
        ignored: scopeWatcherToProjectFiles(
          root,
          baseWatchOptions.ignored,
          opts.watchRoots ?? []
        ),
      },
      (err: Error | null, stats: HarnessStats) => {
        if (err) return rejectPromise(err);
        building = false;
        doneCount += 1;

        let bundle = '';
        try {
          bundle = readFileSync(join(root, 'out', 'bundle.js'), 'utf-8');
        } catch {
          // an errored compilation may emit nothing
        }
        const moduleFileDependencies = new Map<string, string[]>();
        try {
          for (const compiledModule of stats.compilation.modules) {
            const resource: string | undefined = compiledModule.resource;
            if (!resource || !resource.startsWith(root)) continue;
            const deps = new Set<string>();
            // Live builds expose fileDependencies until the snapshot is taken;
            // restored modules expose the same set via the snapshot instead.
            const direct = compiledModule.buildInfo?.fileDependencies;
            if (direct) for (const dep of direct) deps.add(dep);
            const snapshot = compiledModule.buildInfo?.snapshot;
            const snapshotFiles = snapshot?.getFileIterable?.();
            if (snapshotFiles) {
              for (const dep of snapshotFiles) deps.add(dep);
            }
            if (deps.size > 0) {
              moduleFileDependencies.set(relative(root, resource), [...deps]);
            }
          }
        } catch {}
        const record: CompilationRecord = {
          n: doneCount,
          turn: state.turn,
          bundle,
          loaderRuns: state.log.splice(0),
          modifiedFiles: state.modifiedByTurn.get(state.turn) ?? [],
          removedFiles: state.removedByTurn.get(state.turn) ?? [],
          invalidations: pendingInvalidations.splice(0),
          hasErrors: Boolean(stats.hasErrors?.()),
          errors: (stats.compilation?.errors ?? []).map((error) =>
            String(error.message ?? error)
          ),
          moduleFileDependencies,
        };
        records.push(record);

        if (settleTimer) clearTimeout(settleTimer);
        if (
          scheduleNextStep(record) ||
          stepPending ||
          nextStep < steps.length
        ) {
          // A pending step that triggers no compilation must not hang the
          // session, so the settle window is extended instead.
          settleTimer = setTimeout(finish, settleMs + 4000);
        } else {
          settleTimer = setTimeout(finish, settleMs);
        }
      }
    );
  });
}

export function runsFor(
  record: CompilationRecord,
  relPath: string
): LoaderRun[] {
  return record.loaderRuns.filter((run) => run.file === relPath);
}

export function epochHygieneViolations(
  records: CompilationRecord[],
  epochPath: string
): string[] {
  const violations: string[] = [];
  for (const record of records.slice(1)) {
    if (record.modifiedFiles.length === 0) {
      violations.push(
        `compilation ${record.n} fired with an empty trigger set`
      );
    }
    if (record.modifiedFiles.includes(epochPath)) {
      violations.push(
        `compilation ${record.n} was triggered by the epoch artifact`
      );
    }
    if (
      record.modifiedFiles.some(
        (file) =>
          file.includes(`${sep}.animus${sep}`) || file.endsWith(`${sep}.animus`)
      )
    ) {
      violations.push(
        `compilation ${record.n} was triggered by a .animus artifact`
      );
    }
  }
  return violations;
}
