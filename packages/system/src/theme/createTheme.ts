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

function isValidCSSColor(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (v === '') return false;

  if (v === 'transparent' || v === 'currentColor' || v === 'currentcolor')
    return true;

  if (
    v.startsWith('#') &&
    /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)
  )
    return true;

  for (const prefix of COLOR_FUNCTION_PREFIXES) {
    if (v.startsWith(prefix) && v.endsWith(')')) return true;
  }

  // Named colors pass unvalidated — the browser is the authority.
  if (/^[a-zA-Z]+$/.test(v)) return true;

  return false;
}

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
 * The system preference is the ABSENCE of `data-color-mode`; a mode named
 * `system` would defeat the `:root:not([data-color-mode])` guard.
 */
const RESERVED_MODE_NAME = 'system';

/**
 * `satisfies` proves each entry is a structural key, not that the list is
 * complete: a new `ThemeStructuralKey` must be added here by hand.
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

/** OS-preference axis → the `color-scheme` a mode mapped to it must carry. */
const MAPPING_FORCED_SCHEMES = [
  ['light', 'light'],
  ['dark', 'dark'],
] as const;

/**
 * `undefined` when neither side supplied one, so an unconfigured theme never
 * gains the key.
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
 * Fills mapping-named modes with their forced schemes, then validates. Takes
 * the MERGED mode set: a later declaration can un-total a carried map.
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

  // A partial map lets an explicit mode inherit the previous mode's
  // browser-native scheme.
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
 * Validates against the MERGED mode set: composition merges modes without
 * passing through `addColorModes`, so `build()` runs this again.
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

function validateColors(colors: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(colors)) {
    if (isObject(value)) {
      validateColors(value as Record<string, unknown>);
    } else if (!isValidCSSColor(value)) {
      throw new Error(
        `addColors: '${String(value)}' is not a valid CSS <color> value for key '${key}'. ` +
          `Expected hex (#fff), rgb(), hsl(), oklch(), named color, transparent, or currentColor.`
      );
    }
  }
}

/** Identity mapping that caches the type, preventing TS2589 depth growth. */
export type Flatten<T> = { [K in keyof T]: T[K] };

type MergeRecord<Base, Incoming> = Omit<Base, keyof Incoming> & Incoming;

/**
 * Var NAMES across all scales. Derives from the already-inferred `Vars`, so it
 * never feeds back into inference or perturbs literal-key narrowing.
 */
type ContextualVarNames<Vars> = {
  [K in keyof Vars]: Vars[K] extends readonly (infer N extends string)[]
    ? N
    : never;
}[keyof Vars];

type ThemeScaleKeys<T> = Exclude<keyof T & string, ThemeStructuralKey>;

/** Theme data plus boundary members, non-enumerable at runtime. */
type BuiltTheme<T, Emitted extends string> = {
  [K in keyof T]: T[K];
} & {
  /** Tuple wrapper prevents never-distribution. Non-enumerable at runtime. */
  readonly __emitted: [Emitted];
  manifest: ThemeManifest;
  serialize(): SerializedTheme;
  /** Dot-path token → `var()` ref, or the raw value if not emitted. */
  varRef(tokenPath: string): string | undefined;
};

