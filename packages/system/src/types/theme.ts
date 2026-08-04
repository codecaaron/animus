import type { LiteralPaths } from '../theme/flattenScale';

export type { CSSObject } from './shared';

export interface BaseTheme {}

export interface AbstractTheme extends BaseTheme {
  breakpoints: Record<string, number>;
  readonly [key: string]: any;
}

/**
 * Filter non-scale keys from T so only user-defined scales appear.
 * Builder/runtime metadata and color-mode options are structural — not token
 * scales.
 */
export type ThemeStructuralKey =
  | 'breakpoints'
  | 'modes'
  | 'mode'
  | 'systemPreference'
  | 'browserColorScheme'
  | 'modeBases'
  | '__emitted'
  | 'manifest'
  | 'serialize'
  | 'varRef';

export type TokenScales<T> = Omit<T, ThemeStructuralKey>;

/**
 * Augmentable Theme interface. Consumers extend this via module augmentation
 * to get type-safe scale lookups in .styles(), .variant(), and .states():
 *
 * ```ts
 * declare module '@animus-ui/system' {
 *   export interface Theme extends ShowcaseTheme {}
 * }
 * ```
 *
 * When augmented, CSS object values like `fontSize` become constrained to
 * the theme's scale keys (e.g. `11 | 12 | 13 | 14 | 16 | ...`).
 * When NOT augmented, values fall back to standard CSS property types.
 *
 * BaseTheme uses an open index signature so that module augmentation can
 * provide a concrete breakpoints type (e.g. `{ sm: number; lg: number }`)
 * without conflicting with a fixed Breakpoints interface.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Theme extends BaseTheme {}

/**
 * CSS <color> value type constraint for addColors().
 * Template literal arms provide autocomplete for common formats.
 * (string & {}) escape hatch allows future CSS color functions without blocking.
 */
export type CSSColorValue =
  | `#${string}`
  | `rgb(${string})`
  | `rgba(${string})`
  | `hsl(${string})`
  | `hsla(${string})`
  | `oklch(${string})`
  | `oklab(${string})`
  | `lch(${string})`
  | `lab(${string})`
  | `color-mix(${string})`
  | `color(${string})`
  | 'transparent'
  | 'currentColor'
  | (string & {});

/**
 * Extract scale names from a built theme that were emitted with CSS variables.
 * Primary path: reads the __emitted phantom tuple from BuiltTheme.
 * Fallback: 'colors' hardcoded as always-emitted (for augmented Theme interfaces without phantom).
 */
export type EmittedScales<T> = T extends { __emitted: [infer E extends string] }
  ? E & keyof TokenScales<T>
  : 'colors' extends keyof TokenScales<T>
    ? 'colors'
    : never;

/**
 * All valid token ref paths for emitted scales in a theme.
 * Uses LiteralPaths to enumerate `scale.key` paths from emitted scale entries.
 *
 * ```ts
 * type Refs = EmittedTokenPaths<typeof tokens>;
 * // → 'colors.primary' | 'colors.bg' | 'sizes.navHeight' | ...
 * ```
 */
export type EmittedTokenPaths<T> = keyof LiteralPaths<
  Pick<TokenScales<T>, EmittedScales<T>>,
  '.'
>;

/**
 * Token ref pattern type for referencing emitted scales.
 * Constrains the scale name portion of `{scale.key}` to only emitted scales.
 */
export type ScaleTokenRef<E extends string> =
  `${string}{${E}.${string}}${string}`;

/**
 * Token ref union for color-scale values, computed from the augmented Theme.
 * Accepts `{colors.key}` and `{colors.key/alpha}` patterns.
 *
 * ```ts
 * const ref: ColorTokenRef = '{colors.primary/50}'; // ✓
 * ```
 */
export type ColorTokenRef = Theme extends { colors: infer C }
  ? C extends Record<string, unknown>
    ?
        | `{colors.${Extract<keyof C, string>}}`
        | `{colors.${Extract<keyof C, string>}/${number}}`
    : never
  : never;

/**
 * Optional `@property` registration metadata for a contextual var.
 * A 1:1 mirror of the CSS `@property` descriptors — `initialValue` (never bare
 * `initial`, which collides with the CSS-wide keyword). Supplied alongside the
 * contextual var declaration; purely additive — it does NOT alter the phantom
 * typing of the declared var names or the runtime theme object.
 */
