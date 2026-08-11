/**
 * Shared driver-config core (openspec: standalone-extraction-cli).
 *
 * One option schema, N drivers: the Vite plugin, the Next plugin, and the
 * standalone CLI all resolve their shared option core through this module so
 * key semantics, default exclusions, and the dev/prod mode authority cannot
 * drift per driver. Driver-specific options live in per-driver namespaces
 * (`vite:` / `next:` / `cli:`) or in the driver's own legacy top-level keys,
 * which the owning driver declares via `ownKeys`; any other unknown
 * top-level key is a hard error naming the key.
 */

import type { StaticCssConfig } from './static-css';

/** Closed set of driver namespaces a shared config file may carry. */
export const DRIVER_NAMESPACES = ['vite', 'next', 'cli'] as const;
export type DriverNamespace = (typeof DRIVER_NAMESPACES)[number];

/**
 * Structural exclusions applied unconditionally, whether or not the user
 * supplies an `exclude` list. `node_modules` is owned by the external-package
 * collection path (never the source walk), and `.next`/`.animus` are artifact
 * output directories inside the scanned root that must never be re-ingested
 * as source.
 */
export const STRUCTURAL_EXCLUDE = ['node_modules', '.next', '.animus'];

/**
 * Convenience defaults applied only when the user supplies no `exclude`
 * list — a user list replaces these (but never the structural set).
 */
export const REPLACEABLE_DEFAULT_EXCLUDE = ['dist', '.test.', '.spec.'];

/**
 * Default path patterns excluded from source discovery — the single
 * authoritative set for every driver when no user `exclude` is given.
 * Composed, never hand-listed: a structural addition must not silently
 * miss this union.
 */
export const DEFAULT_EXCLUDE = [
  ...STRUCTURAL_EXCLUDE,
  ...REPLACEABLE_DEFAULT_EXCLUDE,
];

/** Explicit dev/prod emission mode. When absent, each driver's documented
 *  default applies (Vite: `config.command`; Next: `NODE_ENV`; CLI:
 *  production). */
export type AnimusMode = 'development' | 'production';

/** The shared option core every driver accepts with identical semantics. */
export interface AnimusCoreOptions {
  /** Path to a module exporting a SystemInstance from `@animus-ui/system`. */
  system: string;
  /**
   * Exclusion patterns. When present, this list REPLACES the replaceable
   * defaults (`dist`, `.test.`, `.spec.`); the structural exclusions
   * (`node_modules`, `.next`, `.animus`) always apply and cannot be
   * re-admitted. Patterns containing `*` or `?` match as globs against the
   * root-relative path (`**` spans directories, `*` and `?` stay within one
   * segment; character classes and brace expansion are not supported); a
   * leading `./` is equivalent to the bare root-relative path; patterns
   * without glob metacharacters match as substrings of the full or
   * root-relative path.
   */
  exclude?: string[];
  /** File extensions to scan; replaces the default list entirely. */
  extensions?: string[];
  /** When true, extraction failures throw instead of warning. */
  strict?: boolean;
  /** Enable verbose logging. */
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
  /** Extraction engine selection; `'v2'` is the only engine. */
  engine?: 'v2';
  /**
   * Explicit dev/prod EMISSION mode — it decides emitted bytes (minify
   * default, dev-diagnostics define, engine devMode) and wins over every
   * environment-derived signal for those decisions. It never drives process
   * lifecycle (watchers, HMR ownership), which stays with each host's own
   * signal. When absent, the driver's documented default applies.
   */
  mode?: AnimusMode;
  /** Root every relative input resolves against. CLI-facing: the plugin
   *  drivers derive their root from the host bundler and REJECT this key
   *  (`assertKnownOptionKeys` rejectKeys). */
  root?: string;
}

/** Core keys accepted at the top level of any driver's options. */
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

/** Configuration errors carry a stable name so drivers can map them to
 *  their config-error surface (the CLI's exit code 2). */
export class AnimusConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnimusConfigError';
  }
}

/** How `assertKnownOptionKeys` surfaces unknown/rejected KEYS. Published
 *  plugin entry points use `'warn'` so a consumer upgrade cannot die at
 *  config load over a previously-inert extra key; new drivers (the CLI,
 *  the unplugin host) keep the `'throw'` default. Invalid VALUES (a bad
 *  `mode`) always throw — a silently flipped emission polarity is the
 *  exact failure this seam exists to kill, and `mode` is new surface with
 *  no inert-key history to stay compatible with. Warn mode REQUIRES the
 *  sink: a defaulted-away warning would be the silent failure again. */
export type AssertKnownOptionKeysOpts =
  | { onUnknownKey?: 'throw' }
  | { onUnknownKey: 'warn'; warn: (message: string) => void };

/**
 * Reject unknown top-level option keys and invalid core values. `ownKeys`
 * is the calling driver's legacy/driver-specific top-level surface (e.g.
 * Vite's `verify`, Next's `cssImportTarget`); driver namespaces are always
 * legal and inert for non-owning drivers. `rejectKeys` names core keys the
 * calling driver does NOT honor — accepting-and-ignoring a key the
 * validator vouches for is the exact silent failure this seam exists to
 * kill, so the driver must reject it with its reason (or, in `'warn'`
 * mode, name it loudly while the key stays inert as it always was).
 */
