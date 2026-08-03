import {
  BrowserColorSchemeConfig,
  ColorModeOptions,
  ContextualVarRegistration,
  CSSColorValue,
  ModeAliasDefinition,
  SerializedTheme,
  SystemPreferenceConfig,
  ThemeCssFragment,
  ThemeManifest,
  TokenDefinition,
  TokenReference,
} from '../types/theme';
import { LiteralPaths } from './flattenScale';
import {
  dotToDash,
  flattenToDotPaths,
  isObject,
  merge,
  walkDotPath,
} from './utils';

const COLOR_FUNCTION_PREFIXES = [
  'rgb(',
  'rgba(',
  'hsl(',
  'hsla(',
  'oklch(',
  'oklab(',
  'lch(',
  'lab(',
  'color(',
  'color-mix(',
];

/** Validate that a value is a valid CSS <color>. */
function isValidCSSColor(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (v === '') return false;

  // Special keywords
  if (v === 'transparent' || v === 'currentColor' || v === 'currentcolor')
    return true;

  // Hex colors
  if (
    v.startsWith('#') &&
    /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)
  )
    return true;

  // CSS color functions
  for (const prefix of COLOR_FUNCTION_PREFIXES) {
    if (v.startsWith(prefix) && v.endsWith(')')) return true;
  }

  // Bare strings (named CSS colors, etc.) — let the browser validate
  if (/^[a-zA-Z]+$/.test(v)) return true;

  return false;
}

/**
 * Validate that mode aliases reference existing color keys via dot-path traversal.
 * Aliases are dot-path strings like 'gray.50' that must resolve in the nested color structure.
 */
function validateModeAliases(
  modeName: string,
  aliases: Record<string, unknown>,
  nestedColors: Record<string, unknown>,
  flatColorKeys: string[],
  prefix: string
): void {
  for (const [key, value] of Object.entries(aliases)) {
    const aliasPath = prefix ? `${prefix}.${key}` : key;
    if (key === '_') {
      // Identity key — validate the value, not the key
      if (typeof value === 'string') {
        if (walkDotPath(nestedColors, value) === undefined) {
          throw new Error(
            `addColorModes: mode '${modeName}' references unknown color '${value}' for alias '${prefix || key}'. ` +
              `Available colors: ${flatColorKeys.slice(0, 10).join(', ')}${flatColorKeys.length > 10 ? ', ...' : ''}`
          );
        }
      } else if (isObject(value)) {
        validateModeAliases(
          modeName,
          value as Record<string, unknown>,
          nestedColors,
          flatColorKeys,
          prefix
        );
      }
    } else if (typeof value === 'string') {
      if (walkDotPath(nestedColors, value) === undefined) {
        throw new Error(
          `addColorModes: mode '${modeName}' references unknown color '${value}' for alias '${aliasPath}'. ` +
            `Available colors: ${flatColorKeys.slice(0, 10).join(', ')}${flatColorKeys.length > 10 ? ', ...' : ''}`
        );
      }
    } else if (isObject(value)) {
      validateModeAliases(
        modeName,
        value as Record<string, unknown>,
        nestedColors,
        flatColorKeys,
        aliasPath
      );
    }
  }
}

/**
 * Reserved mode name (D4). "System" is modeled as the ABSENCE of
 * `data-color-mode`, never as a mode: an attribute value `system` would defeat
 * the `:root:not([data-color-mode])` guard while matching no mode block.
 */
const RESERVED_MODE_NAME = 'system';

/**
 * Theme keys owned by the color-mode options. A scale may not claim them —
 * they are skipped by `flattenTheme` and read back as option objects in
 * `build()`, so a same-named scale would emit zero tokens AND fabricate a
 * manifest field from its values.
 *
 * NOTE: the pre-existing `mode` / `modes` / `breakpoints` structural keys have
 * the same hole and are deliberately NOT covered here (out of scope).
 */
const RESERVED_THEME_KEYS = new Set(['systemPreference', 'browserColorScheme']);

const COLOR_SCHEME_VALUES = new Set(['light', 'dark', 'normal']);

/**
 * The axis → scheme pairs the mapping forces: the mode named for the OS light
 * preference must classify `light`, the dark one `dark`. Single source for
 * BOTH the default fill and the conflict check in
 * {@link resolveColorModeOptions} — one rule, one table.
 */
const MAPPING_FORCED_SCHEMES = [
  ['light', 'light'],
  ['dark', 'dark'],
] as const;

/**
 * Merge an incoming option object over the one already on the theme, mirroring
 * `merge`'s per-key override. Returns `undefined` when neither side supplied
 * one, so an unconfigured theme never gains the key (byte parity, G4).
 */
function mergeOptionObject<T>(
  existing: unknown,
  incoming: unknown
): T | undefined {
  const hasExisting = isObject(existing);
  const hasIncoming = isObject(incoming);
  if (!hasExisting && !hasIncoming) return undefined;
  return {
    ...(hasExisting ? (existing as Record<string, unknown>) : {}),
    ...(hasIncoming ? (incoming as Record<string, unknown>) : {}),
  } as unknown as T;
}

/** Reject the reserved mode name (D4) wherever a mode set is declared or merged. */
function validateReservedModeNames(modeNames: string[]): void {
  for (const modeName of modeNames) {
    if (modeName === RESERVED_MODE_NAME) {
      throw new Error(
        `addColorModes: '${RESERVED_MODE_NAME}' is a reserved mode name — the system preference is represented by the absence of the data-color-mode attribute, never by a declared mode. Rename it. Declared modes: ${modeNames.join(', ')}`
      );
    }
  }
}

/**
 * Normalize AND validate the optional system-participation options against the
 * declared modes, returning the normalized classification. One entry point on
 * purpose: the D3-amendment fill (mapping-named modes default to their forced
 * schemes) must always run before totality is checked, so exposing fill and
 * validation separately would make "validate an unfilled map" representable.
 * An explicit entry survives the fill's spread and is still conflict-checked,
 * so a wrong value errors rather than being silently corrected. `undefined`
 * passes through untouched — the classification stays opt-in, and a theme with
 * only `systemPreference` emits no `color-scheme` (byte parity, G4).
 *
 * ALWAYS called with MERGED state — `theme.modes` unions across `addColorModes`
 * calls and `from()` composition, so a per-call view both misses invalidation
 * (a later mode declaration un-totals a carried classification) and invents
 * false rejections (a mapping naming a mode declared by an earlier call).
 * Run at both gates: `addColorModes` (fail fast) and `build()` (authoritative —
 * `from()` composition never passes through `addColorModes`; only build()'s
 * resolved map feeds emission and the manifest).
 *
 * Error tone mirrors `validateModeAliases`: `addColorModes:` prefix plus the
 * available names.
 */
