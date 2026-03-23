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
