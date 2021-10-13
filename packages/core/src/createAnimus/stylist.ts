import { Theme } from '@emotion/react';
import { isObject, merge, omit, pick } from 'lodash';
import { AbstractParser } from '../types/config';

type BasicStuff = Record<string, any>;

const getSelectors = (
  base: BasicStuff,
  variants: BasicStuff,
  states: BasicStuff,
  filters: string[]
) => {
  const mergedCss = merge(
    {},
    base,
    ...Object.values(variants).reduce(
      (carry, { variants }) => carry.concat(Object.values(variants)),
      []
    ),
    ...Object.values(states)
  );

  const selectorKeys: any[] = [];

  Object.entries(mergedCss).forEach(([key, shape]) => {
    if (!filters.includes(key) && isObject(shape as any)) {
      selectorKeys.push(key);
    }
  });

  return selectorKeys;
};

const complexParser = (parser: AbstractParser, selectors: string[]) => {
  return (css: BasicStuff, theme: Theme) => {
    const styles: BasicStuff = parser({ ...css, theme }, true);
    selectors.forEach((selector) => {
      styles[selector] = parser({ ...css[selector], theme }, true);
    });

    return styles;
  };
};

export const stylist = (
  parser: AbstractParser,
  base: Record<string, any> = {},
  variants: Record<string, any> = {},
  states: Record<string, any> = {},
  defaults: Record<string, any> = {}
) => {
  const variantKeys = Object.keys(variants);
  const stateKeys = Object.keys(states);
  const selectors = getSelectors(base, variants, states, parser.propNames);
  const css = complexParser(parser, selectors);

  return (props: any) => {
    const config = base;

    variantKeys.forEach((key) => {
      const variantCss = variants[key].variants[props[key] || defaults[key]];
      merge(config, variantCss);
    });

    stateKeys.forEach((key) => {
      if (props[key] || defaults[key]) {
        merge(config, states[key]);
      }
    });

    const core = omit(config, selectors);

    return {
      ...css(config, props.theme),
      ...parser(props),
    };
  };
};
