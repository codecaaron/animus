import type { LiteralPaths } from '../theme/flattenScale';

export type { CSSObject } from './shared';

export interface Breakpoints<T = number> {
  xs: T;
  sm: T;
  md: T;
  lg: T;
  xl: T;
}

export interface BaseTheme {
  breakpoints: Breakpoints;
}

export interface AbstractTheme extends BaseTheme {
  readonly [key: string]: any;
}

/**
 * Filter internal ThemeBuilder keys from T so they don't appear as valid scales.
 * _variables, _tokens, mode, _getColorValue are implementation details.
 */
export type TokenScales<T> = Omit<
  T,
  '_variables' | '_tokens' | 'mode' | '_getColorValue' | 'breakpoints' | 'modes'
>;

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
 * Extract scale names from a built theme whose values are CSS variable references.
 * These are scales that were emitted via `addScale({ emit: true })` or `addColors()`.
 *
 * Use with `TokenScales<T>` to pick emitted vs non-emitted subsets:
 * ```ts
 * type Emitted = Pick<TokenScales<T>, EmittedScales<T>>;
 * type Static = Omit<TokenScales<T>, EmittedScales<T>>;
 * ```
 */
export type EmittedScales<T> = {
  [K in keyof TokenScales<T>]: TokenScales<T>[K] extends Record<
    string,
    `var(--${string})`
  >
    ? K
    : never;
}[keyof TokenScales<T>];

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
  /** Contextual vars registry: scale name → array of var names (CSS prop derived as --{name}) */
  contextualVars?: Record<string, string[]>;
}
