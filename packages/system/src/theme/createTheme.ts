import { isLibraryBundle } from '../SystemBuilder';
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
  ThemeStructuralKey,
  TokenDefinition,
  TokenReference,
} from '../types/theme';
import { LiteralPaths } from './flattenScale';
import { resolveReferences } from './resolveReferences';
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
 * Theme keys owned by builder structure or the built-theme boundary. A scale
 * may not claim them: structural keys are skipped by `flattenTheme`, while
 * boundary keys are replaced by non-enumerable methods/metadata at build().
 * Keep this runtime set aligned with `ThemeStructuralKey`.
 */
const RESERVED_THEME_KEY_LIST = [
  'breakpoints',
  'modes',
  'mode',
  'systemPreference',
  'browserColorScheme',
  'modeBases',
  '__emitted',
  'manifest',
  'serialize',
  'varRef',
] as const satisfies readonly ThemeStructuralKey[];
const RESERVED_THEME_KEYS: ReadonlySet<string> = new Set(
  RESERVED_THEME_KEY_LIST
);

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

/**
 * Validate the D6 `basedOn` mode-base map against the MERGED mode set: every
 * key and every base must name a declared mode, self-bases are rejected, and
 * base chains must terminate (a cycle can never fill coverage). Runs at both
 * gates like the other mode options — `addColorModes` (fail fast) and
 * `build()` (authoritative: extend/from composition merges modes without
 * passing through `addColorModes`).
 */
function validateModeBases(
  modeNames: string[],
  modeBases: Record<string, string> | undefined
): void {
  if (!modeBases) return;
  const declared = new Set(modeNames);
  const available = `Available modes: ${modeNames.join(', ')}`;
  for (const [modeName, base] of Object.entries(modeBases)) {
    if (!declared.has(modeName)) {
      throw new Error(
        `addColorModes: basedOn names unknown mode '${modeName}'. ${available}`
      );
    }
    if (typeof base !== 'string' || !declared.has(base)) {
      throw new Error(
        `addColorModes: basedOn['${modeName}'] references unknown base mode '${String(base)}'. ${available}`
      );
    }
    if (base === modeName) {
      throw new Error(
        `addColorModes: basedOn['${modeName}'] cannot base a mode on itself.`
      );
    }
  }
  for (const start of Object.keys(modeBases)) {
    const seen = new Set<string>();
    let cursor: string | undefined = start;
    while (cursor !== undefined) {
      if (seen.has(cursor)) {
        throw new Error(
          `addColorModes: basedOn chain cycles — ${[...seen, cursor]
            .map((mode) => `'${mode}'`)
            .join(' → ')}. Give one mode in the chain a covered literal base.`
        );
      }
      seen.add(cursor);
      cursor = modeBases[cursor];
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
// resolveReferences() during build(). Type-level validation can be restored
// when the type-state chain depth is optimized.

// ─── Type Helpers ───────────────────────────────────────────

/** Flatten a type to prevent MergeTheme depth accumulation (TS2589). Exported for use in consumer themes. */
export type Flatten<T> = { [K in keyof T]: T[K] };

/** Right-biased object merge used where runtime composition is also right-biased. */
type MergeRecord<Base, Incoming> = Omit<Base, keyof Incoming> & Incoming;

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

type ThemeScaleKeys<T> = Exclude<keyof T & string, ThemeStructuralKey>;

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
  emittedScales?: string[];
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
  /**
   * Per-leaf-path provenance of `extend()` sources: flattened dot-path →
   * 1-based index of the extend call that first defined it (D3/G4 — sibling
   * conflicts error naming both sources positionally; positional labels are
   * the accepted form until DEF-4's provenance artifact).
   */
  extendProvenance: Map<string, number>;
  /** Number of `extend()` calls made so far — the next source's label index. */
  extendCount: number;
  /**
   * Mode names carried in by `extend()` sources (D6). Inherited modes are
   * EXEMPT from the coverage gate — a kit's own alias asymmetry is
   * pre-existing behavior, not consumer breakage, and must round-trip.
   */
  inheritedModes: Set<string>;
  /**
   * Alias dot-paths declared by any extended source's modes (D6). A
   * consumer-declared mode leaving any of these uncovered needs a `basedOn`
   * entry or the build fails listing the uncovered set.
   */
  inheritedModeAliases: Set<string>;
  /**
   * Token paths dropped by an explicit `addScale({ replace: true })` →
   * replaced scale name (D5). Consulted at `build()`: a reference whose
   * target is absent from the merged map AND present here is a hard error;
   * a later re-add simply makes the target known again.
   */
  droppedTokenPaths: Map<string, string>;
}

function createState(theme?: Record<string, unknown>): BuilderState {
  return {
    theme: theme || { breakpoints: {} },
    emittedScales: new Set(),
    contextualVars: new Map(),
    contextualVarRegistrations: new Map(),
    hasLegacyManifestSource: false,
    extendProvenance: new Map(),
    extendCount: 0,
    inheritedModes: new Set(),
    inheritedModeAliases: new Set(),
    droppedTokenPaths: new Map(),
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
    extendProvenance: new Map(state.extendProvenance),
    extendCount: state.extendCount,
    inheritedModes: new Set(state.inheritedModes),
    inheritedModeAliases: new Set(state.inheritedModeAliases),
    droppedTokenPaths: new Map(state.droppedTokenPaths),
  };
  for (const [scale, vars] of state.contextualVars) {
    next.contextualVars.set(scale, [...vars]);
  }
  return next;
}

/**
 * Exact leaf-path flatten for extend() provenance: like `flattenToDotPaths`
 * but WITHOUT the `_` identity-key collapse, so a leaf and a branch can
 * never share a path spelling. A prefix relation between two tracked paths
 * is then a GENUINE structural divergence (one sibling authored a leaf
 * value where the other authored a nested branch) — the review-F1 case that
 * per-leaf value comparison alone cannot see.
 */
function flattenLeafPathsExact(
  object: Record<string, unknown>,
  path?: string
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(object)) {
    const nextKey = path ? `${path}.${key}` : key;
    const current = object[key];
    if (isObject(current)) {
      Object.assign(
        result,
        flattenLeafPathsExact(current as Record<string, unknown>, nextKey)
      );
    } else {
      result[nextKey] = current;
    }
  }
  return result;
}

/**
 * Deep copy of plain theme data (records, arrays, primitives). `extend()`
 * clones its source's raw config before `merge` folds prior builder state
 * over it — `merge` adopts and MUTATES nested source objects in place, and a
 * consumed kit's built theme must never be corrupted by composition.
 */
function deepCopyPlain<Value>(value: Value): Value {
  if (Array.isArray(value)) {
    return value.map(deepCopyPlain) as unknown as Value;
  }
  if (isObject(value)) {
    const record = value as Record<string, unknown>;
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(record)) {
      copy[key] = deepCopyPlain(record[key]);
    }
    return copy as unknown as Value;
  }
  return value;
}

