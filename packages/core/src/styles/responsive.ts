import { intersection, mapValues, omit } from 'lodash';

import { Prop } from '../types/config';
import { MediaQueryCache, MediaQueryMap, ThemeProps } from '../types/props';
import { CSSObject } from '../types/shared';
import { Breakpoints } from '../types/theme';
import { createPropertyStyle } from './createPropertyStyle';

const BREAKPOINT_KEYS = ['_', 'xs', 'sm', 'md', 'lg', 'xl'];

/**
 * Destructures the themes breakpoints into an ordered structure to traverse
 */
const templateMediaQuery = (breakpoint: number) =>
  `@media screen and (min-width: ${breakpoint}px)`;

export const createMediaQueries = (
  breakpoints?: Breakpoints | undefined
): MediaQueryCache | null => {
  if (breakpoints === undefined) return null;
  const { xs, sm, md, lg, xl } = breakpoints ?? {};
  // Ensure order for mapping
  return {
    map: mapValues(breakpoints, templateMediaQuery),
    array: [xs, sm, md, lg, xl].map(templateMediaQuery),
  };
};

export const isMediaArray = (val: unknown): val is (string | number)[] =>
  Array.isArray(val);

export const isMediaMap = (
  val: object
): val is MediaQueryMap<string | number> =>
  intersection(Object.keys(val), BREAKPOINT_KEYS).length > 0;

interface ResponsiveParser<
  Bp extends MediaQueryMap<string | number> | (string | number)[]
> {
  <C extends Prop>(
    value: Bp,
    props: ThemeProps,
    config: C,
    breakpoints: Bp
  ): CSSObject;
}

export const objectParser: ResponsiveParser<MediaQueryMap<string | number>> = (
  value,
  props,
  config,
  breakpoints
) => {
  const styles: CSSObject = {};
  const { _, ...rest } = value;
  // the keyof 'base' is base styles
  if (_) Object.assign(styles, createPropertyStyle(_, props, config));

  // Map over remaining keys and merge the corresponding breakpoint styles
  // for that property.
  Object.keys(breakpoints).forEach(
    (breakpointKey: keyof typeof breakpoints) => {
      const bpStyles = rest[breakpointKey as keyof typeof rest];
      if (typeof bpStyles === 'undefined') return;
      Object.assign(styles, {
        [breakpoints[breakpointKey] as string]: createPropertyStyle(
          bpStyles,
          props,
          config
        ),
      });
    }
  );

  return styles;
};

export const arrayParser: ResponsiveParser<(string | number)[]> = (
  value,
  props,
  config,
  breakpoints
): CSSObject => {
  const styles: CSSObject = {};
  const [_, ...rest] = value;
  // the first index is base styles
  if (_) Object.assign(styles, createPropertyStyle(_, props, config));

  // Map over each value in the array and merge the corresponding breakpoint styles
  // for that property.
  rest.forEach((val, i) => {
    const breakpointKey = breakpoints[i];
    if (!breakpointKey || typeof val === 'undefined') return;
    Object.assign(styles, {
      [breakpointKey]: createPropertyStyle(val, props, config),
    });
  });

  return styles;
};

export const orderBreakpoints = (styles: CSSObject, breakpoints: string[]) => {
  const orderedStyles: CSSObject = omit(styles, breakpoints);
  breakpoints.forEach((bp) => {
    if (styles[bp]) {
      orderedStyles[bp] = styles[bp] as CSSObject;
    }
  });
  return orderedStyles;
};
