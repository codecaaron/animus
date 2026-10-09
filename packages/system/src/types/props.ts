import { BaseTheme, Theme } from './theme';

export type AbstractProps = ThemeProps<Record<string, unknown>, BaseTheme>;

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

/**
 * A component prop's responsive value, where any breakpoint may hold
 * `undefined`, which the runtime drops. Kept apart from `ResponsiveProp`:
 * giving that one an `undefined` parameter, even unused, makes TS 5.9
 * overflow (TS2590) relating a multi-group component's props.
 */
export type ResponsivePropValue<T> =
  | T
  | ({ _?: T | undefined } & (string extends BreakpointKeys
      ? { [key: string]: T | undefined }
      : { [K in BreakpointKeys]?: T | undefined }));
