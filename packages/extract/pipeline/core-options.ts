/**
 * One option schema shared by the Vite, Next, and CLI drivers: key semantics,
 * default exclusions, and mode authority cannot drift per driver.
 */

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

export interface AnimusCoreOptions {
  /** Path to a module exporting a SystemInstance from `@animus-ui/system`. */
  system: string;
  /**
   * Replaces the replaceable defaults, never the structural ones. Patterns
   * with `*`/`?` are globs on the root-relative path; others are substrings.
   */
  exclude?: string[];
  /** File extensions to scan; replaces the default list entirely. */
  extensions?: string[];
  /** When true, extraction failures throw instead of warning. */
  strict?: boolean;
  verbose?: boolean;
  /** Namespace prefix for CSS variables and class names. */
  prefix?: string;
  /** Browser targets for CSS autoprefixing and syntax lowering. */
  targets?: string | string[];
  /** Minification control; `undefined` = minify in production mode only. */
  minify?: boolean;
  /** Forced-emission declarations for usage the scanner cannot observe. */
  staticCss?: StaticCssConfig;
  /** Full `@layer` declaration order. */
  layers?: string[];
  engine?: 'v2';
  /**
   * Decides emitted bytes (minify, dev diagnostics, engine devMode) and wins
   * over environment signals; never process lifecycle (watchers, HMR).
   */
  mode?: AnimusMode;
  /** Root every relative input resolves against. Plugin drivers derive their
   *  root from the host bundler and reject this key. */
  root?: string;
}

export const CORE_OPTION_KEYS: ReadonlySet<string> = new Set([
  'system',
  'exclude',
  'extensions',
  'strict',
  'verbose',
  'prefix',
  'targets',
  'minify',
  'staticCss',
  'layers',
  'engine',
  'mode',
  'root',
]);

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

type CoreOptionValue = string | boolean | readonly string[];

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

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every(isString);

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
  {
    key: 'exclude',
    ok: isStringArray,
    expected: 'an array of string patterns',
  },
  {
    key: 'extensions',
    ok: isStringArray,
    expected: 'an array of string extensions',
  },
  { key: 'strict', ok: isBoolean, expected: 'a boolean' },
  { key: 'verbose', ok: isBoolean, expected: 'a boolean' },
  { key: 'minify', ok: isBoolean, expected: 'a boolean' },
  { key: 'prefix', ok: isString, expected: 'a string' },
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
  /** Effective list: structural ∪ (user ?? replaceable defaults). */
  readonly patterns: readonly string[];
  /** Per-pattern hit counts over this matcher's lifetime; zero hits after
   *  discovery means the pattern matched nothing. */
  stats(): ReadonlyMap<string, number>;
  /** True when the path is excluded; both path forms are tested. */
  matches(fullPath: string, relativePath: string): boolean;
  explain(fullPath: string, relativePath: string): string | null;
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

/** Minimal glob → RegExp: `**` spans segments, `*`/`?` stay within one. */
function globToRegExp(glob: string): RegExp {
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

/**
 * A user list replaces only the replaceable defaults. Driver-owned
 * invariants belong in `extraStructural`; a user list would replace those.
 */
export function createExcludeMatcher(
  userPatterns?: readonly string[],
  extraStructural: readonly string[] = []
): ExcludeMatcher {
  const merged = [...STRUCTURAL_EXCLUDE];
  for (const pattern of extraStructural) {
    if (!merged.includes(pattern)) merged.push(pattern);
  }
  for (const pattern of userPatterns ?? REPLACEABLE_DEFAULT_EXCLUDE) {
    if (!merged.includes(pattern)) merged.push(pattern);
  }
  const compiled = merged.map(
    (pattern) => [pattern, compilePattern(pattern)] as const
  );
  const hits = new Map<string, number>(merged.map((p) => [p, 0]));
  const explain = (full: string, rel: string): string | null => {
    for (const [pattern, test] of compiled) {
      if (test(full, rel)) {
        hits.set(pattern, (hits.get(pattern) ?? 0) + 1);
        return pattern;
      }
    }
    return null;
  };
  return {
    patterns: merged,
    matches: (full, rel) => explain(full, rel) !== null,
    explain,
    stats: () => hits,
  };
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
