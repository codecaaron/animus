/**
 * One option schema shared by the Vite, Next, and CLI drivers: key semantics,
 * default exclusions, and mode authority cannot drift per driver.
 */

import { realpathSync } from 'fs';
import { relative, resolve, sep } from 'path';

import {
  DIAGNOSTIC_LEVELS,
  hostFinding,
  OUTPUT_SOURCE,
} from './manifest-diagnostics';
import { isPathWithinRoot } from './source-identity';

import type { FetchPriority } from './font-preloads';
import type {
  DiagnosticLevels,
  ManifestDiagnostic,
} from './manifest-diagnostics';
import type { StylesheetDelivery } from './split-stylesheet';
import type { StaticCssConfig } from './static-css';

export const DRIVER_NAMESPACES = ['vite', 'next', 'cli'] as const;
export type DriverNamespace = (typeof DRIVER_NAMESPACES)[number];

const DRIVER_NAMESPACE_KEYS: ReadonlySet<string> = new Set(DRIVER_NAMESPACES);

/**
 * Applied unconditionally: `node_modules` belongs to external-package
 * collection, and `.next`/`.animus` hold output, never source.
 */
export const STRUCTURAL_EXCLUDE = ['node_modules', '.next', '.animus'];

/** Defaults a user `exclude` list replaces; the structural set it cannot. */
export const REPLACEABLE_DEFAULT_EXCLUDE = ['dist', '.test.', '.spec.'];

export const DEFAULT_EXCLUDE = [
  ...STRUCTURAL_EXCLUDE,
  ...REPLACEABLE_DEFAULT_EXCLUDE,
];

/** Explicit dev/prod emission mode. When absent each driver defaults on its
 *  own signal: Vite `config.command`, Next `NODE_ENV`, CLI production. */
export type AnimusMode = 'development' | 'production';

export type Verbosity = 'quiet' | 'verbose' | 'trace';

/** The effective log tier: the option or `ANIMUS_DEBUG`, whichever is higher. */
export function resolveVerbosity(
  option: boolean | 'trace' | undefined,
  debugEnv: string | undefined
): Verbosity {
  if (option === 'trace' || debugEnv === 'trace') return 'trace';
  if (option === true || debugEnv === '1' || debugEnv === 'true') {
    return 'verbose';
  }
  return 'quiet';
}