function resolveColorModeOptions(
  modeNames: string[],
  systemPreference: SystemPreferenceConfig | undefined,
  suppliedBrowserColorScheme: BrowserColorSchemeConfig | undefined
): BrowserColorSchemeConfig | undefined {
  let browserColorScheme = suppliedBrowserColorScheme;
  if (browserColorScheme && systemPreference) {
    const forced: BrowserColorSchemeConfig = {};
    for (const [axis, scheme] of MAPPING_FORCED_SCHEMES) {
      const modeName = systemPreference[axis];
      if (typeof modeName === 'string') forced[modeName] = scheme;
    }
    browserColorScheme = { ...forced, ...suppliedBrowserColorScheme };
  }
  const available = `Available modes: ${modeNames.join(', ')}`;
  const declared = new Set(modeNames);

  if (systemPreference) {
    for (const axis of ['light', 'dark'] as const) {
      const modeName = systemPreference[axis];
      if (typeof modeName !== 'string' || modeName === '') {
        throw new Error(
          `addColorModes: systemPreference requires both 'light' and 'dark' to name a declared mode — '${axis}' is missing. ${available}`
        );
      }
      if (modeName === RESERVED_MODE_NAME) {
        throw new Error(
          `addColorModes: '${RESERVED_MODE_NAME}' is reserved and cannot be used as systemPreference.${axis} — the system preference is represented by the absence of the data-color-mode attribute. ${available}`
        );
      }
      if (!declared.has(modeName)) {
        throw new Error(
          `addColorModes: systemPreference.${axis} references unknown mode '${modeName}'. ${available}`
        );
      }
    }
  }

  if (!browserColorScheme) return browserColorScheme;

  for (const [modeName, value] of Object.entries(browserColorScheme)) {
    if (!declared.has(modeName)) {
      throw new Error(
        `addColorModes: browserColorScheme references unknown mode '${modeName}'. ${available}`
      );
    }
    if (!COLOR_SCHEME_VALUES.has(value)) {
      throw new Error(
        `addColorModes: browserColorScheme['${modeName}'] must be 'light', 'dark', or 'normal', got ${JSON.stringify(value)}.`
      );
    }
  }

  // Totality — a partial map lets an explicit mode inherit the previous mode's
  // browser-native scheme (D3).
  for (const modeName of modeNames) {
    if (!(modeName in browserColorScheme)) {
      throw new Error(
        `addColorModes: browserColorScheme must classify every declared mode — mode '${modeName}' is unclassified. ${available}`
      );
    }
  }

  if (!systemPreference) return browserColorScheme;

  for (const [axis, expected] of MAPPING_FORCED_SCHEMES) {
    const modeName = systemPreference[axis];
    const classification = browserColorScheme[modeName];
    if (classification !== expected) {
      throw new Error(
        `addColorModes: browserColorScheme conflicts with systemPreference — mode '${modeName}' is mapped to the OS ${axis} preference but classified '${classification}'; expected '${expected}'.`
      );
    }
  }

  return browserColorScheme;
}

/** Validate all color entries, throwing on invalid values. */
function validateColors(colors: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(colors)) {
    if (isObject(value)) {
      // Nested color objects — validate recursively
      validateColors(value as Record<string, unknown>);
    } else if (!isValidCSSColor(value)) {
      throw new Error(
        `addColors: '${String(value)}' is not a valid CSS <color> value for key '${key}'. ` +
          `Expected hex (#fff), rgb(), hsl(), oklch(), named color, transparent, or currentColor.`
      );
    }
  }
}

// Token ref validation types (ValidateScaleRef, ValidateScaleValues) removed
// to prevent TS2589 depth explosion. Token refs are validated at runtime in
// resolveTokenRefs() during build(). Type-level validation can be restored
// when the type-state chain depth is optimized.

// ─── Type Helpers ───────────────────────────────────────────

/** Flatten a type to prevent MergeTheme depth accumulation (TS2589). Exported for use in consumer themes. */
export type Flatten<T> = { [K in keyof T]: T[K] };

/**
 * The union of contextual var NAMES declared across all scales in a
 * `declareContextualVars` config. Read only for the optional registration
 * parameter's key constraint — it derives FROM the already-inferred `Vars`, so
 * it can never feed back into `Vars` inference or perturb literal-key narrowing.
 */
type ContextualVarNames<Vars> = {
  [K in keyof Vars]: Vars[K] extends readonly (infer N extends string)[]
    ? N
    : never;
}[keyof Vars];

/** The built theme: nested raw data + non-enumerable boundary methods */
type BuiltTheme<T, Emitted extends string> = {
  [K in keyof T]: T[K];
} & {
  /** Phantom — tuple wrapper prevents never-distribution. Non-enumerable at runtime. */
  readonly __emitted: [Emitted];
  manifest: ThemeManifest;
  serialize(): SerializedTheme;
  /** Resolve a dot-path token to its var() reference. Runtime-validated against the manifest. */
  varRef(tokenPath: string): string | undefined;
};

// ─── ThemeBuilder: Progressive Disclosure ───────────────────
//
// Separate classes per phase, each with new TYPE INSTANTIATION.
// This forces TS to cache the concrete type at each step, preventing
// TS2589 depth accumulation on long chains. Same pattern as Animus.ts.

/**
 * Manifest-v2 fields carried through `from()`'s explicit manifest read (the
 * manifest is non-enumerable, so the ordinary key-copy loop never sees it).
 * A read-only carrier for the D8 copy-on-write substrate: in this manifest
 * version `build()` still REGENERATES every fragment from the authored data
 * (zero-delta contract — carried fragments never become the source of
 * `variableCss` here); later increments consult it for per-section
 * pass-through.
 */
interface CarriedManifestV2 {
  tokenDefinitions?: Record<string, TokenDefinition>;
  modeAliasDefinitions?: ModeAliasDefinition;
  registrations?: Record<string, ContextualVarRegistration>;
  emitterVersion?: number;
  contractHash?: string;
  cssFragments?: ThemeCssFragment[];
}