/**
 * Manifest fields carried through the explicit manifest read — the manifest is
 * non-enumerable. Read-only: `build()` regenerates every fragment.
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

interface BuilderState {
  theme: Record<string, unknown>;
  emittedScales: Set<string>;
  contextualVars: Map<string, string[]>;
  /**
   * Keyed by contextual var NAME, not the `--` custom property. Kept out of
   * `contextualVars` so the extractor's names-only registry keeps its shape.
   */
  contextualVarRegistrations: Map<string, ContextualVarRegistration>;
  carriedManifestV2?: CarriedManifestV2;
  /**
   * A source manifest without the v2 discriminant: the authored graph is
   * unknowable, so `build()` suppresses all v2 fields instead of fabricating.
   */
  hasLegacyManifestSource: boolean;
  /**
   * Flattened leaf path → 1-based index of the `extend()` call that first
   * defined it; sibling conflicts name both sources by that index.
   */
  extendProvenance: Map<string, number>;
  extendCount: number;
  /**
   * Mode names carried in by `extend()`. Exempt from the coverage gate — a
   * kit's own alias asymmetry must round-trip unchanged.
   */
  inheritedModes: Set<string>;
  /**
   * Alias dot-paths from extended sources: a consumer-declared mode must cover
   * them or name a base.
   */
  inheritedModeAliases: Set<string>;
  /**
   * Token path dropped by `addScale({ replace: true })` → the replaced scale.
   * A reference to one that is never re-added fails `build()`.
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
    // Sharing the inner records is safe: carried manifest data is read-only.
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
 * Leaf-path flatten WITHOUT the `_` identity collapse, so a leaf and a branch
 * can never share a spelling and a prefix relation is a real divergence.
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
 * `merge` adopts and MUTATES nested source objects, so every builder step deep
 * copies first: a consumed kit's theme and prior state must survive intact.
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

function plainDataEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length &&
      a.every((item, index) => plainDataEqual(item, b[index]))
    );
  }
  if (isObject(a) && isObject(b)) {
    const aRecord = a as Record<string, unknown>;
    const bRecord = b as Record<string, unknown>;
    const aKeys = Object.keys(aRecord);
    return (
      aKeys.length === Object.keys(bRecord).length &&
      aKeys.every(
        (key) =>
          Object.prototype.hasOwnProperty.call(bRecord, key) &&
          plainDataEqual(aRecord[key], bRecord[key])
      )
    );
  }
  return false;
}

type ThemeSourceOf<Source> = Source extends {
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

type ThemeBoundaryKey = '__emitted' | 'manifest' | 'serialize' | 'varRef';

type ThemeDataOf<Source> = {
  [
    Key in keyof Source as Key extends ThemeBoundaryKey
      ? never
      : Extract<Source[Key], (...args: never[]) => unknown> extends never
        ? Key
        : never
  ]: Source[Key];
};

type MergeThemeData<Base, Source> = Flatten<
  MergeRecord<Base, ThemeDataOf<Source>>
>;

type EmittedThemeScalesOf<Source> = Source extends {
  readonly __emitted: [infer Emitted extends string];
}
  ? Emitted
  : never;

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
 * Phantom builder stage: `extend()` is callable only while `'inherit'`, and
 * every augmentation method advances to `'extend'`. `from()` is not gated.
 */
export type ThemeBuilderStage = 'inherit' | 'extend';

