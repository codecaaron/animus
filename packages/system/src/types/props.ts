import { BaseTheme } from './theme';

export type AbstractProps = ThemeProps<Record<string, unknown>, BaseTheme>;

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

export type ThemeProps<Props = {}, T extends BaseTheme = BaseTheme> = Props & {
  theme?: T;
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