/**
 * What `from()` actually inherits from its argument: a library bundle
 * (`{ system, tokens }`) contributes its tokens half; anything else is
 * treated as a built theme and contributes itself. Mirrors the runtime
 * bundle detection inside `from()`.
 */
type ThemeSourceOf<Source> = Source extends {
  system: { toConfig(...args: never[]): unknown };
  tokens?: infer Tokens;
}
  ? Tokens extends Record<string, unknown>
    ? Tokens
    : Record<never, never>
  : Source;

type ThemeBoundaryKey = '__emitted' | 'manifest' | 'serialize' | 'varRef';

/** Runtime composition copies enumerable data and deliberately skips methods. */
type ThemeDataOf<Source> = {
  [Key in keyof Source as Key extends ThemeBoundaryKey
    ? never
    : Extract<Source[Key], (...args: never[]) => unknown> extends never
      ? Key
      : never]: Source[Key];
};

type MergeThemeData<Base, Source> = Flatten<
  MergeRecord<Base, ThemeDataOf<Source>>
>;

/** Preserve the built source's exact emitted-scale phantom without exposing it as data. */
type EmittedThemeScalesOf<Source> = Source extends {
  readonly __emitted: [infer Emitted extends string];
}
  ? Emitted
  : never;

/**
 * What `extend()` inherits from its argument: a library bundle contributes
 * its THEME half — `theme ?? tokens` (D9 naming; `tokens` accepted until
 * DEF-8 resolves) — anything else is treated as a built theme and
 * contributes itself. Mirrors the runtime bundle-half resolution inside
 * `extend()`.
 */
type ExtendedThemeSourceOf<Source> = Source extends {
  system: { toConfig(...args: never[]): unknown };
  theme?: infer ThemeHalf;
  tokens?: infer TokensHalf;
}
  ? ThemeHalf extends Record<string, unknown>
    ? ThemeHalf
    : TokensHalf extends Record<string, unknown>
      ? TokensHalf
      : Record<never, never>
  : Source;

declare const THEME_STAGE_BRAND: unique symbol;

/**
 * Builder type-state for the inherit-first rule (D2), mirroring the system
 * builder's `SystemBuilderStage`: `extend()` is only callable while the
 * builder is in the `'inherit'` stage; every augmentation method advances to
 * `'extend'`, making "inherit first, then extend" a compile error rather
 * than a lint. `from()` is deliberately NOT stage-gated — its call-anywhere
 * semantics are frozen for the deprecation window, so it passes the stage
 * through unchanged. Phantom — never present at runtime.
 */
export type ThemeBuilderStage = 'inherit' | 'extend';

/**
 * Re-seed builder state from a source theme's manifest. This is `from()`'s
 * manifest read, factored out verbatim so `extend()` inherits the SAME
 * emitted-scale/contextual-var/manifest-v2 carry semantics: the manifest is
 * non-enumerable, so the ordinary key-copy loop never sees it (D6/D8).
 */
function reseedStateFromManifest(
  state: BuilderState,
  manifest: ThemeManifest | undefined,
  mergeExtensionState = false
): void {
  if (manifest?.emittedScales) {
    for (const scale of manifest.emittedScales) {
      state.emittedScales.add(scale);
    }
  } else if (manifest?.variableMap) {
    // A v2 manifest distinguishes authored token definitions from synthetic
    // color-mode aliases. Treating an alias path as emission evidence would
    // flip a non-emitted colors scale to emitted during a no-op extension.
    const emittedPaths =
      manifest.manifestVersion === 2 && manifest.tokenDefinitions
        ? Object.keys(manifest.variableMap).filter(
            (tokenPath) => manifest.tokenDefinitions?.[tokenPath] !== undefined
          )
        : Object.keys(manifest.variableMap);
    for (const tokenPath of emittedPaths) {
      const scale = tokenPath.split('.')[0];
      state.emittedScales.add(scale === 'colors' ? 'colors' : scale);
    }
  }
  if (manifest?.contextualVars) {
    for (const [scale, vars] of Object.entries(manifest.contextualVars)) {
      const existing = mergeExtensionState
        ? state.contextualVars.get(scale)
        : undefined;
      state.contextualVars.set(
        scale,
        existing ? [...new Set([...existing, ...vars])] : [...vars]
      );
    }
  }
  if (manifest) {
    if (manifest.manifestVersion === 2) {
      state.carriedManifestV2 = {
        tokenDefinitions: manifest.tokenDefinitions,
        emittedScales: manifest.emittedScales,
        modeAliasDefinitions: manifest.modeAliasDefinitions,
        registrations: manifest.registrations,
        emitterVersion: manifest.emitterVersion,
        contractHash: manifest.contractHash,
        cssFragments: manifest.cssFragments,
      };
      // Re-seed the registration metadata the CLOSED DROP note on `from()`
      // records: carried registrations become live builder state again, so
      // an unmutated rebuild re-emits identical @property rules.
      if (manifest.registrations) {
        for (const [name, registration] of Object.entries(
          manifest.registrations
        )) {
          const existing = state.contextualVarRegistrations.get(name);
          if (
            mergeExtensionState &&
            existing &&
            (existing.syntax !== registration.syntax ||
              existing.inherits !== registration.inherits ||
              existing.initialValue !== registration.initialValue)
          ) {
            throw new Error(
              `extend: contextual variable '${name}' has divergent ` +
                `@property registrations across extended themes`
            );
          }
          state.contextualVarRegistrations.set(name, registration);
        }
      }
    } else {
      // v1 manifest: authored structure unknowable — fail closed (D8).
      state.hasLegacyManifestSource = true;
    }
  }
}