/** Shared runtime state passed between builder phases. */
interface BuilderState {
  theme: Record<string, unknown>;
  emittedScales: Set<string>;
  contextualVars: Map<string, string[]>;
  /**
   * `@property` registration metadata keyed by contextual var NAME (not the
   * `--` custom property). Opt-in — empty unless a declaration supplies it.
   * Kept separate from `contextualVars` so the names-only registry the Rust
   * extractor consumes (`contextualVarsJson`) never changes shape.
   */
  contextualVarRegistrations: Map<string, ContextualVarRegistration>;
  /** See {@link CarriedManifestV2}. Present only after a v2-manifest from(). */
  carriedManifestV2?: CarriedManifestV2;
  /**
   * Set when a `from()` source carried a manifest WITHOUT the v2 discriminant.
   * The authored graph behind that data is unknowable, so `build()` suppresses
   * ALL v2 manifest fields rather than fabricating them from resolved values
   * (D8) — the composed theme stays v1-shaped and increment 03's targeted
   * `createThemeVariants` rejection keys off exactly that absence.
   */
  hasLegacyManifestSource: boolean;
}

function createState(theme?: Record<string, unknown>): BuilderState {
  return {
    theme: theme || { breakpoints: {} },
    emittedScales: new Set(),
    contextualVars: new Map(),
    contextualVarRegistrations: new Map(),
    hasLegacyManifestSource: false,
  };
}

function copyState(
  state: BuilderState,
  nextTheme: Record<string, unknown>
): BuilderState {
  const next: BuilderState = {
    theme: nextTheme,
    emittedScales: new Set(state.emittedScales),
    contextualVars: new Map(),
    contextualVarRegistrations: new Map(state.contextualVarRegistrations),
    // Read-only carrier: shallow-copy the wrapper and share the inner records,
    // exactly as contextualVarRegistrations shares its entry objects above.
    ...(state.carriedManifestV2
      ? { carriedManifestV2: { ...state.carriedManifestV2 } }
      : {}),
    hasLegacyManifestSource: state.hasLegacyManifestSource,
  };
  for (const [scale, vars] of state.contextualVars) {
    next.contextualVars.set(scale, [...vars]);
  }
  return next;
}

/**
 * ThemeScales — the final phase. Has addScale, extendScale, declareContextualVars, build.
 * Also allows addColors and addColorModes for augmentation.
 */
export class ThemeBuilder<
  T extends Record<string, unknown> = Record<string, unknown>,
  Emitted extends string = never,
