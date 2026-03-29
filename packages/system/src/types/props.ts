import { BaseTheme, Theme } from './theme';

export type AbstractProps = ThemeProps<Record<string, unknown>, BaseTheme>;

export interface MediaQueryCache {
  map: Record<string, string>;
  array: string[];
}

export type ThemeProps<Props = {}, T extends BaseTheme = BaseTheme> = Props & {
  theme?: T;
};

type ThemeBreakpoints = Theme extends { breakpoints: infer B }
  ? B
  : Record<string, number>;
type BreakpointKeys = keyof ThemeBreakpoints;

export type MediaQueryMap<T> = { _?: T } & (string extends BreakpointKeys
  ? { [key: string]: T | undefined }
  : { [K in BreakpointKeys]?: T });

export type ResponsiveProp<T> = T | MediaQueryMap<T>;
