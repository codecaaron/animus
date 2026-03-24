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