> {
  /** @internal */ _state: BuilderState;

  constructor(state: BuilderState) {
    this._state = state;
  }

  addBreakpoints<BP extends Record<string, number>>(breakpoints: BP) {
    for (const [key, value] of Object.entries(breakpoints)) {
      if (typeof value !== 'number' || value < 0) {
        throw new Error(
          `addBreakpoints: breakpoint '${key}' must be a non-negative number, got ${JSON.stringify(value)}`
        );
      }
    }
    const nextTheme = merge({}, this._state.theme, { breakpoints });
    // Omit<T, 'breakpoints'> replaces the Record<string, number> from EmptyTheme
    // with literal keys, preventing index signature from widening keyof breakpoints to string
    type Merged = Omit<T, 'breakpoints'> &
      Record<'breakpoints', { [K in keyof BP]: BP[K] }>;
    type Next = { [K in keyof Merged]: Merged[K] };
    return new ThemeBuilder<Next, Emitted>(copyState(this._state, nextTheme));
  }

  // CLOSED DROP (was DEF-6, openspec change modern-css-surface; closed by
  // multi-theme-support increment 01 under D9): @property registration
  // metadata now SURVIVES from() — manifest v2 carries `registrations`, and
  // the explicit manifest read below re-seeds `contextualVarRegistrations`
  // from them. Residual, by design (D8): a source carrying only a v1
  // (names-only) manifest still composes without registration metadata —
  // v1 round-trips unchanged and gains no fabricated v2 fields.
  from<Source extends Record<string, unknown>>(builtTheme: Source) {
    const raw: Record<string, unknown> = {};
    for (const key of Object.keys(builtTheme)) {
      const val = builtTheme[key];
      if (typeof val !== 'function') {
        raw[key] = val;
      }
    }
    const nextTheme = merge({}, this._state.theme, raw);
    const next = new ThemeBuilder<T & Source, Emitted>(
      copyState(this._state, nextTheme)
    );

    const manifest = (builtTheme as Record<string, unknown>).manifest as
      | ThemeManifest
      | undefined;
    if (manifest?.variableMap) {
      for (const tokenPath of Object.keys(manifest.variableMap)) {
        const scale = tokenPath.split('.')[0];
        next._state.emittedScales.add(scale === 'colors' ? 'colors' : scale);
      }
    }
    if (manifest?.contextualVars) {
      for (const [scale, vars] of Object.entries(manifest.contextualVars)) {
        next._state.contextualVars.set(scale, [...vars]);
      }
    }
    // Manifest v2 carry (D6/D8) — through THIS explicit read only: the
    // manifest is non-enumerable, so the key-copy loop above never sees it.
    if (manifest) {
      if (manifest.manifestVersion === 2) {
        next._state.carriedManifestV2 = {
          tokenDefinitions: manifest.tokenDefinitions,
          modeAliasDefinitions: manifest.modeAliasDefinitions,
          registrations: manifest.registrations,
          emitterVersion: manifest.emitterVersion,
          contractHash: manifest.contractHash,
          cssFragments: manifest.cssFragments,
        };
        // Re-seed the registration metadata the CLOSED DROP note above
        // records: carried registrations become live builder state again, so
        // an unmutated rebuild re-emits identical @property rules.
        if (manifest.registrations) {
          for (const [name, registration] of Object.entries(
            manifest.registrations
          )) {
            next._state.contextualVarRegistrations.set(name, registration);
          }
        }
      } else {
        // v1 manifest: authored structure unknowable — fail closed (D8).
        next._state.hasLegacyManifestSource = true;
      }
    }
    return next;
  }

  addColors<
    Colors extends Record<
      string,
      CSSColorValue | Record<string, CSSColorValue>
    >,
    // Generic default forces TS to resolve LiteralPaths ONCE and bind the result.
    // Downstream methods see NextColors (a flat Record) — no re-derivation.
    NextColors extends LiteralPaths<Colors, '.'> = LiteralPaths<Colors, '.'>,
  >(colors: Colors) {
    validateColors(colors as Record<string, unknown>);
    const nextTheme = merge({}, this._state.theme, { colors });
    // NextColors is RESOLVED — a flat Record<'gray.50', '#fafafa'>.
    // The flatten pattern commits the intersection to a concrete shape.
    type Merged = T & Record<'colors', NextColors>;
    type Next = { [K in keyof Merged]: Merged[K] };
    const next = new ThemeBuilder<Next, Emitted | 'colors'>(
      copyState(this._state, nextTheme)
    );
    next._state.emittedScales.add('colors');
    return next;
  }

  addColorModes<
    Config extends Record<string, Record<string, unknown>>,
    // Generic default forces ONE eval of mode alias paths (union across all modes).
    // The '_' base param collapses identity keys: { _: 'x', hover: 'y' } → 'primary' | 'primary.hover'
    AliasKeys extends LiteralPaths<Config[keyof Config], '.', '_'> =
      LiteralPaths<Config[keyof Config], '.', '_'>,
  >(
    initialMode: string,
    modeConfig: Config,
    options?: ColorModeOptions<Config>
  ) {
    const nestedColors = (this._state.theme.colors || {}) as Record<
      string,
      unknown
    >;
    const flatColors = flattenToDotPaths(nestedColors);
    const flatColorKeys = Object.keys(flatColors);
    // MERGED mode set — `merge` unions `theme.modes` across calls, so modes
    // declared by an earlier `addColorModes` or carried by `from()` are legal
    // targets for this call's options.
    const existingModes = isObject(this._state.theme.modes)
      ? (this._state.theme.modes as Record<string, unknown>)
      : {};
    const modeNames = Object.keys({ ...existingModes, ...modeConfig });

    // Reserved-name check runs with OR without options (D4).
    validateReservedModeNames(modeNames);

    for (const [modeName, modeAliases] of Object.entries(modeConfig)) {
      validateModeAliases(
        modeName,
        modeAliases as Record<string, unknown>,
        nestedColors,
        flatColorKeys,
        ''
      );
    }

    // Merge this call's options over any carried by `from()` / an earlier call
    // exactly the way `merge` will, then resolve (fill + validate) the RESULT.
    // Only the fail-fast claim is wanted here: what gets STORED is the raw
    // merged map, so builder state keeps recording what the caller wrote and a
    // later `systemPreference` remap can't inherit stale synthesized entries.
    // build() resolves again and its total map is what feeds the manifest.
    const systemPreference = mergeOptionObject<SystemPreferenceConfig>(
      this._state.theme.systemPreference,
      options?.systemPreference
    );
    const browserColorScheme = mergeOptionObject<BrowserColorSchemeConfig>(
      this._state.theme.browserColorScheme,
      options?.browserColorScheme
    );
    resolveColorModeOptions(modeNames, systemPreference, browserColorScheme);

    const nextTheme = merge({}, this._state.theme, {
      modes: modeConfig,
      mode: initialMode,
      // Only stored when supplied — an unconfigured theme keeps exactly its
      // current enumerable key set (byte-parity precondition, G4).
      ...(systemPreference ? { systemPreference } : {}),
      ...(browserColorScheme ? { browserColorScheme } : {}),
    });

    // Colors type = existing palette keys + mode alias keys (superset)
    // AliasKeys is RESOLVED — a flat Record of alias dot-paths.
    type ColorsWithModes = (T extends { colors: infer C } ? C : unknown) &
      AliasKeys;
    type Merged = Omit<T, 'colors'> & Record<'colors', ColorsWithModes>;
    type Next = { [K in keyof Merged]: Merged[K] };
    return new ThemeBuilder<Next, Emitted>(copyState(this._state, nextTheme));
  }

  addScale<
    Key extends string,
    Values extends Record<
      string | number,
      string | number | Record<string, string | number>
    >,
    Emit extends boolean = false,
    // Generic default forces TS to resolve LiteralPaths ONCE and bind the result.
    NewScale extends LiteralPaths<Values, '.'> = LiteralPaths<Values, '.'>,
  >(config: { name: Key; values: Values; emit?: Emit }) {
    const { name, values, emit } = config;
    if (RESERVED_THEME_KEYS.has(name)) {
      throw new Error(
        `addScale: '${name}' is a reserved theme key owned by addColorModes options — it is skipped by the token flatten pass and read back as an option object, so a scale by this name would emit no tokens. Choose another scale name.`
      );
    }
    const nextTheme = merge({}, this._state.theme, { [name]: values });
    // NewScale is RESOLVED — a flat Record. Downstream sees concrete keys.
    type NextEmitted = Emit extends true ? Emitted | Key : Emitted;
    type Merged = T & Record<Key, NewScale>;
    type Next = { [K in keyof Merged]: Merged[K] };
    const next = new ThemeBuilder<Next, NextEmitted>(
      copyState(this._state, nextTheme)
    );
    if (emit) next._state.emittedScales.add(name);
    return next;
  }

  declareContextualVars<
    const Vars extends Partial<{
      [K in keyof T & string]: readonly string[];
    }>,
  >(
    vars: Vars,
    // Optional `@property` registration metadata keyed by declared var name.
    // A SEPARATE parameter (not folded into `vars`) so the literal-key
    // narrowing of `Vars` above is byte-identical whether or not it is passed —
    // the phantom typing of the declared var names is untouched by metadata.
    registrations?: Partial<
      Record<ContextualVarNames<Vars>, ContextualVarRegistration>
    >
  ) {
    for (const scale of Object.keys(vars)) {
      if (!(scale in this._state.theme)) {
        throw new Error(
          `declareContextualVars: scale '${scale}' not found — call addColors or addScale first`
        );
      }
    }

    // Phantom type merge — keys exist in the type but not in the runtime theme object.
    type WithPhantoms = {
      [K in keyof T]: K extends keyof Vars
        ? Vars[K] extends readonly string[]
          ? T[K] & Record<Vars[K][number], `var(--${string})`>
          : T[K]
        : T[K];
    };

    const next = new ThemeBuilder<WithPhantoms, Emitted>(
      copyState(this._state, this._state.theme)
    );
    for (const [scale, names] of Object.entries(vars)) {
      const existing = next._state.contextualVars.get(scale) || [];
      next._state.contextualVars.set(scale, [
        ...existing,
        ...(names as readonly string[]),
      ]);
    }
    if (registrations) {
      for (const [name, registration] of Object.entries(registrations)) {
        if (registration) {
          next._state.contextualVarRegistrations.set(
            name,
            registration as ContextualVarRegistration
          );
        }
      }
    }
    return next;
  }

  extendScale<
    Key extends keyof T,
    Fn extends (tokens: T[Key]) => Record<string | number, unknown>,
  >(key: Key, updateFn: Fn) {
    const nextTheme = merge({}, this._state.theme, {
      [key]: updateFn(this._state.theme[key as string] as T[Key]),
    });
    // Flatten the intersection to prevent depth accumulation
    type Extended = T & Record<Key, T[Key] & ReturnType<Fn>>;
    type Next = { [K in keyof Extended]: Extended[K] };
    return new ThemeBuilder<Next, Emitted>(copyState(this._state, nextTheme));
  }

  /**
   * Finalize the theme build.
   * Flattens nested data at the boundary — produces manifest and serialize().
   */
  build(): BuiltTheme<T, Emitted> {
    const theme = merge({}, this._state.theme) as Record<string, unknown>;
    const emittedScales = this._state.emittedScales;
    const contextualVars = this._state.contextualVars;

    // ── Merged-state option resolution ─────────────────────
    // Authoritative gate: `from()` composition merges modes AND options without
    // passing through `addColorModes`, and a later mode declaration can
    // invalidate a previously-valid pair (an un-totalled classification). Both
    // option objects survive `from()` as ordinary enumerable theme keys. The
    // RESOLVED (mapping-filled) classification produced here is what feeds
    // emission and the manifest — builder state keeps the raw authored map.
    const systemPreference = isObject(theme.systemPreference)
      ? (theme.systemPreference as unknown as SystemPreferenceConfig)
      : undefined;
    const mergedModeNames = isObject(theme.modes)
      ? Object.keys(theme.modes as Record<string, unknown>)
      : [];
    validateReservedModeNames(mergedModeNames);
    const browserColorScheme = resolveColorModeOptions(
      mergedModeNames,
      systemPreference,
      isObject(theme.browserColorScheme)
        ? (theme.browserColorScheme as unknown as BrowserColorSchemeConfig)
        : undefined
    );

    // ── Build-time flatten pass ────────────────────────────
    const {
      tokenMap,
      variableMap,
      variables,
      modeVariables,
      modeTokens,
      tokenDefinitions,
      modeAliasDefinitions,
    } = flattenTheme(theme, emittedScales);

    // Resolve token refs in the flattened token map
    resolveTokenRefs(tokenMap, variableMap, emittedScales);

    // Serialize breakpoints
    const bpVariables: Record<string, string> = {};
    if (theme.breakpoints && isObject(theme.breakpoints)) {
      for (const [key, value] of Object.entries(
        theme.breakpoints as Record<string, number>
      )) {
        bpVariables[`--breakpoint-${key}`] = `${value}px`;
      }
    }

    // Contextual vars
    let contextualVarsSerialized: Record<string, string[]> | undefined;
    if (contextualVars.size > 0) {
      contextualVarsSerialized = {};
      for (const [scale, vars] of contextualVars) {
        contextualVarsSerialized[scale] = vars;
      }
    }

    // ── Assemble manifest ──────────────────────────────────
    // `@property` registration rules ride at the head of the variables part —
    // they are custom-property-owned and unlayered, so they land before the
    // `@layer` declaration via the existing pre-`@layer` variable emission with
    // no assembly change. Opt-in: absent metadata ⇒ empty string ⇒ the variable
    // CSS is byte-identical to a theme that never registered anything.
    const propertyCss = buildPropertyRegistrationCss(
      contextualVars,
      this._state.contextualVarRegistrations
    );
    const baseVariableCss = buildVariableCss(
      variables,
      bpVariables,
      modeVariables,
      {
        initialMode: typeof theme.mode === 'string' ? theme.mode : undefined,
        systemPreference,
        browserColorScheme,
      }
    );
    const variableCss = propertyCss
      ? baseVariableCss
        ? `${propertyCss}\n\n${baseVariableCss}`
        : propertyCss
      : baseVariableCss;

    // ── Manifest v2 fields (D6) ────────────────────────────
    // Metadata only. `cssFragments` RECORDS the strings composed above —
    // `variableCss` is still composed exactly as before (zero-delta, G1); the
    // fragment→variableCss projection becomes load-bearing with the CSS wire
    // plan (a later increment). Suppressed ENTIRELY when a from() source
    // carried a legacy v1 manifest: its authored graph is unknowable, and v2
    // fields must never be fabricated from resolved values (D8).
    let manifestV2Fields: Partial<ThemeManifest> = {};
    if (!this._state.hasLegacyManifestSource) {
      const registrations = Object.fromEntries(
        this._state.contextualVarRegistrations
      );
      const cssFragments: ThemeCssFragment[] = [];
      if (propertyCss) {
        cssFragments.push({
          id: 'registrations',
          kind: 'registrations',
          cssText: propertyCss,
        });
      }
      if (baseVariableCss) {
        cssFragments.push({
          id: 'base',
          kind: 'base',
          cssText: baseVariableCss,
        });
      }
      manifestV2Fields = {
        manifestVersion: 2,
        tokenDefinitions,
        modeAliasDefinitions,
        registrations,
        emitterVersion: EMITTER_VERSION,
        contractHash: computeContractHash({
          tokenDefinitions,
          modeAliasDefinitions,
          initialMode: typeof theme.mode === 'string' ? theme.mode : undefined,
          registrations,
          systemPreference,
          browserColorScheme,
        }),
        cssFragments,
      };
    }

    const manifest: ThemeManifest = {
      tokenMap: {
        ...tokenMap,
        // Include breakpoints in tokenMap for Rust crate compatibility
        ...Object.fromEntries(
          Object.entries(theme.breakpoints || {}).map(([k, v]) => [
            `breakpoints.${k}`,
            String(v),
          ])
        ),
      },
      variableMap,
      modes: modeTokens,
      variableCss,
      ...(contextualVarsSerialized
        ? { contextualVars: contextualVarsSerialized }
        : {}),
      // Additive optional fields (D7) — the serialize() wire is unchanged.
      ...(systemPreference ? { systemPreference } : {}),
      ...(browserColorScheme ? { browserColorScheme } : {}),
      // Manifest v2 (D6) — additive, absent on legacy-composed builds; the
      // serialize() wire stays EXACTLY four keys (the plan key is a later
      // increment's change).
      ...manifestV2Fields,
    };

    // ── Attach non-enumerable methods ──────────────────────
    Object.defineProperty(theme, 'manifest', {
      value: manifest,
      enumerable: false,
      configurable: false,
      writable: false,
    });

    Object.defineProperty(theme, 'serialize', {
      value: (): SerializedTheme => ({
        scalesJson: JSON.stringify(manifest.tokenMap),
        variableMapJson: JSON.stringify(manifest.variableMap),
        variableCss: manifest.variableCss,
        contextualVarsJson: JSON.stringify(manifest.contextualVars ?? {}),
      }),
      enumerable: false,
      configurable: false,
      writable: false,
    });

    Object.defineProperty(theme, 'varRef', {
      value: (tokenPath: string): string | undefined => {
        const varName = variableMap[tokenPath];
        if (varName) return `var(${varName})`;
        // Non-emitted scale: return raw value from nested theme
        const dotIdx = tokenPath.indexOf('.');
        if (dotIdx === -1) return undefined;
        const scale = tokenPath.slice(0, dotIdx);
        const key = tokenPath.slice(dotIdx + 1);
        const scaleObj = theme[scale];
        if (!isObject(scaleObj)) return undefined;
        const val = walkDotPath(scaleObj as Record<string, unknown>, key);
        return val !== undefined ? String(val) : undefined;
      },
      enumerable: false,
      configurable: false,
      writable: false,
    });

    return theme as BuiltTheme<T, Emitted>;
  }
}

