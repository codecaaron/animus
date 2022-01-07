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

export interface InteropTheme extends BaseTheme {
  colors: {};
  radii: {};
  borders: {};
  fontSize: {};
  letterSpacing: {};
  fontFamily: {};
  fontWeight: {};
  spacing: {};
  lineHeight: {};
  modes: {
    dark: {};
    light: {};
  };
  mode: 'dark' | 'light';
}

declare module '@emotion/react' {
  export interface Theme extends BaseTheme {}
}
