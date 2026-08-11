import {
  lutimesSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { dirname, join, relative, sep } from 'path';

import { getReplacementEpoch } from '../../../extract/session/singleton';
import { buildManifest, SYSTEM_CONFIG } from '../singleton-fixtures';

import type { Mock } from 'vitest';

/**
 * Shared gauntlet harness (openspec: next-webpack-served-transform-coherence,
 * increment 03), built on the probe idioms proven in
 * evidence/webpack-probe/: programmatic watch with a compilation counter in
 * watchRun, a loader run log, bundle greps for the generation each module's
 * output derived from, delayed edits between compilations, and a settle
 * window that catches echo compilations.
 *
 * The webpack under test is ALWAYS a Next fixture's compiled copy, loaded
 * via `loadFixtureWebpack` — never a top-level webpack import.
 */

const requireCjs = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loadFixtureWebpack(webpackPath: string): any {
  const webpackModule = requireCjs(webpackPath);
  // Next 15 ships `{ init, webpack }` (init required before use); Next 16's
  // compiled bundle exposes the same surface via lazy getters with no init.
  if (typeof webpackModule.init === 'function') {
    webpackModule.init();
  }
  return webpackModule.webpack;
}

// Shared fixtures (globals hygiene, SYSTEM_CONFIG, manifest builder) —
// re-exported so gauntlet test files import ONE surface.
export {
  ANIMUS_GLOBAL_KEYS,
  buildManifest,
  resetAnimusGlobals,
  SYSTEM_CONFIG,
} from '../singleton-fixtures';

/** Key the on-disk loader shim delegates to — the REAL animus loader (from
 *  increment 02) runs inside the vitest process; the shim exists only
 *  because webpack `require`s loaders from disk and cannot load TS. */
export const LOADER_IMPL_KEY = '__ANIMUS_GAUNTLET_LOADER_IMPL__';

/** Write the require-able loader shim into the project and return its path.
 *  Idempotent (a later session must not touch the existing file — the shim
 *  is a file dependency of every processed module) and backdated on first
 *  write so its fresh mtime can never fire a too-new phantom rebuild. */
export function writeLoaderShim(root: string): string {
  const shimPath = join(root, 'animus-loader-shim.js');
  const content = `'use strict';
module.exports = function (source) {
  return globalThis[${JSON.stringify(LOADER_IMPL_KEY)}].call(this, source);
};
`;
  try {
    if (readFileSync(shimPath, 'utf-8') === content) return shimPath;
  } catch {
    // first write below
  }
  writeFileSync(shimPath, content);
  const stamp = new Date(Date.now() - 10_000);
  utimesSync(shimPath, stamp, stamp);
  return shimPath;
}

// ── Fixture project ────────────────────────────────────────────────────────

export const PARENT_REL = 'src/parent.js';
export const CHILD_REL = 'src/child.js';
export const NEWCOMER_REL = 'src/newcomer.js';

/**
 * Parent module carrying two independent markers: `shape:` feeds the canned
 * analysis' replacement plans (a config-shape edit), `style:` feeds only the
 * emitted CSS (a style-value-only edit). Descendant `child.js`'s plan is
 * derived from the parent's shape marker — the transitive-propagation model.
 */
export function parentSource(shape: string, style: string): string {
  return `module.exports = 'parent'; // shape:${shape} style:${style}\n`;
}

export function childSource(): string {
  return `module.exports = 'child';\n`;
}

/** Newcomer content with zero animus entries (no chain marker). */
export function newcomerRawSource(): string {
  return `module.exports = 'newcomer';\n`;
}

/** Newcomer content whose FIRST builder chain appears (chain marker). */
export function newcomerChainSource(): string {
  return `module.exports = 'newcomer'; // chain\n`;
}

export interface GauntletProject {
  root: string;
  write(relPath: string, content: string): void;
  read(relPath: string): string;
  /** Backdate every file currently in the project (10s) so watchpack's
   *  too-new initial-scan heuristic cannot fire a phantom rebuild for
   *  files written moments before the watch started. Call ONLY before a
   *  project's FIRST session — later calls would perturb the mtimes that
   *  persistent-cache snapshots depend on. */
  backdateAll(): void;
  dispose(): void;
}

export function createGauntletProject(opts?: {
  entryModules?: string[];
}): GauntletProject {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'animus-gauntlet-')));
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
  // Pre-create the artifact + output dirs exactly like real Next consumers:
  // with-animus creates `.animus/` at config time and `.next/` predates the
  // compiler. Creating them mid-session would bump the watched project-root
  // directory's mtime (webpack watches it via resolution existence probes)
  // and fire a phantom directory-change compilation.
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