type EmptyTheme = { breakpoints: Record<string, number> };

export function createTheme() {
  return new ThemeBuilder<EmptyTheme>(createState());
}

// ─── Build-Time Flatten Pass ──────────────────────────────

/** Token ref pattern: {scale.key} or {scale.key.sub} */
const TOKEN_REF_RE = /\{([^}]+)\}/g;

/**
 * Flatten the nested theme into dot-path keyed token map and CSS variable declarations.
 * This is the ONLY place where flattening happens.
 */
function flattenTheme(
  theme: Record<string, unknown>,
  emittedScales: Set<string>
): {
  tokenMap: Record<string, string>;
  variableMap: Record<string, string>;
  variables: Record<string, string>;
  modeVariables: Record<string, Record<string, string>>;
  modeTokens: Record<string, Record<string, string>>;
  tokenDefinitions: Record<string, TokenDefinition>;
  modeAliasDefinitions: ModeAliasDefinition;
} {
  const tokenMap: Record<string, string> = {};
  const variableMap: Record<string, string> = {};
  const variables: Record<string, string> = {};
  const modeVariables: Record<string, Record<string, string>> = {};
  const modeTokens: Record<string, Record<string, string>> = {};
  // Manifest v2 (D6): the authored graph, captured HERE — before
  // resolveTokenRefs mutates tokenMap and before the mode-alias pass discards
  // its colorRef strings. Inference from resolved CSS is unsound (D8).
  const tokenDefinitions: Record<string, TokenDefinition> = {};
  const modeAliasDefinitions: ModeAliasDefinition = {};

  // Flatten scales and colors
  for (const [scaleName, scaleValue] of Object.entries(theme)) {
    if (scaleName.startsWith('_')) continue;
    if (
      scaleName === 'breakpoints' ||
      scaleName === 'mode' ||
      scaleName === 'modes' ||
      // Emission options are structural, not token scales — flattening them
      // would mint phantom `systemPreference.light` tokens.
      scaleName === 'systemPreference' ||
      scaleName === 'browserColorScheme'
    )
      continue;
    if (typeof scaleValue === 'function') continue;
    if (!isObject(scaleValue)) continue;

    const flat = flattenToDotPaths(scaleValue as Record<string, unknown>);
    const isEmitted = emittedScales.has(scaleName);

    for (const [dotKey, rawValue] of Object.entries(flat)) {
      const tokenPath = `${scaleName}.${dotKey}`;
      const dashKey = dotToDash(dotKey);
      const varName = `--${scaleName === 'colors' ? 'color' : scaleName}-${dashKey}`;

      // Authored form (literal vs {scale.key} reference) — from the RAW value.
      tokenDefinitions[tokenPath] = parseTokenDefinition(String(rawValue));

      if (isEmitted) {
        tokenMap[tokenPath] = `var(${varName})`;
        variableMap[tokenPath] = varName;
        variables[varName] = String(rawValue);
      } else {
        tokenMap[tokenPath] = String(rawValue);
      }
    }
  }

  // Flatten color modes
  if (
    theme.modes &&
    isObject(theme.modes) &&
    theme.colors &&
    isObject(theme.colors)
  ) {
    const flatColors = flattenToDotPaths(
      theme.colors as Record<string, unknown>
    );

    for (const [modeName, modeAliases] of Object.entries(
      theme.modes as Record<string, unknown>
    )) {
      if (!isObject(modeAliases)) continue;
      const flatAliases = flattenToDotPaths(
        modeAliases as Record<string, unknown>
      );
      const modeVars: Record<string, string> = {};
      const modeVals: Record<string, string> = {};
      const modeAliasDefs: Record<string, string> = {};

      for (const [aliasDotKey, colorRef] of Object.entries(flatAliases)) {
        if (typeof colorRef !== 'string') continue;
        const dashAlias = dotToDash(aliasDotKey);
        const varName = `--color-${dashAlias}`;

        // Manifest v2 (D6): record the AUTHORED colorRef dot-path — the
        // resolution below is exactly where it used to be discarded.
        modeAliasDefs[aliasDotKey] = colorRef;

        // Resolve color ref to raw value via dot-path
        const rawValue = flatColors[colorRef as string];
        modeVals[`colors.${aliasDotKey}`] =
          rawValue !== undefined ? String(rawValue) : String(colorRef);
        modeVars[varName] =
          rawValue !== undefined ? String(rawValue) : String(colorRef);
      }

      modeVariables[modeName] = modeVars;
      modeTokens[modeName] = modeVals;
      modeAliasDefinitions[modeName] = modeAliasDefs;
    }

    // Merge initial mode's semantic aliases into the main variables and tokenMap
    const initialMode = theme.mode as string;
    if (initialMode && modeVariables[initialMode]) {
      const initialModeVars: Record<string, string> = {};
      const flatInitialAliases = flattenToDotPaths(
        (theme.modes as Record<string, unknown>)[initialMode] as Record<
          string,
          unknown
        >
      );
      for (const [aliasDotKey, colorRef] of Object.entries(
        flatInitialAliases
      )) {
        if (typeof colorRef !== 'string') continue;
        const dashAlias = dotToDash(aliasDotKey);
        const varName = `--color-${dashAlias}`;
        // Semantic aliases point to the palette var, not the raw value
        const paletteVarName = variableMap[`colors.${colorRef}`];
        if (paletteVarName) {
          initialModeVars[varName] = `var(${paletteVarName})`;
        }
        // Add semantic aliases to tokenMap and variableMap
        tokenMap[`colors.${aliasDotKey}`] = `var(${varName})`;
        variableMap[`colors.${aliasDotKey}`] = varName;
      }
      Object.assign(variables, initialModeVars);
    }
  }

  return {
    tokenMap,
    variableMap,
    variables,
    modeVariables,
    modeTokens,
    tokenDefinitions,
    modeAliasDefinitions,
  };
}