export interface ContextualVarRegistration {
  /** CSS `syntax` descriptor, e.g. `'<color>'` or `'*'`. Emitted quoted. */
  syntax: string;
  /** CSS `inherits` descriptor. */
  inherits: boolean;
  /** CSS `initial-value` descriptor. Omitted from output when absent. */
  initialValue?: string;
}

/**
 * OS `prefers-color-scheme` → declared mode name mapping.
 * Presence of this config on a theme enables guarded system-fallback emission
 * (`@media (prefers-color-scheme: …) { :root:not([data-color-mode]) { … } }`).
 * Both values MUST name declared modes; the reserved name `system` is rejected
 * (system is modeled as the ABSENCE of `data-color-mode`).
 */
export interface SystemPreferenceConfig {
  /** Mode applied when the OS reports a light preference. */
  light: string;
  /** Mode applied when the OS reports a dark preference. */
  dark: string;
}

/**
 * Declared mode name → CSS `color-scheme` classification. When supplied it MUST
 * be total across declared modes and agree with {@link SystemPreferenceConfig}.
 */
export type BrowserColorSchemeConfig = Record<
  string,
  'light' | 'dark' | 'normal'
>;

/**
 * Optional system-participation options accepted by `addColorModes`.
 *
 * Typed LOCALLY from the mode config's own keys (D1) — the mode-name union is
 * deliberately NOT threaded through the builder-chain generics, so this adds no
 * depth to the type-state machine (TS2589 discipline).
 */
export interface ColorModeOptions<Config> {
  /** OS preference → declared mode name. Enables guarded system emission. */
  systemPreference?: {
    light: keyof Config & string;
    dark: keyof Config & string;
  };
  /**
   * Declared mode name → CSS `color-scheme`. Totality is enforced at build
   * time, with one carve-out: the two modes named by `systemPreference` are
   * FORCED to `light`/`dark` by the conflict rule anyway, so they default to
   * those values and may be omitted — `browserColorScheme: {}` is the whole
   * opt-in for a two-mode theme. Every mode NOT named by the mapping must be
   * classified explicitly (a build error otherwise); an explicit value on a
   * mapped mode is honored and still conflict-checked.
   *
   * Typed `Partial` for exactly that reason — compile-time totality would
   * re-demand the forced entries. Runtime validation covers JS callers,
   * casts, and `from()` composition, which all reach `build()` without this
   * type applying.
   */
  browserColorScheme?: Partial<
    Record<keyof Config & string, 'light' | 'dark' | 'normal'>
  >;
  /**
   * NEW mode → the declared mode its uncovered INHERITED aliases resolve
   * through (D6, first-class-extension). A consumer-declared mode over an
   * extended theme that leaves inherited aliases uncovered must name a base
   * here — the build fails otherwise, listing the uncovered set; with a
   * base, uncovered aliases resolve through the declared chain and the
   * build reports ONE aggregated inherited-alias count per mode.
   *
   * The base value is a plain `string` (not `keyof Config`) on purpose: the
   * base is typically a mode declared by the EXTENDED source, which this
   * call's local config type cannot see. Runtime validation covers both
   * sides against the merged mode set.
   */
  basedOn?: Partial<Record<keyof Config & string, string>>;
}

/** Pipeline-ready JSON strings returned by `.serialize()` on a built theme. */
export interface SerializedTheme {
  /** Flattened token map as JSON: { "space.8": "0.5rem", "breakpoints.sm": "768" } */
  scalesJson: string;
  /** Token path → CSS variable name as JSON: { "colors.primary": "--colors-primary" } */
  variableMapJson: string;
  /** Pre-built CSS string with :root and [data-color-mode] blocks */
  variableCss: string;
  /** Contextual vars registry as JSON: { "colors": ["background-current"] } */
  contextualVarsJson: string;
}

/**
 * One authored `{scale.key}` reference occurrence inside a token value
 * (manifest v2, D6). Captured BEFORE `resolveReferences` rewrites the value —
 * the authored graph is unrecoverable from resolved CSS (D8).
 */