export interface AnimusCoreOptions {
  /** Path to a module exporting a SystemInstance from `@animus-ui/system`. */
  system: string;
  /** The system's export name in the `system` module. The loader runs only
   *  what that export reaches, and finds it itself when exactly one export
   *  is a sealed system (`.seal()`) and every other export is plainly not
   *  one; otherwise it asks for this option by name. */
  systemExport?: string;
  /**
   * Replaces the replaceable defaults, never the structural ones. Patterns
   * with `*`/`?` are globs on the root-relative path; others are substrings.
   */
  exclude?: string[];
  /**
   * Paths analysed although git keeps them out of the analysis: a path git
   * ignores, or a directory below the root that is a git checkout of its own
   * (a worktree or a nested clone). Either is analysed anyway where an
   * analysed file imports it; this names the others to analyse. Patterns
   * as `exclude`; `['**']` analyses everything git would keep out.
   */
  analyzeIgnored?: string[];
  /** File extensions to scan; replaces the default list entirely. */
  extensions?: string[];
  /** When true, error-severity diagnostics — lost configured inputs and
   *  classified unsupported Animus declarations — and failed checks, such as
   *  an unresolved include or `asset()` specifier, fail a build instead of
   *  warning. Development reports them and keeps running, except where
   *  nothing exists to serve yet. Omitted or `false` warns. */
  strict?: boolean;
  /** Each `animus.*` code's level, by exact code, by a prefix ending in `.*`
   *  (`'animus.style.*'`), or by kind (`'kind:bail'`, `'kind:skip'`,
   *  `'kind:warn'`, `'kind:error'`): `'off'`, `'info'`, `'warn'` or
   *  `'error'`, which fails a build and is reported in development, which
   *  keeps running. An exact code beats the longest matching prefix, which
   *  beats a kind, and an entry beats `strict` and the code's own severity. */
  diagnostics?: DiagnosticLevels;
  /** `true` logs phase checkpoints, summaries and timing; `'trace'` also logs
   *  one line per item (pruned option, transformed file, HMR decision).
   *  `ANIMUS_DEBUG=1` or `ANIMUS_DEBUG=trace` raises it from the environment. */
  verbose?: boolean | 'trace';
  /** Namespace prefix for the custom properties the theme generates: each
   *  token variable becomes `--${prefix}-…` wherever it is defined,
   *  registered or read. Contextual variables keep their declared names
   *  unless `prefixContextualVars` is set. Class names, slot classes and
   *  slot variables keep `animus-`; `shortClassNames.prefix` names classes
   *  short in production, independently of this one. */
  prefix?: string;
  /** With `prefix` set, contextual variables take the prefixed name
   *  everywhere Animus emits them, while authors keep writing the declared
   *  name. */
  prefixContextualVars?: boolean;
  /** Browser targets for CSS autoprefixing and syntax lowering. */
  targets?: string | string[];
  /** Keeps `:dir()` as written where the targets would lower it to
   *  `:lang()` over right-to-left language codes, which an element that sets
   *  only `dir` does not match. */
  keepDirSelector?: boolean;
  /** Production names each component and utility class by a short stable
   *  id under `prefix` (a letter, then letters and digits): `{prefix}-{id}`
   *  and `{prefix}_{id}`. Each id derives from what the readable name hashes,
   *  so an added component renames no other, except in the rare case that
   *  its 32-bit id collides with one, when both take 64-bit ids. Variant,
   *  compound, state and breakpoint suffixes are kept. Development keeps the readable names.
   *  Two builds on one page take different prefixes. */
  shortClassNames?: { prefix: string };
  /** Writes `.animus/prop-order.json`, which the `animus/prop-order` lint
   *  rule reads, after every analysis; off by default. */
  propOrderFile?: boolean;
  /** Minification control; `undefined` = minify in production mode only. */
  minify?: boolean;
  /** Forced-emission declarations for usage the scanner cannot observe. */
  staticCss?: StaticCssConfig;
  /** Full `@layer` declaration order. */
  layers?: string[];
  engine?: 'v2';
  /** The module extracted terminals import their factories from; default
   *  `@animus-ui/system/runtime` in every host. `@animus-ui/system` also
   *  supplies every terminal; another override must supply every terminal
   *  the analysis extracts. */
  runtimeImport?: string;
  /** Computed `import()`s declared closed, by site: each may load only
   *  its `targets`, an assumption the analysis records and does not check.
   *  `'build-chunks'` is the modules the build's own literal `import()`s
   *  name. Every other computed `import()` may still load any module. */
  closedDynamicImports?: ClosedDynamicImport[];
  /**
   * Decides emitted bytes (minify, dev diagnostics, engine devMode) and wins
   * over environment signals; never process lifecycle (watchers, HMR).
   */
  mode?: AnimusMode;
  /** The font faces this app preloads, in place of each typed face's own
   *  `preload` flag: one declaration of a face serves every product, and
   *  only the faces this app's first screen renders should preload. See
   *  {@link FontPreloadEntry}; `[]` preloads none. */
  fontPreloads?: FontPreloadEntry[];
  /** `'split'` delivers the stylesheet as consecutive files linked in
   *  order, each a slice of the one `'single'` (the default) delivers:
   *  foundation, components, then utilities, so a file an edit leaves alone
   *  keeps its cached copy. Vite builds and the CLI deliver it; Vite's dev
   *  server keeps one sheet. */
  stylesheets?: StylesheetDelivery;
  /** Root every relative input resolves against. Vite and unplugin derive
   *  their root from the host bundler and reject this key; Next takes it as
   *  the app's root, since Next passes no dir to a config module. */
  root?: string;
}