/**
 * Classify a RAW token value into its authored form (manifest v2, D6). MUST
 * run before `resolveTokenRefs` — resolution rewrites the string, and the
 * authored graph cannot be reconstructed from resolved CSS (D8). Uses
 * `matchAll` so the shared global {@link TOKEN_REF_RE} never carries a stale
 * `lastIndex` between callers.
 */
function parseTokenDefinition(rawValue: string): TokenDefinition {
  const references: TokenReference[] = [];
  for (const match of rawValue.matchAll(TOKEN_REF_RE)) {
    const ref = match[1];
    const slashIdx = ref.indexOf('/');
    references.push(
      slashIdx === -1
        ? { path: ref }
        : { path: ref.slice(0, slashIdx), opacity: ref.slice(slashIdx + 1) }
    );
  }
  if (references.length === 0) return { kind: 'literal', value: rawValue };
  return { kind: 'reference', value: rawValue, references };
}

// ─── Manifest v2: emitter version + contract hash (D6) ──────

/**
 * Version of the CSS emitter that composed a manifest's fragments. Bump when
 * ANY emitted byte changes for the same authored input — composition (D8)
 * regenerates dirty sections "under the pinned emitter version", and this is
 * that pin.
 */
const EMITTER_VERSION = 1;

/**
 * Sorted-key canonical form for hashing: object keys are emitted in sorted
 * order at every depth so the digest is independent of insertion order;
 * arrays keep authored order (reference order is contractual).
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isObject(value)) {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = canonicalize(record[key]);
    }
    return sorted;
  }
  return value;
}

/** The structural slice of `node:crypto` the contract hash needs. */
interface MinimalHash {
  update(data: string): MinimalHash;
  digest(encoding: 'hex'): string;
}

