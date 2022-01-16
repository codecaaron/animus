import { isObject } from 'lodash';
import { CSSObject } from '..';
import { CSS, Parser, Prop, TransformerMap } from './config';
import { getStylePropNames } from '../properties/getStylePropNames';
import { create } from './create';

export function createCss<
  Config extends Record<string, Prop>,
  P extends Parser<TransformerMap<Config>>
>(config: Config): CSS<P> {
  const parser = create(config);
  const filteredProps = parser.propNames as string[];
  return (cssProps) => {
    let cache: CSSObject;
    const allKeys = Object.keys(cssProps);

    /** Any key of the CSSProps that is not a System Prop or a Static CSS Property is treated as a nested selector */
    const selectors = allKeys.filter(
      (key) => !filteredProps.includes(key) && isObject(cssProps[key])
    );

    /** Static CSS Properties get extracted if they match neither syntax */
    const staticCss = getStylePropNames(cssProps, [
      'theme', // Just in case this gets passed somehow
      ...selectors,
      ...filteredProps,
    ]);

    return ({ theme }) => {
      if (cache) return cache;
      const css = parser({ ...cssProps, theme } as any);
      selectors.forEach((selector) => {
        const selectorConfig = cssProps[selector] ?? {};
        css[selector] = {
          ...getStylePropNames(selectorConfig, filteredProps),
          ...parser({ ...selectorConfig, theme } as any),
        };
      });

      /** Merge the static and generated css and save it to the cache */
      cache = {
        ...staticCss,
        ...css,
      };
      return cache;
    };
  };
}
