import type { LiteralPaths } from '../theme/flattenScale';

export type { CSSObject } from './shared';

export interface BaseTheme {}

export interface AbstractTheme extends BaseTheme {
  breakpoints: Record<string, number>;
  readonly [key: string]: any;
}

/**
 * Filter non-scale keys from T so only user-defined scales appear.
 * breakpoints, modes, mode are structural — not token scales.
 */
export type TokenScales<T> = Omit<T, 'breakpoints' | 'modes' | 'mode'>;

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

/** Structured manifest emitted by ThemeBuilder.build() for plugin consumption. */
export interface ThemeManifest {
  /** Flat token key → raw value (e.g. 'space.8' → '0.5rem', 'colors.ember' → '#FF2800') */
  tokenMap: Record<string, string>;
  /** Flat token key → CSS variable name without var() wrapper (e.g. 'colors.ember' → '--color-ember') */
  variableMap: Record<string, string>;
  /** Mode name → flat key → resolved raw value (e.g. { dark: { 'colors.primary': '#FF2800' } }) */
  modes: Record<string, Record<string, string>>;
  /** Pre-built CSS string with :root and [data-color-mode] blocks */
  variableCss: string;
  /** Contextual vars registry: scale_name → [var_name] for --current-{name} side-effects */
  contextualVars?: Record<string, string[]>;
}
