import { get, merge } from 'lodash';

import { compatTheme } from '../compatTheme';
import { orderPropNames } from '../properties/orderPropNames';
import { AbstractProps, MediaQueryCache, ThemeProps } from '../types/props';
import { AbstractPropTransformer, Parser } from './config';
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

const renderPropValue = (
  styles: any,
  prop: any,
  props: AbstractProps,
  property: AbstractPropTransformer,
  ctx: RenderContext
) => {
  const value = get(props, prop);

  switch (typeof value) {
    case 'string':
    case 'number':
    case 'function':
      return Object.assign(styles, property.styleFn(value, prop, props));
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

export function createParser<
  Config extends Record<string, AbstractPropTransformer>,
>(config: Config): Parser<Config> {
  const propNames = orderPropNames(config);
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
        theme?.breakpoints ?? compatTheme.breakpoints
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
