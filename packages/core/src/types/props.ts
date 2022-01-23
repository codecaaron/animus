import { Theme } from '@emotion/react';

export type AbstractProps = ThemeProps<Record<string, unknown>>;

interface MediaQueryByKey<T = string> {
  xs: T;
  sm: T;
  md: T;
  lg: T;
  xl: T;
}
export interface MediaQueryCache {
  map: MediaQueryByKey;
  array: string[];
}

export type ThemeProps<Props = {}> = Props & {
  theme?: Theme;
};

export interface MediaQueryArray<T> {
  0?: T;
  1?: T;
  2?: T;
  3?: T;
  4?: T;
  5?: T;
}
export interface MediaQueryMap<T> {
  _?: T;
  xs?: T;
  sm?: T;
  md?: T;
  lg?: T;
  xl?: T;
}

export type ResponsiveProp<T> = T | MediaQueryMap<T> | MediaQueryArray<T>;
