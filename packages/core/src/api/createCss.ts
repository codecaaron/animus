import { isObject } from 'lodash';
import { CSSObject } from '..';
import { CSS, Parser, Prop, TransformerMap } from '../types/config';
import { getStaticCss } from '../utils/getStaticProperties';
import { create } from './create';

export function createCss<
  Config extends Record<string, Prop>,
  P extends Parser<TransformerMap<Config>>
>(config: Config): CSS<P> {
  const parser = create(config);
  const filteredProps: string[] = parser.propNames;
  return (cssProps) => {
    let cache: CSSObject;
    const allKeys = Object.keys(cssProps);

    /** Any key of the CSSProps that is not a System Prop or a Static CSS Property is treated as a nested selector */
    const selectors = allKeys.filter(
      (key) => !filteredProps.includes(key) && isObject(cssProps[key])
    );

    /** Static CSS Properties get extracted if they match neither syntax */
    const staticCss = getStaticCss(cssProps, [
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
          ...getStaticCss(selectorConfig, filteredProps),
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
