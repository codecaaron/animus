import { AbstractTheme, CSSObject } from '../types/theme';

export type MergeTheme<
  Base extends AbstractTheme,
  Next,
  Unmergable = Record<'breakpoints', Base['breakpoints']>,
> = Unmergable & Merge<Base, Next>;

export type Merge<A, B> = {
  [K in keyof (A & B)]: K extends keyof B
    ? K extends keyof A
      ? AssignValueIfUnmergable<A[K], B[K]>
      : B[K]
    : K extends keyof A
      ? A[K]
      : never;
};

export type Mergable<T> = Exclude<
  T,
  ((...args: any) => any) | string | boolean | symbol | number | any[]
>;

export type AssignValueIfUnmergable<A, B> =
  Mergable<A> extends never ? B : Mergable<B> extends never ? B : Assign<A, B>;

export type Assign<A, B> = {
  [K in keyof A | keyof B]: K extends keyof B
    ? B[K]
    : K extends keyof A
      ? A[K]
      : never;
};

export type PrivateThemeKeys = {
  _variables: Record<string, CSSObject>;
  _tokens: Record<string | number, any>;
};

/**
 * Nesting flattens to dash-joined keys: `{ button: { bg: { hover } } }`
 * becomes `button-bg-hover`.
 */
export type ColorModeConfig<Colors> = Record<
  string,
  | Colors
  | Record<string, Colors>
  | Record<string, Colors | Record<string, Colors>>
>;