/**
 * A face selection for the `fontPreloads` option. A family name selects
 * every face of the family. An object selects the faces of `family` whose
 * declared weight contains `weight` (a number, `'normal'` or `'bold'`; a
 * variable face's range such as `'100 900'` contains each weight in it, and
 * no weight selects any), whose style is `style` (`'normal'` when omitted),
 * and whose declared unicode-range covers `unicodeRange` (such as
 * `'U+0000-00FF'`, choosing one subset of a family split by script; a face
 * without one covers every code point, and no `unicodeRange` selects any).
 * Families match as a face's `family` prints, ignoring ASCII case.
 * `fetchpriority` (`'high'`, `'low'` or `'auto'`) is written on the preloads
 * of the faces the entry selects; a file several entries select carries the
 * strongest one given, and none gives none. An entry no face matches reports
 * `animus.style.font-preload-unmatched`; a malformed one, a weight range
 * included, reports `animus.style.font-preload-invalid`.
 */
export type FontPreloadEntry =
  | string
  | {
      family: string;
      weight?: number | string;
      style?: string;
      unicodeRange?: string;
      fetchpriority?: FetchPriority;
    };

export const CORE_OPTION_KEYS: ReadonlySet<string> = new Set([
  'system',
  'systemExport',
  'exclude',
  'analyzeIgnored',
  'extensions',
  'strict',
  'diagnostics',
  'verbose',
  'prefix',
  'prefixContextualVars',
  'targets',
  'keepDirSelector',
  'shortClassNames',
  'propOrderFile',
  'minify',
  'staticCss',
  'layers',
  'engine',
  'mode',
  'root',
  'runtimeImport',
  'closedDynamicImports',
  'fontPreloads',
  'stylesheets',
]);

/** A computed `import()` declared closed: written in `importer` (relative
 *  to the root), inside the function named `enclosingFunction`, loading only
 *  `targets`. */
export interface ClosedDynamicImport {
  importer: string;
  enclosingFunction: string;
  targets: 'build-chunks';
}

const CLOSED_SITE_KEYS = 'enclosingFunction,importer,targets';

const isClosedSite = (site: unknown): site is ClosedDynamicImport => {
  if (Object.prototype.toString.call(site) !== '[object Object]') return false;
  const fields = new Map(Object.entries(Object(site)));
  const named = (key: string) => {
    const value = fields.get(key);
    return isString(value) && value !== '';
  };
  return (
    [...fields.keys()].sort().join(',') === CLOSED_SITE_KEYS &&
    named('importer') &&
    named('enclosingFunction') &&
    fields.get('targets') === 'build-chunks'
  );
};

const isClosedDynamicImports = (
  value: unknown
): value is ClosedDynamicImport[] =>
  Array.isArray(value) && value.every(isClosedSite);

/** Carries a stable `name` so drivers can map it to their own config-error
 *  surface (the CLI's exit code 2). */
export class AnimusConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnimusConfigError';
  }
}

/** Applies to unknown and rejected KEYS only: invalid VALUES always throw.
 *  Published plugin entries pass `'warn'` so a stale key cannot break them. */
export type AssertKnownOptionKeysOpts =
  | { onUnknownKey?: 'throw' }
  | { onUnknownKey: 'warn'; warn: (message: string) => void };

/**
 * `ownKeys` is the caller's own top-level surface; `rejectKeys` names core
 * keys it does not honor, which must fail rather than be silently ignored.
 */
