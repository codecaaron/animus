import { get, merge } from 'lodash';
import { AbstractProps, MediaQueryCache, ThemeProps } from '../types/props';
import { createPropertyStyle } from './createPropertyStyle';
import { Parser, Prop } from '../types/config';
import { orderPropNames } from '../properties/orderPropNames';
import {
  arrayParser,
  createMediaQueries,
  isMediaArray,
  isMediaMap,
  objectParser,
  orderBreakpoints,
} from './responsive';

interface RenderContext {
  mediaQueries: MediaQueryCache | null;
}

export const defaultBreakpoints = {
  xs: 480,
  sm: 768,
  md: 1024,
  lg: 1200,
  xl: 1440,
};

const renderPropValue = (
  styles: any,
  prop: any,
  props: AbstractProps,
  property: Prop,
  ctx: RenderContext
) => {
  const value = get(props, prop);

  switch (typeof value) {
    case 'string':
    case 'number':
    case 'function':
      return Object.assign(styles, createPropertyStyle(value, props, property));
    // handle any props configured with the responsive notation
    case 'object':
      if (!ctx.mediaQueries) {
        return;
      }
      // If it is an array the order of values is smallest to largest: [_, xs, ...]
      if (isMediaArray(value)) {
        return merge(
          styles,
          arrayParser(value, props, property, ctx.mediaQueries.array)
        );
      }
      // Check to see if value is an object matching the responsive syntax and generate the styles.
      if (value && isMediaMap(value)) {
        return merge(
          styles,
          objectParser(value, props, property, ctx.mediaQueries.map)
        );
      }
  }
};

export function createParser<Config extends Record<string, Prop>>(
  config: Config
): Parser<Config> {
  const propNames = orderPropNames(config) as Parser<Config>['propNames'];
  const ctx: RenderContext = {
    mediaQueries: null,
  };

  const parser = (props: ThemeProps, isCss = false) => {
    const styles = {};
    const { theme } = props;

    // Attempt to cache the breakpoints if we have not yet or if theme has become available.
    if (ctx.mediaQueries === null) {
      // Save the breakpoints if we can
      ctx.mediaQueries = createMediaQueries(
        theme?.breakpoints ?? defaultBreakpoints
      );
    }

    if (!isCss) {
      // Loops over all prop names on the configured config to check for configured styles
      propNames.forEach((prop) => {
        const property = config[prop];
        renderPropValue(styles, prop, props, property, ctx);
      });
    } else {
      // Loops over all prop names on the configured config to check for configured styles
      Object.keys(props).forEach((prop) => {
        const property = config[prop];

        if (property) {
          renderPropValue(styles, prop, props, property, ctx);
        } else if (prop !== 'theme') {
          Object.assign(styles, { [prop]: get(props, prop) });
        }
      });
    }

    if (ctx.mediaQueries !== null)
      return orderBreakpoints(styles, ctx.mediaQueries.array);

    return styles;
  };
  // return the parser function with the resulting meta information for further composition
  return Object.assign(parser, { propNames, config });
}