/**
 * sha256 hex digest. Primary path is `node:crypto` `createHash('sha256')`,
 * reached via `process.getBuiltinModule` so this module gains NO static
 * `node:crypto` import edge: built themes execute inside client bundles today
 * (e2e fixtures inline `createTheme(…).build()` at module init), and a static
 * builtin import is exactly what `./bootstrap` documents as forbidden in app
 * bundles. Non-Node runtimes use the pure fallback below, which produces
 * identical hex for identical input — determinism holds across environments.
 */
function sha256Hex(input: string): string {
  const proc = (
    globalThis as {
      process?: { getBuiltinModule?: (id: string) => unknown };
    }
  ).process;
  const nodeCrypto = proc?.getBuiltinModule?.('node:crypto') as
    | { createHash?: (algorithm: string) => MinimalHash }
    | undefined;
  if (nodeCrypto?.createHash) {
    return nodeCrypto.createHash('sha256').update(input).digest('hex');
  }
  return sha256HexFallback(input);
}

/** SHA-256 round constants (FIPS 180-4 §4.2.2). */
// prettier-ignore
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/**
 * UTF-8 bytes of `input` without WHATWG `TextEncoder`: the Rust system-loader
 * evaluates the system bundle in QuickJS, which provides ES built-ins only —
 * no Node globals and no WHATWG APIs. Iterating by code point handles
 * surrogate pairs; lone surrogates cannot reach this path because the input
 * is well-formed `JSON.stringify` output (ES2019 escapes them as `\uXXXX`).
 */
function utf8Bytes(input: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of input) {
    const code = char.codePointAt(0)!;
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }
  return new Uint8Array(bytes);
}

/**
 * Pure SHA-256 (FIPS 180-4) over the UTF-8 bytes of `input` — the non-Node
 * fallback for {@link sha256Hex}. Not a security surface: the contract hash
 * is a content digest for composition-identity comparison only.
 */
function sha256HexFallback(input: string): string {
  const bytes = utf8Bytes(input);
  const bitLength = bytes.length * 8;
  const paddedLength = ((((bytes.length + 8) >> 6) + 1) << 6) >>> 0;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1; // Uint32Array wraps mod 2^32
    }

    let a = state[0];
    let b = state[1];
    let c = state[2];
    let d = state[3];
    let e = state[4];
    let f = state[5];
    let g = state[6];
    let h = state[7];

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    state[0] += a;
    state[1] += b;
    state[2] += c;
    state[3] += d;
    state[4] += e;
    state[5] += f;
    state[6] += g;
    state[7] += h;
  }

  let hex = '';
  for (const word of state) hex += word.toString(16).padStart(8, '0');
  return hex;
}

/** The canonical authored inputs the contract hash digests (D6). */
interface ContractHashInput {
  tokenDefinitions: Record<string, TokenDefinition>;
  modeAliasDefinitions: ModeAliasDefinition;
  initialMode: string | undefined;
  registrations: Record<string, ContextualVarRegistration>;
  systemPreference: SystemPreferenceConfig | undefined;
  browserColorScheme: BrowserColorSchemeConfig | undefined;
}

/**
 * Stable digest over the canonical authored inputs. Identical authored input
 * ⇒ identical hash, across processes: keys sort at every depth and
 * `JSON.stringify` drops `undefined`-valued members deterministically.
 */
function computeContractHash(input: ContractHashInput): string {
  return sha256Hex(JSON.stringify(canonicalize(input)));
}

