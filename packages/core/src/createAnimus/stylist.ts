import { Theme } from '@emotion/react';
import { isObject, merge } from 'lodash';
import { AbstractParser } from '../types/config';

type BasicStuff = Record<string, any>;

const getSelectors = (
  base: BasicStuff,
  variants: BasicStuff,
  states: BasicStuff,
  filters: string[]
) => {
  const mergedCss = merge(
    base,
    ...Object.values(variants),
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
    const styles: BasicStuff = parser({ ...css, theme });

    selectors.forEach((selector) => {
      styles[selector] = parser({ ...css[selector], theme });
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
    const styles = css(base, props.theme);

    variantKeys.forEach((key) => {
      const variantCss = variants[key][props[key] || defaults[key]];
      const variantStyles = css(variantCss, props.theme);

      merge(styles, variantStyles);
    });

    stateKeys.forEach((key) => {
      if (props[key] || defaults[key]) {
        const variantStyles = css(states[key], props.theme);
        merge(styles, variantStyles);
      }
    });

    merge(styles, parser(props));

    return states;
  };
};