export interface TokenReference {
  /** The referenced dot-path exactly as authored, e.g. 'colors.blue.500'. */
  path: string;
  /**
   * The authored opacity-modifier text when written `{path/NN}` (e.g. '50').
   * Kept as the authored string — parsing to a number is an emission-time
   * concern, not a capture-time one.
   */
  opacity?: string;
}

/**
 * The AUTHORED form of one token value (manifest v2, D6):
 * - `literal` — the value contains no `{scale.key}` refs.
 * - `reference` — the value embeds one or more refs; `value` preserves the
 *   authored string byte-exactly and `references` lists each ref target in
 *   authored order.
 * Flat shapes only (D11) — no recursive or conditional re-derivation.
 */
export type TokenDefinition =
  | { kind: 'literal'; value: string }
  | { kind: 'reference'; value: string; references: TokenReference[] };

/**
 * Pre-resolution mode alias definitions (manifest v2, D6): mode name → alias
 * dot-path → the AUTHORED color dot-path (the `colorRef` string, e.g.
 * 'gray.300' — never its resolved raw value).
 */
export type ModeAliasDefinition = Record<string, Record<string, string>>;

/**
 * One CSS fragment recorded by `build()` (manifest v2, D6) — the EXACT string
 * it composed. In this manifest version the fragments RECORD the composed
 * strings; `variableCss` is still composed independently (the
 * fragment→variableCss projection becomes load-bearing with the CSS wire
 * plan).
 */
export interface ThemeCssFragment {
  /** Stable fragment identifier (currently mirrors `kind`). */
  id: string;
  /** Semantic section: `@property` registrations vs the base variable CSS. */
  kind: 'registrations' | 'base';
  /** The exact composed CSS string — byte-identical to what build() joined. */
  cssText: string;
}

/** Structured manifest emitted by ThemeBuilder.build() for plugin consumption. */
export interface ThemeManifest {
  /** Flat token key → raw value (e.g. 'space.8' → '0.5rem', 'colors.ember' → '#FF2800') */
  tokenMap: Record<string, string>;
  /** Flat token key → CSS variable name without var() wrapper (e.g. 'colors.ember' → '--color-ember') */
  variableMap: Record<string, string>;
  /**
   * Mode name → flat key → RESOLVED value (e.g. { dark: { 'colors.primary':
   * '#FF2800' } }). Since first-class-extension inc 04 the values pass
   * through the reference resolver (a reference-valued color contributes its
   * resolved value, never a raw `{…}` string), and both mode keys and inner
   * keys are in sorted order (G3).
   */
  modes: Record<string, Record<string, string>>;
  /** Pre-built CSS string with :root and [data-color-mode] blocks */
  variableCss: string;
  /** Contextual vars registry: scale_name → [var_name] for --current-{name} side-effects */
  contextualVars?: Record<string, string[]>;
  /** OS preference → mode mapping, when the theme opted into system emission */
  systemPreference?: SystemPreferenceConfig;
  /** Mode → CSS `color-scheme` classification, when the theme opted in */
  browserColorScheme?: BrowserColorSchemeConfig;
  // ── Manifest v2 (D6) ──────────────────────────────────────
  // Every field below is OPTIONAL in the type — a v1 manifest must still
  // typecheck and round-trip — but PRESENT on every newly built theme. A
  // from() source carrying only a v1 manifest round-trips with NONE of them
  // (D8: never fabricate the authored graph from resolved values).
  /** Version discriminant. ABSENT ⇒ v1 manifest (variant creation rejects). */
  manifestVersion?: 2;
  /** Authored literal-vs-reference structure per flattened token path. */
  tokenDefinitions?: Record<string, TokenDefinition>;
  /** Exact scale names configured for CSS-variable emission, including empty scales. */
  emittedScales?: string[];
  /** Mode name → alias dot-path → AUTHORED color dot-path (pre-resolution). */
  modeAliasDefinitions?: ModeAliasDefinition;
  /** `@property` registrations by contextual var name, in declaration order. */
  registrations?: Record<string, ContextualVarRegistration>;
  /** Version of the emitter that composed this manifest's CSS. */
  emitterVersion?: number;
  /** sha256 hex over sorted-key canonical JSON of the authored inputs. */
  contractHash?: string;
  /** The exact CSS strings build() composed, in emission order. */
  cssFragments?: ThemeCssFragment[];
}