/**
 * Re-seeds emitted scales, contextual vars and the manifest-v2 carry from a
 * source manifest — non-enumerable, so key-copy loops never see it.
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
    // Treating a synthetic color-mode alias path as emission evidence would
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
      // Carried registrations become live state again, so an unmutated
      // rebuild re-emits identical @property rules.
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
      // v1 manifest: the authored structure is unknowable — fail closed.
      state.hasLegacyManifestSource = true;
    }
  }
}

export class ThemeBuilder<
  T extends Record<string, unknown> = Record<string, unknown>,
  Emitted extends string = never,
  Stage extends ThemeBuilderStage = 'inherit',
> {
  // Without a member referencing Stage, 'inherit' and 'extend' builders are
  // mutually assignable and the `this`-typed `extend()` gate never fires.
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
    const nextTheme = merge(deepCopyPlain(this._state.theme), { breakpoints });
    // Omit replaces EmptyTheme's Record<string, number> with literal keys; the
    // index signature would otherwise widen keyof breakpoints to string.
    type Merged = Omit<T, 'breakpoints'> &
      Record<'breakpoints', { [K in keyof BP]: BP[K] }>;
    type Next = { [K in keyof Merged]: Merged[K] };
    return new ThemeBuilder<Next, Emitted, 'extend'>(
      copyState(this._state, nextTheme)
    );
  }

  // `Source extends object`, not `Record<string, unknown>`: interface-typed
  // values have no index signature and must still be accepted.
  /**
   * Source-WINS precedence over prior builder state, callable at any stage.
   * @deprecated Use `extend(source)` — the source seeds the base, local wins.
   */
  from<Source extends object>(builtTheme: Source) {
    // The bundle guard keys on `system.toConfig` being callable, so a theme
    // with a scale named `system` cannot match.
    const source: Record<string, unknown> = isLibraryBundle(builtTheme)
      ? (((builtTheme as { theme?: unknown }).theme ??
          (builtTheme as { tokens?: unknown }).tokens ??
          {}) as Record<string, unknown>)
      : (builtTheme as Record<string, unknown>);

    const raw: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      const val = source[key];
      if (typeof val !== 'function') {
        raw[key] = val;
      }
    }
    const nextTheme = merge(
      deepCopyPlain(this._state.theme),
      deepCopyPlain(raw)
    );
    const next = new ThemeBuilder<
      MergeThemeData<T, ThemeSourceOf<Source>>,
      Emitted | EmittedThemeScalesOf<ThemeSourceOf<Source>>,
      Stage
    >(copyState(this._state, nextTheme));

    reseedStateFromManifest(
      next._state,
      (source as { manifest?: ThemeManifest }).manifest
    );
    return next;
  }

  /**
   * Inherits a built theme or library bundle as the BASE; local calls after
   * `extend()` win, and leaves that two sources define divergently throw.
   */
  extend<Source extends object>(
    this: ThemeBuilder<T, Emitted, 'inherit'>,
    source: Source
  ): ThemeBuilder<
    MergeThemeData<T, ExtendedThemeSourceOf<Source>>,
    Emitted | EmittedThemeScalesOf<ExtendedThemeSourceOf<Source>>,
    'inherit'
  > {
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

    // Inherit-first guarantees the current state is the fold of prior extends,
    // so a provenance hit means another extended source owns the leaf.
    const sourceIndex = this._state.extendCount + 1;
    const provenance = new Map(this._state.extendProvenance);
    const existingLeaves = flattenLeafPathsExact(this._state.theme);
    const incomingLeaves = flattenLeafPathsExact(raw);
    // Strict dot-prefixes of tracked leaves → that leaf's source index. Built
    // before this source's paths are admitted, so its own leaves are exempt.
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
        // Structural, not reference, equality: arrays are leaves and state
        // holds deep copies, so `!==` would never coalesce an array token.
        if (!plainDataEqual(existing, value)) {
          throw new Error(
            `extend: path '${path}' is defined divergently by extended theme #${priorIndex} (${JSON.stringify(existing)}) and extended theme #${sourceIndex} (${JSON.stringify(value)}). Sibling themes must agree — override intentionally with an add* call after extend().`
          );
        }
        continue;
      }
      const branchIndex = trackedPrefixes.get(path);
      if (branchIndex !== undefined) {
        throw new Error(
          `extend: path '${path}' is defined divergently by extended theme #${branchIndex} (a nested branch) and extended theme #${sourceIndex} (a leaf value). Sibling themes must agree — override intentionally with an add* call after extend().`
        );
      }
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

    // Base-then-local-wins: the source is the merge target and prior builder
    // state folds over it.
    const nextTheme = merge(
      deepCopyPlain(raw),
      deepCopyPlain(this._state.theme)
    );
    const next = new ThemeBuilder<
      MergeThemeData<T, ExtendedThemeSourceOf<Source>>,
      Emitted | EmittedThemeScalesOf<ExtendedThemeSourceOf<Source>>,
      'inherit'
    >(copyState(this._state, nextTheme));
    next._state.extendProvenance = provenance;
    next._state.extendCount = sourceIndex;

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
    // The generic default resolves LiteralPaths ONCE and binds the result;
    // downstream methods see a flat Record instead of re-deriving it.
    NextColors extends LiteralPaths<Colors, '.'> = LiteralPaths<Colors, '.'>,
  >(colors: Colors) {
    validateColors(colors as Record<string, unknown>);
    const nextTheme = merge(deepCopyPlain(this._state.theme), { colors });
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
    // One eval of the alias paths; the '_' base param collapses identity keys:
    // { _: 'x', hover: 'y' } → 'primary' | 'primary.hover'.
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
    // MERGED mode set: modes declared by an earlier call or carried in by
    // composition are legal targets for this call's options.
    const existingModes = isObject(this._state.theme.modes)
      ? (this._state.theme.modes as Record<string, unknown>)
      : {};
    const modeNames = Object.keys({ ...existingModes, ...modeConfig });

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

    // Fail-fast only: what gets STORED is the raw merged map, so a later
    // `systemPreference` remap cannot inherit synthesized entries.
    const systemPreference = mergeOptionObject<SystemPreferenceConfig>(
      this._state.theme.systemPreference,
      options?.systemPreference
    );
    const browserColorScheme = mergeOptionObject<BrowserColorSchemeConfig>(
      this._state.theme.browserColorScheme,
      options?.browserColorScheme
    );
    resolveColorModeOptions(modeNames, systemPreference, browserColorScheme);
    const modeBases = mergeOptionObject<Record<string, string>>(
      this._state.theme.modeBases,
      options?.basedOn
    );
    validateModeBases(modeNames, modeBases);

    const nextTheme = merge(deepCopyPlain(this._state.theme), {
      modes: modeConfig,
      mode: initialMode,
      // Only stored when supplied — an unconfigured theme gains no new keys.
      ...(systemPreference ? { systemPreference } : {}),
      ...(browserColorScheme ? { browserColorScheme } : {}),
      ...(modeBases ? { modeBases } : {}),
    });

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
      // Wholesale replacement: the scale becomes EXACTLY these values. The
      // default form merges by key, so implicit deletion stays impossible.
      nextTheme = deepCopyPlain(this._state.theme);
      nextTheme[name] = values;
    } else {
      nextTheme = merge(deepCopyPlain(this._state.theme), {
        [name]: values,
      });
    }
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
    // A SEPARATE parameter, not folded into `vars`, so the literal-key
    // narrowing of `Vars` is identical whether or not it is passed.
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

    // Phantom keys: present in the type, never in the runtime theme object.
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
    const nextTheme = merge(deepCopyPlain(this._state.theme), {
      [key]: updateFn(this._state.theme[key as string] as T[Key]),
    });
    type NextScale = Flatten<MergeRecord<T[Key], ReturnType<Fn>>>;
    type Next = Flatten<Omit<T, Key> & Record<Key, NextScale>>;
    return new ThemeBuilder<Next, Emitted, 'extend'>(
      copyState(this._state, nextTheme)
    );
  }

  build(): BuiltTheme<T, Emitted> {
    // A full snapshot: the built theme must never change when the builder
    // (or a branch of it) keeps being augmented.
    const theme = deepCopyPlain(this._state.theme) as Record<string, unknown>;
    const emittedScales = this._state.emittedScales;
    const contextualVars = this._state.contextualVars;

    // Authoritative gate: composition merges modes and options without passing
    // through `addColorModes`. The map resolved here feeds emission.
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

    // Composition and an explicit colors replacement can invalidate aliases
    // `addColorModes` accepted; only the merged map here is final.
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

    const modeAliasDefinitions = collectAuthoredModeAliases(theme);
    const { effectiveModes, coverageFills } = resolveModeCoverage(
      modeAliasDefinitions,
      modeBases,
      this._state.inheritedModes,
      this._state.inheritedModeAliases
    );
    for (const fill of coverageFills) {
      // One aggregated diagnostic per mode — never per-token spam.
      // oxlint-disable-next-line no-console -- intentional runtime diagnostic
      console.info(
        `[animus] Mode '${fill.mode}': ${fill.count} alias(es) inherit from '${fill.base}'`
      );
    }

    const {
      tokenMap: flatTokenMap,
      variableMap,
      variables: flatVariables,
      tokenDefinitions,
    } = flattenTheme(theme, emittedScales, effectiveModes);

    assertNoDroppedReferences(
      tokenDefinitions,
      flatTokenMap,
      this._state.droppedTokenPaths,
      this._state.extendProvenance
    );

    // Late-binding resolution over the COMPLETE maps: references inside
    // emitted scales resolve into declarations, and both maps come back sorted.
    const { tokenMap, variables } = resolveReferences(
      flatTokenMap,
      variableMap,
      flatVariables
    );

    const { modeVariables, modeTokens } = resolveModeValueMaps(
      effectiveModes,
      variableMap,
      variables,
      tokenMap
    );

    // Sorted by property name so reversed declarations emit byte-identically.
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

    let contextualVarsSerialized: Record<string, string[]> | undefined;
    if (contextualVars.size > 0) {
      contextualVarsSerialized = {};
      for (const [scale, vars] of contextualVars) {
        contextualVarsSerialized[scale] = vars;
      }
    }

    // `@property` rules are unlayered and ride at the head of the variables
    // part, landing before the `@layer` declaration. No metadata ⇒ ''.
    const propertyCss = buildPropertyRegistrationCss(
      contextualVars,
      this._state.contextualVarRegistrations
    );
    // The token map keeps the unresolved literal; only the CSS omits it.
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

    // Metadata only: `cssFragments` RECORDS the strings composed above and is
    // never the source of `variableCss`.
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
          // Mode bases change emitted coverage, so they belong in the digest.
          // `undefined` drops from JSON, so bases-free themes keep their hash.
          modeBases,
        }),
        cssFragments,
      };
    }

    // `variableMapJson` and the breakpoint tail of `scalesJson` must be
    // byte-identical under reversed declarations.
    const sortedVariableMap = sortRecordByKey(variableMap);
    const manifest: ThemeManifest = {
      tokenMap: {
        ...tokenMap,
        // The Rust crate reads breakpoints out of tokenMap.
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
      ...(systemPreference ? { systemPreference } : {}),
      ...(browserColorScheme ? { browserColorScheme } : {}),
      ...manifestV2Fields,
    };

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

/** Authored token reference: `{scale.key}` or `{scale.key/opacity}`. */
const TOKEN_REF_RE = /\{([^}]+)\}/g;

