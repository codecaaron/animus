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
 * The augmentable Theme interface. Consumers extend this via module augmentation
 * to get type-safe scale lookups:
 *
 * ```ts
 * declare module '@animus-ui/core' {
 *   export interface Theme extends MyThemeType {}
 * }
 * ```
 *
 * Replaces Emotion's `declare module '@emotion/react' { interface Theme ... }`.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Theme extends BaseTheme {}