/** Backdate a tree (files + dirs, 10s) — the phantom-compilation
 *  prophylaxis for newly watched dirs (watchpack treats too-new mtimes as
 *  changes). Exported: external-workspace suites backdate their kit roots
 *  with the SAME policy. */
export function backdateTree(dir: string): void {
  const stamp = new Date(Date.now() - 10_000);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      // Stamp the LINK, never its target: fixtures symlink the repo's real
      // packages into node_modules, and utimesSync follows links — stamping
      // through one rewrites real source mtimes and fires phantom rebuilds
      // in every mtime-keyed consumer outside the fixture.
      lutimesSync(abs, stamp, stamp);
      continue;
    }
    if (entry.isDirectory()) {
      backdateTree(abs);
    }
    utimesSync(abs, stamp, stamp);
  }
  // Directories too: webpack watches ancestor directories through
  // resolution existence probes, and a too-new directory mtime fires the
  // same phantom initial rebuild a too-new file does.
  utimesSync(dir, stamp, stamp);
}

export function entrySource(relModules: string[]): string {
  return relModules.map((rel) => `require('./${rel}');`).join('\n') + '\n';
}

// ── Canned engine (NAPI boundary stand-in) ────────────────────────────────

/** The mock surface armCannedEngine arms (each suite's vi.hoisted set). */
export interface CannedEngineMocks {
  loadSystemModule: Mock;
  analyzeProject: Mock;
  clearAnalysisCache: Mock;
  transformFile: Mock;
}

/**
 * Arm the canned NAPI engine: system config + canned analyze/transform.
 * `extra` runs after the standard arming for suite-specific mocks (e.g.
 * scanKeyframesExports).
 */
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

/**
 * Canned `analyzeProject`: derives the replacement plans from the CURRENT
 * file entries it receives (positional NAPI contract — filesJson first).
 *
 * - parent plan = `parent@<shape>`; child plan = `child@<shape>` — a parent
 *   shape edit changes the DESCENDANT's replacement (transitive model).
 * - the style marker feeds only the CSS — a style edit commits identical
 *   plans (style-only negative model).
 * - `newcomer.js` gains its plan only when its source carries a chain
 *   marker (zero-entries→first-chain model).
 */
export function cannedAnalyzeProject(...args: unknown[]): string {
  const files = JSON.parse(args[0] as string) as Array<{
    path: string;
    source: string;
  }>;
  const parent = files.find((f) => f.path === PARENT_REL);
  const shape = parent?.source.match(/shape:(\w+)/)?.[1] ?? 'G?';
  const style = parent?.source.match(/style:(\w+)/)?.[1] ?? 'S?';
  const components: Record<string, unknown> = {};
  if (parent) {
    components[`${PARENT_REL}::Parent`] = {
      file: PARENT_REL,
      replacement: `parent@${shape}`,
    };
  }
  if (files.some((f) => f.path === CHILD_REL)) {
    components[`${CHILD_REL}::Child`] = {
      file: CHILD_REL,
      replacement: `child@${shape}`,
    };
  }
  const newcomer = files.find((f) => f.path === NEWCOMER_REL);
  if (newcomer && newcomer.source.includes('chain')) {
    components[`${NEWCOMER_REL}::Newcomer`] = {
      file: NEWCOMER_REL,
      replacement: `newcomer@${shape}`,
    };
  }
  return buildManifest(components, `.p{--style:${style}}`);
}

/**
 * Canned `transformFile` (v1-parity 3-arg surface consumed by loader-core):
 * appends one greppable marker per manifest entry owned by the file, so the
 * emitted bundle records exactly which generation each module's output
 * derived from — the probe suite's bundle-grep witness.
 */
export function cannedTransformFile(
  source: string,
  filename: string,
  manifestJson: string
): { code: string; hasComponents: boolean } {
  const manifest = JSON.parse(manifestJson) as {
    components?: Record<string, { file?: string; replacement?: string }>;
  };
  const owned = Object.values(manifest.components ?? {}).filter(
    (c) => c.file === filename
  );
  if (owned.length === 0) return { code: source, hasComponents: false };
  const markers = owned
    .map((c) => `/* animus:${filename}=${c.replacement} */`)
    .join('\n');
  return { code: `${source}\n${markers}\n`, hasComponents: true };
}