/**
 * ThemeScales — the final phase. Has addScale, extendScale, declareContextualVars, build.
 * Also allows addColors and addColorModes for augmentation.
 */
export class ThemeBuilder<
  T extends Record<string, unknown> = Record<string, unknown>,
  Emitted extends string = never,
  Stage extends ThemeBuilderStage = 'inherit',
> {
  // Structural anchor for the phantom Stage parameter — without a member
  // referencing it, 'inherit' and 'extend' builders would be mutually
  // assignable and the `this`-typed `extend()` gate would never fire (see
  // the system builder's identical comment).
  declare readonly [THEME_STAGE_BRAND]?: Stage;

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
    return new ThemeBuilder<Next, Emitted, 'extend'>(
      copyState(this._state, nextTheme)
    );
  }

  // CLOSED DROP (was DEF-6, openspec change modern-css-surface; closed by
  // multi-theme-support increment 01 under D9): @property registration
  // metadata now SURVIVES from() — manifest v2 carries `registrations`, and
  // the explicit manifest read below re-seeds `contextualVarRegistrations`
  // from them. Residual, by design (D8): a source carrying only a v1
  // (names-only) manifest still composes without registration metadata —
  // v1 round-trips unchanged and gains no fabricated v2 fields.
  // `Source extends object` (not `Record<string, unknown>`): interface-typed
  // values — e.g. a kit export annotated as the public `LibraryBundle` — have
  // no implicit index signature and must still be accepted; the runtime only
  // ever copies enumerable non-function keys.
  //
  /**
   * FROZEN for the deprecation window (D1/G6): source-WINS precedence over
   * prior builder state, callable at ANY stage — the phantom Stage passes
   * through unchanged. Do not add a stage gate; do not flip the merge
   * direction. Those semantics ship under the new verb only.
   *
   * @deprecated Use `extend(source)` — the single extension verb on both
   * builders: the extended source seeds the base and later local calls win.
   * `from()` keeps these frozen source-wins semantics for at least one minor
   * release after `extend()` ships.
   */
  from<Source extends object>(builtTheme: Source) {
    // Library-bundle acceptance: `{ system, tokens }` groups one export for
    // both builders — this builder consumes the tokens half exactly as if
    // the built theme had been passed directly and ignores the rest. The
    // shared guard keys on `system.toConfig` being callable (theme token
    // values are strings/numbers/records, never objects carrying
    // functions), so a theme that happens to define a scale named `system`
    // cannot match.
    const source: Record<string, unknown> = isLibraryBundle(builtTheme)
      ? ((builtTheme as { tokens?: Record<string, unknown> }).tokens ?? {})
      : (builtTheme as Record<string, unknown>);

    const raw: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      const val = source[key];
      if (typeof val !== 'function') {
        raw[key] = val;
      }
    }
    const nextTheme = merge({}, this._state.theme, raw);
    const next = new ThemeBuilder<
      MergeThemeData<T, ThemeSourceOf<Source>>,
      Emitted | EmittedThemeScalesOf<ThemeSourceOf<Source>>,
      Stage
    >(
      copyState(this._state, nextTheme)
    );

    // Manifest v2 carry (D6/D8) — through THIS explicit read only: the
    // manifest is non-enumerable, so the key-copy loop above never sees it.
    reseedStateFromManifest(
      next._state,
      (source as { manifest?: ThemeManifest }).manifest
    );
    return next;
  }

  /**
   * Extend this theme from a consumed library (D1/D2): the source's complete
   * configuration — tokens, modes, preferences, registrations, emitted-scale
   * set — seeds the builder as the BASE, and local calls made after
   * `extend()` win on conflict (the mirror of `from()`'s source-wins).
   * Chainable and repeatable, but only before augmentation methods ("inherit
   * first, then extend" — enforced by the phantom builder stage). Accepts a
   * built theme or a library bundle, consuming the bundle's theme half
   * (`theme ?? tokens`, D9) and ignoring the rest.
   *
   * Sibling conflicts fail loud (D3/G4): a leaf path defined divergently by
   * two extended sources throws naming the path and both sources
   * positionally; equal values coalesce silently, and the consumer's own
   * post-extend `add*` calls override silently (NS-4).
   */
  extend<Source extends object>(
    this: ThemeBuilder<T, Emitted, 'inherit'>,
    source: Source
  ): ThemeBuilder<
    MergeThemeData<T, ExtendedThemeSourceOf<Source>>,
    Emitted | EmittedThemeScalesOf<ExtendedThemeSourceOf<Source>>,
    'inherit'
  > {
    // Bundle-half resolution: the theme half under the D9 name, falling back
    // to the pre-D9 `tokens` spelling; a built theme contributes itself.
    const themeHalf: Record<string, unknown> = isLibraryBundle(source)
      ? (((source as { theme?: unknown }).theme ??
          (source as { tokens?: unknown }).tokens ??
          {}) as Record<string, unknown>)
      : (source as Record<string, unknown>);

    const raw: Record<string, unknown> = {};
    for (const key of Object.keys(themeHalf)) {
      const val = themeHalf[key];
      if (typeof val !== 'function') {
        raw[key] = val;
      }
    }

    // ── Sibling-conflict detection (D3/G4) ────────────────────
    // Inherit-first guarantees the current state is exactly the fold of the
    // prior extends (plus the empty seed), so a provenance hit means another
    // extended source owns the leaf: equal → coalesce; divergent → loud.
    // Paths use the EXACT flatten (no `_` collapse — see
    // {@link flattenLeafPathsExact}) so branch-vs-leaf structural divergence
    // between siblings (review F1: one kit authors `colors.primary` as a
    // leaf, another as a nested object) is a prefix relation between
    // tracked paths and errors loudly instead of letting `merge` pick an
    // order-dependent winner. Consumer-authored branches after extends stay
    // silent-override (NS-4) — only kit-vs-kit collisions error.
    const sourceIndex = this._state.extendCount + 1;
    const provenance = new Map(this._state.extendProvenance);
    const existingLeaves = flattenLeafPathsExact(this._state.theme);
    const incomingLeaves = flattenLeafPathsExact(raw);
    // Strict-prefix index of already-tracked leaves: every strict dot-prefix
    // of a tracked path → that leaf's source index. Built BEFORE this
    // source's paths are admitted, so one source's own leaf set (which can
    // never self-prefix) is exempt.
    const trackedPrefixes = new Map<string, number>();
    for (const [trackedPath, index] of provenance) {
      for (
        let dot = trackedPath.lastIndexOf('.');
        dot !== -1;
        dot = trackedPath.lastIndexOf('.', dot - 1)
      ) {
        const prefix = trackedPath.slice(0, dot);
        if (!trackedPrefixes.has(prefix)) trackedPrefixes.set(prefix, index);
      }
    }
    for (const [path, value] of Object.entries(incomingLeaves)) {
      const priorIndex = provenance.get(path);
      if (priorIndex !== undefined) {
        const existing = existingLeaves[path];
        if (existing !== value) {
          throw new Error(
            `extend: path '${path}' is defined divergently by extended theme #${priorIndex} (${JSON.stringify(existing)}) and extended theme #${sourceIndex} (${JSON.stringify(value)}). Sibling themes must agree — override intentionally with an add* call after extend().`
          );
        }
        continue;
      }
      // Incoming LEAF where a prior source authored a BRANCH beneath it.
      const branchIndex = trackedPrefixes.get(path);
      if (branchIndex !== undefined) {
        throw new Error(
          `extend: path '${path}' is defined divergently by extended theme #${branchIndex} (a nested branch) and extended theme #${sourceIndex} (a leaf value). Sibling themes must agree — override intentionally with an add* call after extend().`
        );
      }
      // Incoming BRANCH (this leaf sits beneath it) where a prior source
      // authored a LEAF at one of its ancestors.
      for (
        let dot = path.lastIndexOf('.');
        dot !== -1;
        dot = path.lastIndexOf('.', dot - 1)
      ) {
        const ancestor = path.slice(0, dot);
        const ancestorIndex = provenance.get(ancestor);
        if (ancestorIndex !== undefined && ancestorIndex !== sourceIndex) {
          throw new Error(
            `extend: path '${ancestor}' is defined divergently by extended theme #${ancestorIndex} (a leaf value) and extended theme #${sourceIndex} (a nested branch). Sibling themes must agree — override intentionally with an add* call after extend().`
          );
        }
      }
      provenance.set(path, sourceIndex);
    }

    // Base-then-local-wins: the DEEP-COPIED source raw config is the merge
    // target (so `merge` never mutates the consumed kit's built theme) and
    // prior builder state folds over it.
    const nextTheme = merge(deepCopyPlain(raw), this._state.theme);
    const next = new ThemeBuilder<
      MergeThemeData<T, ExtendedThemeSourceOf<Source>>,
      Emitted | EmittedThemeScalesOf<ExtendedThemeSourceOf<Source>>,
      'inherit'
    >(copyState(this._state, nextTheme));
    next._state.extendProvenance = provenance;
    next._state.extendCount = sourceIndex;

    // D6 bookkeeping: inherited modes are exempt from the coverage gate;
    // inherited alias paths are what a NEW consumer mode must cover (or
    // declare a base for).
    if (isObject(raw.modes)) {
      for (const [modeName, modeAliases] of Object.entries(
        raw.modes as Record<string, unknown>
      )) {
        next._state.inheritedModes.add(modeName);
        if (!isObject(modeAliases)) continue;
        for (const aliasPath of Object.keys(
          flattenToDotPaths(modeAliases as Record<string, unknown>)
        )) {
          next._state.inheritedModeAliases.add(aliasPath);
        }
      }
    }

    // Manifest re-seed — shared verbatim with `from()` (emitted scales,
    // contextual vars, manifest-v2 carry, v1 fail-closed taint).
    reseedStateFromManifest(
      next._state,
      (themeHalf as { manifest?: ThemeManifest }).manifest,
      true
    );
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
    type ExistingColors = T extends { colors: infer Existing } ? Existing : {};
    type Next = Flatten<
      Omit<T, 'colors'> &
        Record<'colors', Flatten<MergeRecord<ExistingColors, NextColors>>>
    >;
    const next = new ThemeBuilder<Next, Emitted | 'colors', 'extend'>(
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
    // D6 mode bases follow the same discipline: merged over carried state,
    // validated fail-fast here and authoritatively at build().
    const modeBases = mergeOptionObject<Record<string, string>>(
      this._state.theme.modeBases,
      options?.basedOn
    );
    validateModeBases(modeNames, modeBases);

    const nextTheme = merge({}, this._state.theme, {
      modes: modeConfig,
      mode: initialMode,
      // Only stored when supplied — an unconfigured theme keeps exactly its
      // current enumerable key set (byte-parity precondition, G4).
      ...(systemPreference ? { systemPreference } : {}),
      ...(browserColorScheme ? { browserColorScheme } : {}),
      ...(modeBases ? { modeBases } : {}),
    });

    // Colors type = existing palette keys + mode alias keys (superset)
    // AliasKeys is RESOLVED — a flat Record of alias dot-paths.
    type ColorsWithModes = (T extends { colors: infer C } ? C : unknown) &
      AliasKeys;
    type Merged = Omit<T, 'colors'> & Record<'colors', ColorsWithModes>;
    type Next = { [K in keyof Merged]: Merged[K] };
    return new ThemeBuilder<Next, Emitted, 'extend'>(
      copyState(this._state, nextTheme)
    );
  }

  addScale<
    Key extends string,
    Values extends Record<
      string | number,
      string | number | Record<string, string | number>
    >,
    Emit extends boolean = false,
    Replace extends boolean = false,
    // Generic default forces TS to resolve LiteralPaths ONCE and bind the result.
    NewScale extends LiteralPaths<Values, '.'> = LiteralPaths<Values, '.'>,
  >(config: {
    name: Key & (Key extends ThemeStructuralKey ? never : unknown);
    values: Values;
    emit?: Emit;
    replace?: Replace;
  }) {
    const { name, values, emit, replace } = config;
    if (RESERVED_THEME_KEYS.has(name)) {
      throw new Error(
        `addScale: '${name}' is a reserved theme key owned by the builder or built-theme boundary, so a scale by this name cannot survive build(). Choose another scale name.`
      );
    }
    const prior = this._state.theme[name];
    let nextTheme: Record<string, unknown>;
    if (replace) {
      // Explicit wholesale replacement (D5): the scale becomes EXACTLY the
      // supplied values. Implicit deletion stays impossible — the default
      // form below merges by key.
      nextTheme = merge({}, this._state.theme);
      nextTheme[name] = values;
    } else {
      nextTheme = merge({}, this._state.theme, { [name]: values });
    }
    // NewScale is RESOLVED — a flat Record. Downstream sees concrete keys.
    type NextEmitted = Emit extends true ? Emitted | Key : Emitted;
    type ExistingScale = Key extends keyof T ? T[Key] : {};
    type NextScale = Replace extends true
      ? NewScale
      : Flatten<MergeRecord<ExistingScale, NewScale>>;
    type Next = Flatten<Omit<T, Key> & Record<Key, NextScale>>;
    const next = new ThemeBuilder<Next, NextEmitted, 'extend'>(
      copyState(this._state, nextTheme)
    );
    if (emit) next._state.emittedScales.add(name);
    if (replace && isObject(prior)) {
      // Track keys the replacement DROPPED: a reference whose target is
      // among them fails build() unconditionally (D5) — unless a later call
      // re-adds the key, which makes the target known again.
      const kept = new Set(
        Object.keys(flattenToDotPaths(values as Record<string, unknown>))
      );
      for (const dotKey of Object.keys(
        flattenToDotPaths(prior as Record<string, unknown>)
      )) {
        if (!kept.has(dotKey)) {
          next._state.droppedTokenPaths.set(`${name}.${dotKey}`, name);
        }
      }
    }
    return next;
  }

  declareContextualVars<
    const Vars extends Partial<{
      [K in ThemeScaleKeys<T>]: readonly string[];
    }>,
  >(
    vars: Vars & Record<Exclude<keyof Vars, ThemeScaleKeys<T>>, never>,
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

    const next = new ThemeBuilder<WithPhantoms, Emitted, 'extend'>(
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
    Key extends Exclude<keyof T, ThemeStructuralKey>,
    Fn extends (tokens: T[Key]) => Record<string | number, unknown>,
  >(key: Key, updateFn: Fn) {
    const nextTheme = merge({}, this._state.theme, {
      [key]: updateFn(this._state.theme[key as string] as T[Key]),
    });
    type NextScale = Flatten<MergeRecord<T[Key], ReturnType<Fn>>>;
    type Next = Flatten<Omit<T, Key> & Record<Key, NextScale>>;
    return new ThemeBuilder<Next, Emitted, 'extend'>(
      copyState(this._state, nextTheme)
    );
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
    const modeBases = isObject(theme.modeBases)
      ? (theme.modeBases as unknown as Record<string, string>)
      : undefined;
    validateModeBases(mergedModeNames, modeBases);

    // ── Build-time mode-alias re-validation (D6) ───────────
    // `addColorModes` validates eagerly against the colors present at call
    // time; extend()/from() composition merges modes and colors without
    // passing through it, and an explicit colors replacement can drop alias
    // targets — only the merged map here is final, so re-validate every
    // mode against it.
    if (isObject(theme.modes) && isObject(theme.colors)) {
      const nestedColors = theme.colors as Record<string, unknown>;
      const flatColorKeys = Object.keys(flattenToDotPaths(nestedColors));
      for (const [modeName, modeAliases] of Object.entries(
        theme.modes as Record<string, unknown>
      )) {
        if (!isObject(modeAliases)) continue;
        validateModeAliases(
          modeName,
          modeAliases as Record<string, unknown>,
          nestedColors,
          flatColorKeys,
          ''
        );
      }
    }

    // ── D6 coverage: authored aliases + base-chain fills ───
    const modeAliasDefinitions = collectAuthoredModeAliases(theme);
    const { effectiveModes, coverageFills } = resolveModeCoverage(
      modeAliasDefinitions,
      modeBases,
      this._state.inheritedModes,
      this._state.inheritedModeAliases
    );
    for (const fill of coverageFills) {
      // ONE aggregated diagnostic per mode (D6) — never per-token spam.
      // oxlint-disable-next-line no-console -- intentional runtime diagnostic
      console.info(
        `[animus] Mode '${fill.mode}': ${fill.count} alias(es) inherit from '${fill.base}'`
      );
    }

    // ── Build-time flatten pass ────────────────────────────
    const {
      tokenMap: flatTokenMap,
      variableMap,
      variables: flatVariables,
      tokenDefinitions,
    } = flattenTheme(theme, emittedScales, effectiveModes);

    // ── D5: replacement-dropped reference targets fail loud ─
    assertNoDroppedReferences(
      tokenDefinitions,
      flatTokenMap,
      this._state.droppedTokenPaths,
      this._state.extendProvenance
    );

    // Late-binding reference resolution over the COMPLETE flattened maps
    // (D4, first-class-extension): deterministic DAG traversal replaces the
    // old single-pass rewrite — references inside emitted scales resolve
    // into the variable declarations instead of leaking into CSS, and both
    // returned maps are in sorted token-path order so declaration order is
    // never observable in the serialized wire.
    const { tokenMap, variables } = resolveReferences(
      flatTokenMap,
      variableMap,
      flatVariables
    );

    // ── Mode value maps THROUGH the resolver (G2 closure) ──
    // Mode-override declarations previously carried RAW flattened color
    // values verbatim, so a reference-valued color leaked a literal `{…}`
    // into every [data-color-mode] block. Values now come from the resolved
    // maps; modes and lines are sorted so declaration order is never
    // observable (G3).
    const { modeVariables, modeTokens } = resolveModeValueMaps(
      effectiveModes,
      variableMap,
      variables,
      tokenMap
    );

    // Serialize breakpoints — sorted by property name so reversed
    // declarations emit byte-identically (G3).
    const bpVariables: Record<string, string> = {};
    if (theme.breakpoints && isObject(theme.breakpoints)) {
      const breakpointEntries = Object.entries(
        theme.breakpoints as Record<string, number>
      )
        .map(([key, value]) => [`--breakpoint-${key}`, `${value}px`] as const)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      for (const [varName, value] of breakpointEntries) {
        bpVariables[varName] = value;
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
    // ── G2: emitted CSS never carries an unresolved `{…}` ──
    // A declaration whose resolved value still contains a reference (target
    // never defined anywhere — the supported warn-and-literal kit pattern)
    // is OMITTED from the emitted CSS with ONE aggregated warning: a literal
    // `{…}` in shipped CSS is worse than an absent declaration. The token
    // map keeps the literal (the manifest surface is unchanged).
    const { emittableVariables, emittableModeVariables, omitted } =
      omitUnresolvedDeclarations(variables, modeVariables);
    if (omitted.length > 0) {
      // oxlint-disable-next-line no-console -- intentional runtime diagnostic
      console.warn(
        `[animus] Omitted ${omitted.length} CSS declaration(s) whose token references never resolved: ${omitted.join(', ')}`
      );
    }
    const baseVariableCss = buildVariableCss(
      emittableVariables,
      bpVariables,
      emittableModeVariables,
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
        emittedScales: [...emittedScales].sort(),
        modeAliasDefinitions,
        registrations,
        emitterVersion: EMITTER_VERSION,
        contractHash: computeContractHash({
          tokenDefinitions,
          emittedScales: [...emittedScales].sort(),
          modeAliasDefinitions,
          initialMode: typeof theme.mode === 'string' ? theme.mode : undefined,
          registrations,
          systemPreference,
          browserColorScheme,
          // D6: mode bases change emitted coverage — part of the authored
          // contract. `undefined` is dropped by JSON.stringify, so themes
          // without bases keep their pre-increment hashes.
          modeBases,
        }),
        cssFragments,
      };
    }

    // Sorted-key wire maps (G3): `variableMapJson` and the breakpoint tail
    // of `scalesJson` must be byte-identical under reversed declarations.
    const sortedVariableMap = sortRecordByKey(variableMap);
    const manifest: ThemeManifest = {
      tokenMap: {
        ...tokenMap,
        // Include breakpoints in tokenMap for Rust crate compatibility
        ...sortRecordByKey(
          Object.fromEntries(
            Object.entries(theme.breakpoints || {}).map(([k, v]) => [
              `breakpoints.${k}`,
              String(v),
            ])
          )
        ),
      },
      variableMap: sortedVariableMap,
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
 * This is the ONLY place where flattening happens. Mode VALUE maps are no
 * longer computed here — they resolve AFTER `resolveReferences` (see
 * {@link resolveModeValueMaps}), closing the G2 gap where mode-override
 * declarations bypassed the resolver.
 */
function flattenTheme(
  theme: Record<string, unknown>,
  emittedScales: Set<string>,
  effectiveModes: ModeAliasDefinition
): {
  tokenMap: Record<string, string>;
  variableMap: Record<string, string>;
  variables: Record<string, string>;
  tokenDefinitions: Record<string, TokenDefinition>;
} {
  const tokenMap: Record<string, string> = {};
  const variableMap: Record<string, string> = {};
  const variables: Record<string, string> = {};
  // Manifest v2 (D6): the authored graph, captured HERE — before
  // resolveReferences rewrites the values. Inference from resolved CSS is
  // unsound (D8).
  const tokenDefinitions: Record<string, TokenDefinition> = {};

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
      scaleName === 'browserColorScheme' ||
      scaleName === 'modeBases'
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

  // Merge the initial mode's semantic aliases into the main variables and
  // tokenMap. The EFFECTIVE alias set (authored + D6 base-chain fills) is
  // used, so a partially covered initial mode still declares every alias.
  const initialMode = theme.mode as string;
  const initialAliases =
    typeof initialMode === 'string' ? effectiveModes[initialMode] : undefined;
  if (initialAliases) {
    for (const [aliasDotKey, colorRef] of Object.entries(initialAliases)) {
      const dashAlias = dotToDash(aliasDotKey);
      const varName = `--color-${dashAlias}`;
      // Semantic aliases point to the palette var, not the raw value
      const paletteVarName = variableMap[`colors.${colorRef}`];
      if (paletteVarName) {
        // A semantic alias may intentionally have the same path as its
        // palette target. Never replace that declaration with a self-reference.
        if (paletteVarName !== varName) {
          variables[varName] = `var(${paletteVarName})`;
        }
      } else {
        // Non-emitted palettes still need a concrete semantic declaration.
        const literal = tokenMap[`colors.${colorRef}`];
        if (literal !== undefined) variables[varName] = literal;
      }
      // Add semantic aliases to tokenMap and variableMap
      tokenMap[`colors.${aliasDotKey}`] = `var(${varName})`;
      variableMap[`colors.${aliasDotKey}`] = varName;
    }
  }

  return { tokenMap, variableMap, variables, tokenDefinitions };
}

/** Rebuild a record with lexicographically sorted keys (wire determinism, G3). */
function sortRecordByKey<Value>(
  record: Record<string, Value>
): Record<string, Value> {
  const sorted: Record<string, Value> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = record[key];
  }
  return sorted;
}

/**
 * Collect the AUTHORED mode alias graph: mode name → alias dot-path → the
 * authored color dot-path (manifest v2, D6 — never a resolved value).
 * Empty when the theme has no modes or no colors, mirroring the original
 * flatten-pass guard.
 */
function collectAuthoredModeAliases(
  theme: Record<string, unknown>
): ModeAliasDefinition {
  const authored: ModeAliasDefinition = {};
  if (!isObject(theme.modes) || !isObject(theme.colors)) return authored;
  for (const [modeName, modeAliases] of Object.entries(
    theme.modes as Record<string, unknown>
  )) {
    if (!isObject(modeAliases)) continue;
    const defs: Record<string, string> = {};
    for (const [aliasDotKey, colorRef] of Object.entries(
      flattenToDotPaths(modeAliases as Record<string, unknown>)
    )) {
      if (typeof colorRef !== 'string') continue;
      defs[aliasDotKey] = colorRef;
    }
    authored[modeName] = defs;
  }
  return authored;
}

interface ModeCoverageFill {
  mode: string;
  base: string;
  count: number;
}

/**
 * D6 coverage over the merged mode set: a CONSUMER-declared mode leaving
 * inherited aliases uncovered must name a base (`basedOn`) whose chain
 * covers them — otherwise the build fails listing the uncovered set.
 * Inherited modes are exempt (a kit's own asymmetry is pre-existing
 * behavior and must round-trip byte-identically). Returns the effective
 * alias map per mode (base-chain fills + authored, authored winning) and
 * one aggregated fill report per mode for the build diagnostic.
 */
function resolveModeCoverage(
  authoredModeAliases: ModeAliasDefinition,
  modeBases: Record<string, string> | undefined,
  inheritedModes: Set<string>,
  inheritedModeAliases: Set<string>
): { effectiveModes: ModeAliasDefinition; coverageFills: ModeCoverageFill[] } {
  const effectiveModes: ModeAliasDefinition = {};
  const coverageFills: ModeCoverageFill[] = [];
  for (const modeName of Object.keys(authoredModeAliases)) {
    const authored = authoredModeAliases[modeName];
    const fills: Record<string, string> = {};
    if (!inheritedModes.has(modeName)) {
      const uncovered = [...inheritedModeAliases]
        .filter((alias) => !(alias in authored))
        .sort();
      if (uncovered.length > 0) {
        const base = modeBases?.[modeName];
        if (base === undefined) {
          throw new Error(
            `build: mode '${modeName}' leaves ${uncovered.length} inherited alias(es) uncovered and declares no base — uncovered: ${uncovered.join(', ')}. Add basedOn: { '${modeName}': '<mode>' } to addColorModes options or override every inherited alias.`
          );
        }
        const stillUncovered: string[] = [];
        for (const alias of uncovered) {
          let cursor: string | undefined = base;
          const seen = new Set<string>([modeName]);
          let resolved: string | undefined;
          while (cursor !== undefined && !seen.has(cursor)) {
            seen.add(cursor);
            resolved = authoredModeAliases[cursor]?.[alias];
            if (resolved !== undefined) break;
            cursor = modeBases?.[cursor];
          }
          if (resolved === undefined) {
            stillUncovered.push(alias);
          } else {
            fills[alias] = resolved;
          }
        }
        if (stillUncovered.length > 0) {
          throw new Error(
            `build: mode '${modeName}' resolves through base '${base}' but the chain never covers: ${stillUncovered.join(', ')}. Cover them in a chained mode or override them directly.`
          );
        }
        coverageFills.push({
          mode: modeName,
          base,
          count: Object.keys(fills).length,
        });
      }
    }
    effectiveModes[modeName] = { ...fills, ...authored };
  }
  return { effectiveModes, coverageFills };
}

/**
 * Resolve the per-mode value maps AFTER reference resolution: every mode
 * declaration carries the RESOLVED value of its target color (emitted →
 * the resolved declaration value; inlined → the resolved literal), never
 * the raw flattened string — the G2 closure for `[data-color-mode]` blocks.
 * Modes iterate in sorted name order and lines in sorted property-name
 * order, so mode declaration/insertion order is never observable (G3).
 */
function resolveModeValueMaps(
  effectiveModes: ModeAliasDefinition,
  variableMap: Record<string, string>,
  variables: Record<string, string>,
  tokenMap: Record<string, string>
): {
  modeVariables: Record<string, Record<string, string>>;
  modeTokens: Record<string, Record<string, string>>;
} {
  const modeVariables: Record<string, Record<string, string>> = {};
  const modeTokens: Record<string, Record<string, string>> = {};
  const resolvedColorValue = (colorRef: string): string => {
    const path = `colors.${colorRef}`;
    const varName = variableMap[path];
    if (varName !== undefined) {
      const declared = variables[varName];
      if (declared !== undefined) return declared;
    } else if (tokenMap[path] !== undefined) {
      return tokenMap[path];
    }
    // Unknown target: keep the authored ref string (legacy fallback; the
    // build-time alias validation rejects this for object-mode themes).
    return String(colorRef);
  };
  for (const modeName of Object.keys(effectiveModes).sort()) {
    const aliases = effectiveModes[modeName];
    const entries = Object.keys(aliases)
      .map(
        (aliasDotKey) =>
          [`--color-${dotToDash(aliasDotKey)}`, aliasDotKey] as const
      )
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const modeVars: Record<string, string> = {};
    const modeVals: Record<string, string> = {};
    for (const [varName, aliasDotKey] of entries) {
      const value = resolvedColorValue(aliases[aliasDotKey]);
      modeVars[varName] = value;
      modeVals[`colors.${aliasDotKey}`] = value;
    }
    modeVariables[modeName] = modeVars;
    modeTokens[modeName] = modeVals;
  }
  return { modeVariables, modeTokens };
}

/**
 * D5 enforcement: a reference whose target is absent from the merged map
 * AND was dropped by an explicit `addScale({ replace: true })` fails the
 * build — unconditional on usage — naming the referencing token (with its
 * positional origin), the replacement call's scale, and the dropped keys.
 * Targets never defined ANYWHERE stay warn-and-literal (supported kit
 * pattern); a re-added key is simply known again and passes.
 */
function assertNoDroppedReferences(
  tokenDefinitions: Record<string, TokenDefinition>,
  flatTokenMap: Record<string, string>,
  droppedTokenPaths: Map<string, string>,
  extendProvenance: Map<string, number>
): void {
  if (droppedTokenPaths.size === 0) return;
  const known = new Set(Object.keys(flatTokenMap));
  const violations: string[] = [];
  const droppedNamed = new Set<string>();
  for (const [tokenPath, definition] of Object.entries(tokenDefinitions)) {
    if (definition.kind !== 'reference') continue;
    for (const reference of definition.references) {
      if (known.has(reference.path)) continue;
      const scale = droppedTokenPaths.get(reference.path);
      if (scale === undefined) continue;
      const provenanceIndex = extendProvenance.get(tokenPath);
      const origin =
        provenanceIndex === undefined
          ? 'builder state'
          : `extended theme #${provenanceIndex}`;
      violations.push(
        `'${tokenPath}' (${origin}) references '{${reference.path}}', dropped by addScale({ name: '${scale}', replace: true })`
      );
      droppedNamed.add(reference.path);
    }
  }
  if (violations.length > 0) {
    throw new Error(
      `build: dangling token reference(s) after explicit scale replacement — ${violations.join(
        '; '
      )}. Dropped keys: ${[...droppedNamed].sort().join(', ')}.`
    );
  }
}

/** A resolved value still carrying a `{…}` reference — never shippable (G2). */
const UNRESOLVED_REF_RE = /\{[^}]+\}/;

/**
 * Split root and mode variable maps into shippable declarations and omitted
 * var names (G2): any value still containing `{…}` after resolution — a
 * direct or TRANSITIVE never-defined target — is withheld from emitted CSS.
 */
function omitUnresolvedDeclarations(
  variables: Record<string, string>,
  modeVariables: Record<string, Record<string, string>>
): {
  emittableVariables: Record<string, string>;
  emittableModeVariables: Record<string, Record<string, string>>;
  omitted: string[];
} {
  const omitted: string[] = [];
  const emittableVariables: Record<string, string> = {};
  for (const [varName, value] of Object.entries(variables)) {
    if (UNRESOLVED_REF_RE.test(value)) {
      omitted.push(varName);
    } else {
      emittableVariables[varName] = value;
    }
  }
  const emittableModeVariables: Record<string, Record<string, string>> = {};
  for (const [modeName, modeVars] of Object.entries(modeVariables)) {
    const kept: Record<string, string> = {};
    for (const [varName, value] of Object.entries(modeVars)) {
      if (UNRESOLVED_REF_RE.test(value)) {
        omitted.push(`${varName} ([data-color-mode="${modeName}"])`);
      } else {
        kept[varName] = value;
      }
    }
    emittableModeVariables[modeName] = kept;
  }
  return { emittableVariables, emittableModeVariables, omitted };
}

/**
 * Classify a RAW token value into its authored form (manifest v2, D6). MUST
 * run before `resolveReferences` — resolution rewrites the string, and the
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
  emittedScales: string[];
  modeAliasDefinitions: ModeAliasDefinition;
  initialMode: string | undefined;
  registrations: Record<string, ContextualVarRegistration>;
  systemPreference: SystemPreferenceConfig | undefined;
  browserColorScheme: BrowserColorSchemeConfig | undefined;
  /** D6 mode bases — absent (dropped by JSON) for themes without them. */
  modeBases: Record<string, string> | undefined;
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