export function assertKnownOptionKeys<Value>(
  raw: Readonly<Record<string, Value>>,
  ownKeys: readonly string[] = [],
  rejectKeys: ReadonlyArray<{ key: string; reason: string }> = [],
  opts: AssertKnownOptionKeysOpts = {}
): void {
  const surface = (message: string): void => {
    if (opts.onUnknownKey === 'warn') {
      opts.warn(message);
      return;
    }
    throw new AnimusConfigError(message);
  };
  const own = new Set(ownKeys);
  for (const key of Object.keys(raw)) {
    if (raw[key] === undefined) continue;
    const rejected = rejectKeys.find((entry) => entry.key === key);
    if (rejected) {
      surface(
        `Option "${key}" is not supported by this driver: ${rejected.reason}`
      );
      continue;
    }
    if (
      CORE_OPTION_KEYS.has(key) ||
      DRIVER_NAMESPACE_KEYS.has(key) ||
      own.has(key)
    ) {
      continue;
    }
    const nearest = suggestNearest(key);
    surface(
      `Unknown option "${key}".${nearest ? ` Did you mean "${nearest}"?` : ''} ` +
        `Core keys: ${[...CORE_OPTION_KEYS].join(', ')}. ` +
        `Driver namespaces: ${DRIVER_NAMESPACES.join(', ')}.`
    );
  }
  const mode = raw['mode'];
  if (mode !== undefined && mode !== 'development' && mode !== 'production') {
    throw new AnimusConfigError(
      `Invalid mode "${String(mode)}" — expected "development" or "production".`
    );
  }
  // Fatal even in warn mode: a wrongly-typed value never behaves as written
  // ("false" is truthy; a string spread into a Set becomes characters).
  for (const { key, ok, expected } of CORE_VALUE_GATES) {
    const value = raw[key];
    if (value === undefined || ok(value)) continue;
    throw new AnimusConfigError(
      `Invalid value for "${key}" — expected ${expected}, got ` +
        `${JSON.stringify(value)}.`
    );
  }
}

type CoreOptionValue =
  | string
  | boolean
  | readonly string[]
  | DiagnosticLevels
  | readonly ClosedDynamicImport[]
  | { prefix: string };

/**
 * Options are foreign JS, so a boxed `String`/`Boolean` must not pass: a
 * boxed value never behaves as the primitive its consumers expect.
 */
const isString = (value: unknown): value is string =>
  Object(value) !== value &&
  Object.prototype.toString.call(value) === '[object String]';

const isBoolean = (value: unknown): value is boolean =>
  Object(value) !== value &&
  Object.prototype.toString.call(value) === '[object Boolean]';

const isVerbose = (value: unknown): value is boolean | 'trace' =>
  isBoolean(value) || value === 'trace';

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every(isString);

const isDiagnosticLevels = (value: unknown): value is DiagnosticLevels =>
  Object.prototype.toString.call(value) === '[object Object]' &&
  Object.values(Object(value)).every(
    (level) => isString(level) && DIAGNOSTIC_LEVELS.has(level)
  );

const isShortClassNames = (value: unknown): value is { prefix: string } => {
  if (Object.prototype.toString.call(value) !== '[object Object]') return false;
  const fields = new Map(Object.entries(Object(value)));
  const prefix = fields.get('prefix');
  return (
    fields.size === 1 &&
    isString(prefix) &&
    /^[A-Za-z][A-Za-z0-9]*$/.test(prefix)
  );
};

const isStringOrStringArray = (
  value: unknown
): value is string | readonly string[] =>
  isString(value) || isStringArray(value);

const CORE_VALUE_GATES: ReadonlyArray<{
  key: string;
  ok: (value: unknown) => value is CoreOptionValue;
  expected: string;
}> = [
  {
    key: 'system',
    ok: isString,
    expected: 'a string path',
  },
  { key: 'root', ok: isString, expected: 'a string path' },
  {
    key: 'exclude',
    ok: isStringArray,
    expected: 'an array of string patterns',
  },
  {
    key: 'analyzeIgnored',
    ok: isStringArray,
    expected: 'an array of string patterns',
  },
  {
    key: 'extensions',
    ok: isStringArray,
    expected: 'an array of string extensions',
  },
  { key: 'strict', ok: isBoolean, expected: 'a boolean' },
  {
    key: 'diagnostics',
    ok: isDiagnosticLevels,
    expected: "an object mapping codes to 'off', 'info', 'warn' or 'error'",
  },
  { key: 'verbose', ok: isVerbose, expected: "a boolean or 'trace'" },
  { key: 'minify', ok: isBoolean, expected: 'a boolean' },
  { key: 'keepDirSelector', ok: isBoolean, expected: 'a boolean' },
  {
    key: 'shortClassNames',
    ok: isShortClassNames,
    expected: '{ prefix } with a letter, then letters and digits',
  },
  { key: 'propOrderFile', ok: isBoolean, expected: 'a boolean' },
  { key: 'prefix', ok: isString, expected: 'a string' },
  {
    key: 'closedDynamicImports',
    ok: isClosedDynamicImports,
    expected:
      "an array of { importer, enclosingFunction, targets: 'build-chunks' }",
  },
  {
    key: 'runtimeImport',
    ok: (value): value is string => isString(value) && value !== '',
    expected: 'a module specifier',
  },
  { key: 'prefixContextualVars', ok: isBoolean, expected: 'a boolean' },
  {
    key: 'stylesheets',
    ok: (value): value is string => value === 'single' || value === 'split',
    expected: "'single' or 'split'",
  },
  {
    key: 'targets',
    ok: isStringOrStringArray,
    expected: 'a string or an array of strings',
  },
  {
    key: 'layers',
    ok: isStringArray,
    expected: 'an array of layer names',
  },
];