/** Generation marker the bundle carries for one file, or null. */
export function bundleMarker(bundle: string, relPath: string): string | null {
  const match = bundle.match(
    new RegExp(
      `animus:${relPath.replace(/[.\\/]/g, (c) => `\\${c}`)}=([\\w@]+)`
    )
  );
  return match?.[1] ?? null;
}

// ── Watch session driver ──────────────────────────────────────────────────

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

export function createWatchState(): WatchState {
  return {
    turn: 0,
    log: [],
    modifiedByTurn: new Map(),
    removedByTurn: new Map(),
  };
}

/**
 * Install the on-disk shim's delegation target: records (file, turn, epoch)
 * per loader run into `state.log`, then delegates to `loaderFn` (the REAL
 * loader under test). `onCode` observes each run's emitted code (suites
 * asserting on served output). Returns a disposer that removes the global.
 */
export function installLoaderRecorder(
  root: string,
  state: WatchState,
  loaderFn: (this: unknown, source: string) => string,
  onCode?: (file: string, turn: number, code: string) => void
): () => void {
  const g = globalThis as Record<string, unknown>;
  g[LOADER_IMPL_KEY] = function (
    this: { resourcePath: string },
    source: string
  ): string {
    const file = relative(root, this.resourcePath).split(sep).join('/');
    state.log.push({ file, turn: state.turn, epoch: getReplacementEpoch() });
    const code = loaderFn.call(this, source);
    onCode?.(file, state.turn, code);
    return code;
  };
  return () => {
    delete g[LOADER_IMPL_KEY];
  };
}

/**
 * The one gauntlet webpack config shape (differential's superset): memory
 * cache by default, filesystem cache via `cache`, resolver/rule overrides
 * for suites compiling TS sources.
 */