/**
 * The only flatten pass: nested theme → dot-path token map and variable
 * declarations. Mode value maps resolve later, after `resolveReferences`.
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
  // The authored graph, captured BEFORE `resolveReferences` rewrites values:
  // it cannot be inferred back from resolved CSS.
  const tokenDefinitions: Record<string, TokenDefinition> = {};

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

  // The EFFECTIVE alias set (authored + base-chain fills) is used, so a
  // partially covered initial mode still declares every alias.
  const initialMode = theme.mode as string;
  const initialAliases =
    typeof initialMode === 'string' ? effectiveModes[initialMode] : undefined;
  if (initialAliases) {
    for (const [aliasDotKey, colorRef] of Object.entries(initialAliases)) {
      const dashAlias = dotToDash(aliasDotKey);
      const varName = `--color-${dashAlias}`;
      const paletteVarName = variableMap[`colors.${colorRef}`];
      if (paletteVarName) {
        // An alias may share its palette target's path; a self-referencing
        // declaration would replace the real one.
        if (paletteVarName !== varName) {
          variables[varName] = `var(${paletteVarName})`;
        }
      } else {
        // Non-emitted palettes still need a concrete semantic declaration.
        const literal = tokenMap[`colors.${colorRef}`];
        if (literal !== undefined) variables[varName] = literal;
      }
      tokenMap[`colors.${aliasDotKey}`] = `var(${varName})`;
      variableMap[`colors.${aliasDotKey}`] = varName;
    }
  }

  return { tokenMap, variableMap, variables, tokenDefinitions };
}

/** Sorted-key rebuild — the serialized wire must not expose insertion order. */
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
 * The AUTHORED alias graph: mode → alias dot-path → authored color dot-path,
 * never a resolved value.
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
 * A CONSUMER-declared mode leaving inherited aliases uncovered must name a
 * base whose chain covers them; inherited modes are exempt.
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
 * Per-mode declarations carry the RESOLVED value of their target color, never
 * the raw flattened string. Modes and lines sort, hiding authoring order.
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
    // Unknown target: keep the authored ref string. Build-time alias
    // validation rejects this for object-mode themes.
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
 * A reference to a target dropped by `addScale({ replace: true })` fails the
 * build. Targets never defined anywhere stay warn-and-literal.
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

