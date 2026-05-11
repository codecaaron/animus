import { mapValues, omit } from 'lodash';

import { Prop } from '../types/config';
import { MediaQueryCache, MediaQueryMap, ThemeProps } from '../types/props';
import { CSSObject } from '../types/shared';
import { createPropertyStyle } from './createPropertyStyle';

/**
 * Destructures the themes breakpoints into an ordered structure to traverse
 */
const templateMediaQuery = (breakpoint: number) =>
  `@media screen and (min-width: ${breakpoint}px)`;

export const createMediaQueries = (
  breakpoints?: Record<string, number>
): MediaQueryCache | null => {
  if (breakpoints === undefined) return null;
  const keys = Object.keys(breakpoints);
  return {
    map: mapValues(breakpoints, templateMediaQuery),
    array: keys.map((k) => templateMediaQuery(breakpoints[k])),
  };
};

export const isMediaMap = (
  val: object,
  breakpointKeys: string[]
): val is MediaQueryMap<string | number> => {
  const keys = Object.keys(val);
  return (
    keys.length > 0 &&
    keys.every((k) => k === '_' || breakpointKeys.includes(k))
  );
};

interface ResponsiveParser {
  <C extends Prop>(
    value: MediaQueryMap<string | number>,
    props: ThemeProps,
    config: C,
    breakpoints: MediaQueryMap<string | number>
  ): CSSObject;
}

export const objectParser: ResponsiveParser = (
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

export const orderBreakpoints = (styles: CSSObject, breakpoints: string[]) => {
  const orderedStyles: CSSObject = omit(styles, breakpoints);
  breakpoints.forEach((bp) => {
    if (styles[bp]) {
      orderedStyles[bp] = styles[bp] as CSSObject;
    }
  });
  return orderedStyles;
};