/**
 * Resolve token refs ({scale.key}) in all flattened token values.
 * Operates on the flattened tokenMap — does NOT mutate the nested theme.
 */
function resolveTokenRefs(
  tokenMap: Record<string, string>,
  _variableMap: Record<string, string>,
  _emittedScales: Set<string>
): void {
  for (const [tokenPath, value] of Object.entries(tokenMap)) {
    if (typeof value !== 'string') continue;
    if (!value.includes('{')) continue;

    // Don't resolve var() references — they're already resolved
    if (value.startsWith('var(')) continue;

    const scaleName = tokenPath.split('.')[0];

    const resolved = value.replace(TOKEN_REF_RE, (match, ref: string) => {
      // Check self-reference (same scale)
      const refScale = ref.split('.')[0];
      if (refScale === scaleName) {
        // oxlint-disable-next-line no-console -- intentional runtime diagnostic
        console.warn(
          `[animus] Self-referential token ref {${ref}} in scale '${scaleName}' — skipped`
        );
        return match;
      }

      // Handle opacity syntax: {colors.key/opacity}
      let lookupPath = ref;
      let opacity: string | undefined;
      const slashIdx = ref.indexOf('/');
      if (slashIdx !== -1) {
        lookupPath = ref.slice(0, slashIdx);
        opacity = ref.slice(slashIdx + 1);
      }

      // Look up the referenced token
      const refValue = tokenMap[lookupPath];
      if (refValue === undefined) {
        // oxlint-disable-next-line no-console -- intentional runtime diagnostic
        console.warn(
          `[animus] Token ref {${ref}} — path '${lookupPath}' not found in token map`
        );
        return match;
      }

      // Apply opacity modifier via color-mix
      if (opacity) {
        const alpha = Number.parseInt(opacity, 10);
        if (alpha === 0) return 'transparent';
        if (alpha !== 100) {
          return `color-mix(in srgb, ${refValue} ${alpha}%, transparent)`;
        }
      }

      return refValue;
    });

    if (resolved !== value) {
      tokenMap[tokenPath] = resolved;
    }
  }
}

/**
 * Build `@property` registration rules for registered contextual vars.
 * The emitted custom property is `--${name}` — the same name the Rust resolver
 * maps a bare contextual var value to. Rules emit in declaration order and only
 * for names that are genuinely declared contextual vars. Returns `''` when no
 * registration metadata was supplied (opt-in / byte-identical guarantee).
 */
function buildPropertyRegistrationCss(
  contextualVars: Map<string, string[]>,
  registrations: Map<string, ContextualVarRegistration>
): string {
  if (registrations.size === 0) return '';

  const declaredNames = new Set<string>();
  for (const names of contextualVars.values()) {
    for (const name of names) declaredNames.add(name);
  }

  const blocks: string[] = [];
  for (const [name, registration] of registrations) {
    if (!declaredNames.has(name)) continue;
    const descriptors = [
      `syntax: "${registration.syntax}";`,
      `inherits: ${registration.inherits};`,
    ];
    if (registration.initialValue !== undefined) {
      descriptors.push(`initial-value: ${registration.initialValue};`);
    }
    blocks.push(`@property --${name} { ${descriptors.join(' ')} }`);
  }
  return blocks.join('\n');
}

/**
 * Optional system-participation inputs for the emitter. Absent (or fully
 * undefined) reproduces the pre-increment emission byte-for-byte (G4).
 */
interface SystemEmissionConfig {
  /** The theme's initial mode — sources `:root`'s `color-scheme` value. */
  initialMode?: string;
  systemPreference?: SystemPreferenceConfig;
  browserColorScheme?: BrowserColorSchemeConfig;
}

/** Build CSS variable blocks from flattened data. */
function buildVariableCss(
  rootVariables: Record<string, string>,
  breakpointVariables: Record<string, string>,
  modeVariables: Record<string, Record<string, string>>,
  systemEmission: SystemEmissionConfig = {}
): string {
  const { initialMode, systemPreference, browserColorScheme } = systemEmission;
  const parts: string[] = [];

  // :root block
  const rootLines: string[] = [];
  for (const [varName, value] of Object.entries(rootVariables)) {
    rootLines.push(`  ${varName}: ${value};`);
  }
  for (const [varName, value] of Object.entries(breakpointVariables)) {
    rootLines.push(`  ${varName}: ${value};`);
  }
  if (browserColorScheme && initialMode) {
    const initialScheme = browserColorScheme[initialMode];
    if (initialScheme) rootLines.push(`  color-scheme: ${initialScheme};`);
  }
  if (rootLines.length > 0) {
    parts.push(`:root {\n${rootLines.join('\n')}\n}`);
  }

  // Guarded OS-preference blocks (D2). They follow `:root` so they override the
  // initial mode's root assignments, and the `:root:not([data-color-mode])`
  // guard makes an explicit attribute win purely in CSS — the media rule simply
  // stops matching. Declarations are the mapped mode's RAW values, identical to
  // its attribute block.
  if (systemPreference) {
    for (const scheme of ['light', 'dark'] as const) {
      const modeName = systemPreference[scheme];
      const mediaLines: string[] = [];
      const modeVars = modeVariables[modeName];
      if (modeVars) {
        for (const [varName, value] of Object.entries(modeVars)) {
          mediaLines.push(`    ${varName}: ${value};`);
        }
      }
      const mediaScheme = browserColorScheme?.[modeName];
      if (mediaScheme) mediaLines.push(`    color-scheme: ${mediaScheme};`);
      if (mediaLines.length === 0) continue;
      parts.push(
        `@media (prefers-color-scheme: ${scheme}) {\n  :root:not([data-color-mode]) {\n${mediaLines.join('\n')}\n  }\n}`
      );
    }
  }

  // [data-color-mode] blocks
  for (const [modeName, modeVars] of Object.entries(modeVariables)) {
    const modeLines: string[] = [];
    for (const [varName, value] of Object.entries(modeVars)) {
      modeLines.push(`  ${varName}: ${value};`);
    }
    const modeScheme = browserColorScheme?.[modeName];
    if (modeScheme) modeLines.push(`  color-scheme: ${modeScheme};`);
    if (modeLines.length > 0) {
      parts.push(
        `[data-color-mode="${modeName}"] {\n${modeLines.join('\n')}\n}`
      );
    }
  }

  return parts.join('\n\n');
}