function suggestNearest(key: string): string | null {
  const lower = key.toLowerCase();
  let best: string | null = null;
  let bestScore = 3; // max edit distance considered a plausible typo
  for (const candidate of CORE_OPTION_KEYS) {
    const score = editDistance(lower, candidate.toLowerCase());
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length];
}

export interface ExcludeMatcher {
  /** Effective list: structural ∪ output dirs ∪ (user ?? replaceable
   *  defaults). */
  readonly patterns: readonly string[];
  /** Per-pattern hit counts over this matcher's lifetime; zero hits after
   *  discovery means the pattern matched nothing. A user pattern counts
   *  every path it matches, whichever pattern excludes the path. */
  stats(): ReadonlyMap<string, number>;
  /** The user's patterns that have matched nothing yet, other than
   *  Animus's own defaults copied into the list; none without a user
   *  list. */
  unmatched(): string[];
  /** True when the path is excluded; both path forms are tested. */
  matches(fullPath: string, relativePath: string): boolean;
  explain(fullPath: string, relativePath: string): string | null;
  /** True when discovery leaves out a directory it has entered the
   *  listing of: asked once per directory, after `matches` kept it. */
  skipsDirectory?(fullPath: string, relativePath: string): boolean;
}

const GLOB_META = /[*?]/;

/**
 * Globs compile to a RegExp over the root-relative path, matching the path or
 * any ancestor directory; plain patterns are substrings. `./` is stripped.
 */
function compilePattern(raw: string): (full: string, rel: string) => boolean {
  let pattern = raw.split('\\').join('/');
  while (pattern.startsWith('./')) pattern = pattern.slice(2);
  if (pattern === '') return () => false;
  if (!GLOB_META.test(pattern)) {
    return (full, rel) => full.includes(pattern) || rel.includes(pattern);
  }
  const regex = globToRegExp(pattern);
  return (_full, rel) => {
    const normalized = rel.split('\\').join('/');
    if (regex.test(normalized)) return true;
    for (
      let slash = normalized.indexOf('/');
      slash !== -1;
      slash = normalized.indexOf('/', slash + 1)
    ) {
      if (regex.test(normalized.slice(0, slash))) return true;
    }
    return false;
  };
}

/** Whether a path matches any of `patterns`, each read as an `exclude`
 *  pattern. */
export function matchesAnyPattern(
  patterns: readonly string[]
): (fullPath: string, relativePath: string) => boolean {
  const tests = patterns.map(compilePattern);
  return (full, rel) => tests.some((test) => test(full, rel));
}

/** Minimal glob → RegExp: `**` spans segments, `*`/`?` stay within one. */
export function globToRegExp(glob: string): RegExp {
  let out = '';
  let i = 0;
  const normalized = glob.split('\\').join('/');
  while (i < normalized.length) {
    const ch = normalized[i];
    if (ch === '*') {
      if (normalized[i + 1] === '*') {
        if (normalized[i + 2] === '/') {
          out += '(?:[^/]+/)*';
          i += 3;
        } else {
          out += '.*';
          i += 2;
        }
      } else {
        out += '[^/]*';
        i += 1;
      }
    } else if (ch === '?') {
      out += '[^/]';
      i += 1;
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i += 1;
    }
  }
  return new RegExp(`^${out}$`);
}

/** Whether a root-relative path is `dir` or lies under it, a literal path
 *  prefix: an output name is never a pattern. */
