import {
  BrowserColorSchemeConfig,
  ColorModeOptions,
  ContextualVarRegistration,
  CSSColorValue,
  SerializedTheme,
  SystemPreferenceConfig,
  ThemeManifest,
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
 * Validate the optional system-participation options against the declared
 * modes. Mirrors `validateModeAliases`' error tone: `addColorModes:` prefix
 * plus the available names.
 *
 * ALWAYS called with MERGED state — `theme.modes` unions across `addColorModes`
 * calls and `from()` composition, so a per-call view both misses invalidation
 * (a later mode declaration un-totals a carried classification) and invents
 * false rejections (a mapping naming a mode declared by an earlier call).
 * Run at both gates: `addColorModes` (fail fast) and `build()` (authoritative —
 * `from()` composition never passes through `addColorModes`).
 */
function validateColorModeOptions(
  modeNames: string[],
  systemPreference: SystemPreferenceConfig | undefined,
  browserColorScheme: BrowserColorSchemeConfig | undefined
): void {
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

  if (!browserColorScheme) return;

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

  if (!systemPreference) return;

  for (const [axis, expected] of [
    ['light', 'light'],
    ['dark', 'dark'],
  ] as const) {
    const modeName = systemPreference[axis];
    const classification = browserColorScheme[modeName];
    if (classification !== expected) {
      throw new Error(
        `addColorModes: browserColorScheme conflicts with systemPreference — mode '${modeName}' is mapped to the OS ${axis} preference but classified '${classification}'; expected '${expected}'.`
      );
    }
  }
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
}

function createState(theme?: Record<string, unknown>): BuilderState {
  return {
    theme: theme || { breakpoints: {} },
    emittedScales: new Set(),
    contextualVars: new Map(),
    contextualVarRegistrations: new Map(),
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

  // KNOWN DROP (DEF-6, openspec change modern-css-surface): @property
  // registration metadata does not survive from() — the manifest wire is
  // names-only, so a composed theme loses its registrations until
  // re-declared. Deliberate deferral, not an oversight; resolve with the
  // first real from()-composed consumer that registers metadata.
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
    // exactly the way `merge` will, then validate the RESULT.
    const systemPreference = mergeOptionObject<SystemPreferenceConfig>(
      this._state.theme.systemPreference,
      options?.systemPreference
    );
    const browserColorScheme = mergeOptionObject<BrowserColorSchemeConfig>(
      this._state.theme.browserColorScheme,
      options?.browserColorScheme
    );
    validateColorModeOptions(modeNames, systemPreference, browserColorScheme);

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

    // ── Merged-state option validation ─────────────────────
    // Authoritative gate: `from()` composition merges modes AND options without
    // passing through `addColorModes`, and a later mode declaration can
    // invalidate a previously-valid pair (an un-totalled classification). Both
    // option objects survive `from()` as ordinary enumerable theme keys.
    const systemPreference = isObject(theme.systemPreference)
      ? (theme.systemPreference as unknown as SystemPreferenceConfig)
      : undefined;
    const browserColorScheme = isObject(theme.browserColorScheme)
      ? (theme.browserColorScheme as unknown as BrowserColorSchemeConfig)
      : undefined;
    const mergedModeNames = isObject(theme.modes)
      ? Object.keys(theme.modes as Record<string, unknown>)
      : [];
    validateReservedModeNames(mergedModeNames);
    validateColorModeOptions(
      mergedModeNames,
      systemPreference,
      browserColorScheme
    );

    // ── Build-time flatten pass ────────────────────────────
    const { tokenMap, variableMap, variables, modeVariables, modeTokens } =
      flattenTheme(theme, emittedScales);

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
} {
  const tokenMap: Record<string, string> = {};
  const variableMap: Record<string, string> = {};
  const variables: Record<string, string> = {};
  const modeVariables: Record<string, Record<string, string>> = {};
  const modeTokens: Record<string, Record<string, string>> = {};

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

      for (const [aliasDotKey, colorRef] of Object.entries(flatAliases)) {
        if (typeof colorRef !== 'string') continue;
        const dashAlias = dotToDash(aliasDotKey);
        const varName = `--color-${dashAlias}`;

        // Resolve color ref to raw value via dot-path
        const rawValue = flatColors[colorRef as string];
        modeVals[`colors.${aliasDotKey}`] =
          rawValue !== undefined ? String(rawValue) : String(colorRef);
        modeVars[varName] =
          rawValue !== undefined ? String(rawValue) : String(colorRef);
      }

      modeVariables[modeName] = modeVars;
      modeTokens[modeName] = modeVals;
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

  return { tokenMap, variableMap, variables, modeVariables, modeTokens };
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