/** A resolved value still carrying a `{…}` reference — never shippable. */
const UNRESOLVED_REF_RE = /\{[^}]+\}/;

const VAR_REF_NAME_RE = /var\(\s*(--[\w-]+)/g;

function varRefNames(value: string): string[] {
  const names: string[] = [];
  for (const match of value.matchAll(VAR_REF_NAME_RE)) {
    names.push(match[1]);
  }
  return names;
}

/**
 * Withholds any declaration whose value still contains `{…}`, then — to a
 * fixpoint — any whose `var()` target was withheld everywhere it can see.
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
  const droppedRoot = new Set<string>();
  for (const [varName, value] of Object.entries(variables)) {
    if (UNRESOLVED_REF_RE.test(value)) {
      omitted.push(varName);
      droppedRoot.add(varName);
    } else {
      emittableVariables[varName] = value;
    }
  }
  let rootChanged = true;
  while (rootChanged) {
    rootChanged = false;
    for (const [varName, value] of Object.entries(emittableVariables)) {
      if (varRefNames(value).some((name) => droppedRoot.has(name))) {
        delete emittableVariables[varName];
        droppedRoot.add(varName);
        omitted.push(varName);
        rootChanged = true;
      }
    }
  }

  const emittableModeVariables: Record<string, Record<string, string>> = {};
  for (const [modeName, modeVars] of Object.entries(modeVariables)) {
    const kept: Record<string, string> = {};
    const droppedInMode = new Set<string>();
    const dropFromMode = (varName: string): void => {
      omitted.push(`${varName} ([data-color-mode="${modeName}"])`);
      droppedInMode.add(varName);
    };
    for (const [varName, value] of Object.entries(modeVars)) {
      if (UNRESOLVED_REF_RE.test(value)) {
        dropFromMode(varName);
      } else {
        kept[varName] = value;
      }
    }
    // A mode declaration's var() target resolves through the same block or
    // :root; withheld from both means dangling for this mode.
    const dangling = (name: string): boolean =>
      (droppedInMode.has(name) || droppedRoot.has(name)) &&
      !(name in kept) &&
      !(name in emittableVariables);
    let modeChanged = true;
    while (modeChanged) {
      modeChanged = false;
      for (const [varName, value] of Object.entries(kept)) {
        if (varRefNames(value).some(dangling)) {
          delete kept[varName];
          dropFromMode(varName);
          modeChanged = true;
        }
      }
    }
    emittableModeVariables[modeName] = kept;
  }
  return { emittableVariables, emittableModeVariables, omitted };
}

/**
 * Classifies a RAW token value into its authored form. `matchAll` keeps the
 * shared global {@link TOKEN_REF_RE} from carrying a stale `lastIndex`.
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

/**
 * Version of the CSS emitter that composed a manifest's fragments. Bump when
 * any emitted byte changes for the same authored input.
 */
const EMITTER_VERSION = 1;

/**
 * Keys sort at every depth so the digest ignores insertion order; arrays keep
 * authored order, which is contractual.
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

/** The slice of `node:crypto` the hash needs, without importing it. */
interface MinimalHash {
  update(data: string): MinimalHash;
  digest(encoding: 'hex'): string;
}

/**
 * Reached through `process.getBuiltinModule` so this module gains no static
 * `node:crypto` import edge — built themes run inside client bundles.
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
 * UTF-8 bytes without `TextEncoder`: the Rust system-loader evaluates this
 * bundle in QuickJS, which provides ES built-ins only.
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
 * Pure SHA-256 (FIPS 180-4), the non-Node fallback for {@link sha256Hex}. Not
 * a security surface — the contract hash is a content digest only.
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

interface ContractHashInput {
  tokenDefinitions: Record<string, TokenDefinition>;
  emittedScales: string[];
  modeAliasDefinitions: ModeAliasDefinition;
  initialMode: string | undefined;
  registrations: Record<string, ContextualVarRegistration>;
  systemPreference: SystemPreferenceConfig | undefined;
  browserColorScheme: BrowserColorSchemeConfig | undefined;
  modeBases: Record<string, string> | undefined;
}

/** Identical authored input ⇒ identical hash, across processes. */
function computeContractHash(input: ContractHashInput): string {
  return sha256Hex(JSON.stringify(canonicalize(input)));
}

/**
 * `@property` rules for registered contextual vars, emitted as `--${name}` —
 * the name the Rust resolver maps a bare contextual var to. `''` when none.
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

interface SystemEmissionConfig {
  initialMode?: string;
  systemPreference?: SystemPreferenceConfig;
  browserColorScheme?: BrowserColorSchemeConfig;
}

function buildVariableCss(
  rootVariables: Record<string, string>,
  breakpointVariables: Record<string, string>,
  modeVariables: Record<string, Record<string, string>>,
  systemEmission: SystemEmissionConfig = {}
): string {
  const { initialMode, systemPreference, browserColorScheme } = systemEmission;
  const parts: string[] = [];

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

  // These follow `:root` so they override the initial mode, and the
  // `:not([data-color-mode])` guard lets an explicit attribute win in CSS.
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