function compileOutputDir(dir: string): (full: string, rel: string) => boolean {
  return (_full, rel) => {
    const normalized = rel.split('\\').join('/');
    return normalized === dir || normalized.startsWith(`${dir}/`);
  };
}

/**
 * A user list replaces only the replaceable defaults. A host's output
 * directories (`outputExclusion`) always apply, whatever the user's list.
 */
export function createExcludeMatcher(
  userPatterns?: readonly string[],
  outputDirs: readonly string[] = []
): ExcludeMatcher {
  const userList = userPatterns ?? REPLACEABLE_DEFAULT_EXCLUDE;
  const compiled: Array<{
    pattern: string;
    test: (full: string, rel: string) => boolean;
    isUser: boolean;
  }> = [];
  for (const pattern of STRUCTURAL_EXCLUDE) {
    compiled.push({
      pattern,
      test: compilePattern(pattern),
      isUser: userList.includes(pattern),
    });
  }
  for (const dir of outputDirs) {
    compiled.push({ pattern: dir, test: compileOutputDir(dir), isUser: false });
  }
  for (const pattern of userList) {
    if (STRUCTURAL_EXCLUDE.includes(pattern)) continue;
    compiled.push({ pattern, test: compilePattern(pattern), isUser: true });
  }
  const hits = new Map<string, number>(compiled.map((c) => [c.pattern, 0]));
  const explain = (full: string, rel: string): string | null => {
    let excludedBy: string | null = null;
    for (const { pattern, test, isUser } of compiled) {
      // Past the first match, only the user's patterns are still counted.
      if (excludedBy !== null && !isUser) continue;
      if (!test(full, rel)) continue;
      hits.set(pattern, (hits.get(pattern) ?? 0) + 1);
      excludedBy ??= pattern;
    }
    return excludedBy;
  };
  return {
    patterns: compiled.map((c) => c.pattern),
    matches: (full, rel) => explain(full, rel) !== null,
    explain,
    stats: () => hits,
    unmatched: () =>
      (userPatterns ?? []).filter(
        (pattern) =>
          hits.get(pattern) === 0 && !DEFAULT_EXCLUDE.includes(pattern)
      ),
  };
}

/**
 * A host's output directory as an exclusion: root-relative with `/`
 * separators, matched as a literal path prefix, so a user list, which
 * replaces the defaults, never re-admits output. Null when the directory is
 * outside the root or is the root itself.
 */
export function outputExclusion(root: string, outDir: string): string | null {
  if (!isPathWithinRoot(root, outDir)) return null;
  const rel = relative(root, outDir);
  return rel === '' ? null : rel.split(sep).join('/');
}

/**
 * The output directory a source file's real path lies in, or null. Applied
 * where a host assembles its analysis inputs: a file reached under another
 * spelling, through a source-tree link or a package's entry, is output too.
 */
export function outputSourceGuard(
  root: string,
  outputDirs: readonly string[]
): (absPath: string) => string | null {
  if (outputDirs.length === 0) return () => null;
  const realDirs = outputDirs.map((dir) => ({
    dir,
    real: realPathOf(resolve(root, dir)),
  }));
  return (absPath) => {
    const real = realPathOf(absPath);
    return realDirs.find((o) => isPathWithinRoot(o.real, real))?.dir ?? null;
  };
}

/** The warning for a source a host refused as output. */
export function outputSourceDiagnostic(
  relPath: string,
  outputDir: string
): ManifestDiagnostic {
  return hostFinding(
    OUTPUT_SOURCE,
    relPath,
    'discovery',
    `resolves into the output directory '${outputDir}', which is never source; it is not analysed`
  );
}

function realPathOf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** How a resolved value was decided; surfaced by `--print-config`. */
export type OptionProvenance = 'explicit' | 'driver-default' | 'default';

export interface ResolvedMode {
  mode: AnimusMode;
  provenance: OptionProvenance;
}

export function resolveMode(
  explicit: AnimusMode | undefined,
  driverDefault: () => AnimusMode
): ResolvedMode {
  if (explicit === 'development' || explicit === 'production') {
    return { mode: explicit, provenance: 'explicit' };
  }
  return { mode: driverDefault(), provenance: 'driver-default' };
}
