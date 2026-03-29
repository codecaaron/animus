import { AbstractTheme } from './theme';

export type AbstractProps = ThemeProps<Record<string, unknown>>;

export interface MediaQueryCache {
  map: Record<string, string>;
  array: string[];
}

export type ThemeProps<Props = {}> = Props & {
  theme?: AbstractTheme;
};

export interface MediaQueryMap<T> {
  _?: T;
  [key: string]: T | undefined;
}

export type ResponsiveProp<T> = T | MediaQueryMap<T>;