export function buildGauntletConfig(args: {
  root: string;
  shimPath: string;
  plugins: unknown[];
  cache?: unknown;
  resolve?: unknown;
  rulesTest?: RegExp;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): any {
  return {
    mode: 'development',
    context: args.root,
    entry: join(args.root, 'entry.js'),
    output: { path: join(args.root, 'out'), filename: 'bundle.js' },
    devtool: false,
    cache: args.cache ?? { type: 'memory' },
    ...(args.resolve !== undefined ? { resolve: args.resolve } : {}),
    module: {
      rules: [
        { test: args.rulesTest ?? /src[\\/].*\.js$/, use: [args.shimPath] },
      ],
    },
    plugins: args.plugins,
  };
}

export interface CompilationRecord {
  n: number;
  turn: number;
  bundle: string;
  loaderRuns: LoaderRun[];
  modifiedFiles: string[];
  removedFiles: string[];
  /** `compiler.hooks.invalid` firings that preceded this compilation — the
   *  watcher names the exact file whose change (or watchpack's
   *  "outdated on attach" re-emission) triggered the turn. */
  invalidations: Array<{ file: string | null; changeTime: number | null }>;
  hasErrors: boolean;
  errors: string[];
  /** src-module resource (project-relative) → buildInfo.fileDependencies. */
  moduleFileDependencies: Map<string, string[]>;
}

/** Serializable per-turn evidence for count assertions: a spurious extra
 *  compilation must name its trigger set (modified/removed/invalidation)
 *  and errors IN the failure output — vitest's inline preview truncates
 *  nested objects (`…(2)`), which is how CI flake #374 shipped no evidence.
 *  Pass `JSON.stringify(turnEvidence(records), null, 2)` as the assertion
 *  message. */
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

/**
 * Drive one programmatic watch session: build, then apply the steps one at
 * a time — each scheduled 150ms after a compilation completes and DEFERRED
 * while any compilation is in flight, so a spontaneous extra turn (OS event
 * redelivery, a cold-artifact re-check) can never swallow a scripted edit
 * mid-build. A mid-compilation write would make the loader read newer
 * source than the published analysis and fail closed with
 * ANIMUS_ANALYSIS_CATCHING_UP — a harness artifact, not integration
 * behavior (bit CI's differential N0 probes on Linux runners). Once steps
 * are exhausted, a quiet settle window (default 900ms — long enough to
 * catch an echo compilation) closes the watcher AND the compiler (flushing
 * any filesystem cache).
 */
export function runWatchSession(opts: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  webpack: any;
  root: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any;
  state: WatchState;
  steps?: Array<(record: CompilationRecord) => void>;
  settleMs?: number;
}): Promise<CompilationRecord[]> {
  const { webpack, root, config, state } = opts;
  const steps = opts.steps ?? [];
  const settleMs = opts.settleMs ?? 900;

  return new Promise((resolvePromise, rejectPromise) => {
    const compiler = webpack(config);

    // Whether a compilation is currently in flight — the quiescence gate
    // for step application (set at watchRun, cleared in the done callback).
    let building = false;

    // Turn counter + modifiedFiles capture. Registered AFTER the plugin's
    // own taps (config.plugins apply first), so the turn number is stable
    // by the time loaders run.
    compiler.hooks.watchRun.tapPromise(
      'gauntlet-recorder',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (c: any) => {
        building = true;
        state.turn += 1;
        state.modifiedByTurn.set(state.turn, [...(c.modifiedFiles ?? [])]);
        state.removedByTurn.set(state.turn, [...(c.removedFiles ?? [])]);
      }
    );

    // The watcher's own account of WHY a turn fired — watchpack passes the
    // triggering file to `invalid` (null for aggregated/manual invalidates).
    const pendingInvalidations: Array<{
      file: string | null;
      changeTime: number | null;
    }> = [];
    compiler.hooks.invalid.tap(
      'gauntlet-recorder',
      (file: string | null, changeTime: number) => {
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

    // Single-flight step dispatch: at most one scripted edit is pending at
    // a time, fired 150ms after a completed turn and deferred while any
    // turn is in flight — spontaneous extra compilations shift WHEN an
    // edit lands, never WHERE (always between turns).
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

    // Watch with the COMPILER's own watchOptions — exactly what Next does —
    // so the plugin's `watchOptions.ignored` epoch entry (applied at
    // plugin-apply time) governs the live watcher.
    const watching = compiler.watch(
      { aggregateTimeout: 50, ...(compiler.options?.watchOptions ?? {}) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (err: Error | null, stats: any) => {
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
            // Live builds expose fileDependencies until the snapshot is
            // taken; snapshotted/restored modules expose the same set via
            // buildInfo.snapshot.getFileIterable().
            const direct = compiledModule.buildInfo?.fileDependencies;
            if (direct) for (const dep of direct) deps.add(dep);
            const snapshot = compiledModule.buildInfo?.snapshot;
            if (typeof snapshot?.getFileIterable === 'function') {
              for (const dep of snapshot.getFileIterable()) deps.add(dep);
            }
            if (deps.size > 0) {
              moduleFileDependencies.set(relative(root, resource), [...deps]);
            }
          }
        } catch {
          // module introspection is best-effort evidence
        }
        const record: CompilationRecord = {
          n: doneCount,
          turn: state.turn,
          bundle,
          loaderRuns: state.log.splice(0),
          modifiedFiles: state.modifiedByTurn.get(state.turn) ?? [],
          removedFiles: state.removedByTurn.get(state.turn) ?? [],
          invalidations: pendingInvalidations.splice(0),
          hasErrors: Boolean(stats.hasErrors?.()),
          errors: (stats.compilation?.errors ?? []).map((e: unknown) =>
            String((e as { message?: string })?.message ?? e)
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
          // A step is pending (scheduled now or still deferred) — even one
          // that fails to trigger a compilation must not hang the session:
          // keep a long stop-loss settle.
          settleTimer = setTimeout(finish, settleMs + 4000);
        } else {
          settleTimer = setTimeout(finish, settleMs);
        }
      }
    );
  });
}

/** Loader runs for one file within one compilation record. */
export function runsFor(
  record: CompilationRecord,
  relPath: string
): LoaderRun[] {
  return record.loaderRuns.filter((run) => run.file === relPath);
}

/**
 * Epoch-echo hygiene detector (consult §W correctness/hygiene split): after
 * the cold build, every compilation must carry a NON-EMPTY trigger set that
 * names neither the epoch artifact nor anything under `.animus/` — the
 * integration's own writes never fire a compilation. OS-level redelivery of
 * a genuine SOURCE edit (the same edited file re-appearing in a later
 * trigger set) is environmental and deliberately not a violation.
 * Returns human-readable violations; expect it to be empty.
 */
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
