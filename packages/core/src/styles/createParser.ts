import { get, merge } from 'lodash';

import { compatTheme } from '../compatTheme';
import { orderPropNames } from '../properties/orderPropNames';
import { Parser, Prop } from '../types/config';
import { AbstractProps, MediaQueryCache, ThemeProps } from '../types/props';
import { createPropertyStyle } from './createPropertyStyle';
import {
  createMediaQueries,
  isMediaMap,
  objectParser,
  orderBreakpoints,
} from './responsive';

interface RenderContext {
  mediaQueries: MediaQueryCache | null;
  breakpointKeys: string[];
}

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
      // Check to see if value is an object matching the responsive syntax and generate the styles.
      if (value && isMediaMap(value, ctx.breakpointKeys)) {
        return merge(
          styles,
          objectParser(value, props, property, ctx.mediaQueries.map)
        );
      }
  }
};

export function createParser<Config extends Record<string, Prop>>(
  config: Config,
  omitProps: string[] = []
): Parser<Config> {
  const propNames = orderPropNames(config).filter(
    (name) => !omitProps?.includes(name)
  ) as Parser<Config>['propNames'];
  const ctx: RenderContext = {
    mediaQueries: null,
    breakpointKeys: [],
  };

  const parser = (props: ThemeProps, isCss = false) => {
    const styles = {};
    const { theme } = props;

    // Attempt to cache the breakpoints if we have not yet or if theme has become available.
    if (ctx.mediaQueries === null) {
      const breakpoints = theme?.breakpoints ?? compatTheme.breakpoints;
      ctx.breakpointKeys = Object.keys(breakpoints);
      // Save the breakpoints if we can
      ctx.mediaQueries = createMediaQueries(breakpoints);
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
