import { BaseTheme, Theme } from './theme';

export type AbstractProps = ThemeProps<Record<string, unknown>, BaseTheme>;

export type ThemeProps<Props = {}, T extends BaseTheme = BaseTheme> = Props & {
  theme?: T;
};

type ThemeBreakpoints = Theme extends { breakpoints: infer B }
  ? B
  : Record<string, number>;
type BreakpointKeys = keyof ThemeBreakpoints;

/**
 * `Omitted` is what a named breakpoint may hold to mean it was left out: a
 * component prop passes `undefined`, which the runtime drops; a style object
 * takes none. `_` keeps `T` alone: adding `Omitted` there makes the builder's
 * own class checks overflow (TS2590).
 */
export type MediaQueryMap<T, Omitted = never> = {
  _?: T;
} & (string extends BreakpointKeys
  ? { [key: string]: T | undefined }
  : { [K in BreakpointKeys]?: T | Omitted });

export type ResponsiveProp<T, Omitted = never> = T | MediaQueryMap<T, Omitted>;