export function assertKnownOptionKeys(
  raw: Record<string, unknown>,
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
      (DRIVER_NAMESPACES as readonly string[]).includes(key) ||
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
  // Value validation for keys whose invalid values would silently flip
  // behavior instead of failing loud — always fatal, every driver.
  const mode = raw['mode'];
  if (mode !== undefined && mode !== 'development' && mode !== 'production') {
    throw new AnimusConfigError(
      `Invalid mode "${String(mode)}" — expected "development" or "production".`
    );
  }
  // Primitive shape gate for the remaining core keys — a wrongly-typed
  // value never behaves as written (the string "false" is truthy, a bare
  // string spread into a Set becomes CHARACTERS), so unlike unknown keys
  // these are fatal even in warn mode.
  for (const { key, ok, expected } of CORE_VALUE_GATES) {
    const value = raw[key];
    if (value === undefined || ok(value)) continue;
    throw new AnimusConfigError(
      `Invalid value for "${key}" — expected ${expected}, got ` +
        `${JSON.stringify(value)}.`
    );
  }
}

const isStringArray = (value: unknown): boolean =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

const CORE_VALUE_GATES: ReadonlyArray<{
  key: string;
  ok: (value: unknown) => boolean;
  expected: string;
}> = [
  { key: 'system', ok: (v) => typeof v === 'string', expected: 'a string path' },
  { key: 'exclude', ok: isStringArray, expected: 'an array of string patterns' },
  {
    key: 'extensions',
    ok: isStringArray,
    expected: 'an array of string extensions',
  },
  { key: 'strict', ok: (v) => typeof v === 'boolean', expected: 'a boolean' },
  { key: 'verbose', ok: (v) => typeof v === 'boolean', expected: 'a boolean' },
  { key: 'minify', ok: (v) => typeof v === 'boolean', expected: 'a boolean' },
  { key: 'prefix', ok: (v) => typeof v === 'string', expected: 'a string' },
  {
    key: 'targets',
    ok: (v) => typeof v === 'string' || isStringArray(v),
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

/** Predicate over discovery paths; also consumable by watch filtering. */
export interface ExcludeMatcher {
  /** Effective pattern list (structural ∪ (user ?? replaceable defaults)),
   *  for reporting surfaces. */
  readonly patterns: readonly string[];
  /** Per-pattern exclusion hit counts accumulated over this matcher's
   *  lifetime — the dead-pattern reporting surface (a user pattern with
   *  zero hits after discovery matched nothing). */
  stats(): ReadonlyMap<string, number>;
  /** True when the path should be excluded. Both forms are tested so
   *  absolute-substring compatibility is preserved. */
  matches(fullPath: string, relativePath: string): boolean;
  /** The first pattern excluding the path, or null — for diagnostics that
   *  name the responsible pattern. */
  explain(fullPath: string, relativePath: string): string | null;
}

const GLOB_META = /[*?]/;

/**
 * Compile one exclusion pattern. Glob patterns (containing `*` or `?`)
 * compile to a RegExp over the slash-normalized root-relative path — a
 * match on the path itself OR any ancestor directory excludes it, so a
 * directory-shaped glob (double-star slash "generated") excludes files
 * inside that directory identically for tree discovery (which prunes at
 * the directory) and per-file watch classification (which only ever sees
 * file paths).
 * Plain patterns keep the historical substring semantics over both path
 * forms.
 * A leading `./` is stripped first: relative paths are computed without
 * one, so `./fixtures/**` must mean exactly `fixtures/**` rather than
 * compiling to a regex that can never match.
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
        // `**/` or trailing `**`
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
 * Build the effective exclusion matcher. A user list REPLACES the
 * replaceable defaults (`dist`, `.test.`, `.spec.`) — the HEAD driver
 * contract (`options.exclude ?? DEFAULT_EXCLUDE`) — while the structural
 * exclusions (`node_modules`, `.next`, `.animus`) always apply: those
 * protect pipeline invariants, not preferences, so no user list can
 * re-admit them. `extraStructural` joins that never-replaceable set — the
 * channel for driver-owned invariants (a CLI outDir inside the root),
 * which must NOT ride the user list: appending there would flip the
 * replace semantics and silently drop the replaceable defaults.
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

/** How each resolved value was decided — the `--print-config` vocabulary. */
export type OptionProvenance = 'explicit' | 'driver-default' | 'default';

export interface ResolvedMode {
  mode: AnimusMode;
  provenance: OptionProvenance;
}

/**
 * Resolve the effective mode: the explicit `mode` key wins over every
 * environment-derived signal; otherwise the driver's documented default
 * applies.
 */
export function resolveMode(
  explicit: AnimusMode | undefined,
  driverDefault: () => AnimusMode
): ResolvedMode {
  if (explicit === 'development' || explicit === 'production') {
    return { mode: explicit, provenance: 'explicit' };
  }
  return { mode: driverDefault(), provenance: 'driver-default' };
}
