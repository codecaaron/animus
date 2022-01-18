import { merge } from 'lodash';
import { CSSObject } from '../types/shared';
import { ThemeProps } from '../types/props';
import { CSS, Parser, Prop, TransformerMap, Variant } from './config';
import { createCss } from './createCss';

export function createVariant<
  Config extends Record<string, Prop>,
  P extends Parser<TransformerMap<Config>>
>(config: Config): Variant<P> {
  const css: CSS<P> = createCss(config);

  return ({ prop = 'variant', defaultVariant, base = {}, variants }) => {
    type Keys = keyof typeof variants;
    const baseFn = css(base);
    const variantFns = {} as Record<Keys, (props: ThemeProps) => CSSObject>;

    Object.keys(variants).forEach((key) => {
      const variantKey = key as Keys;
      const cssProps = variants[variantKey];
      variantFns[variantKey] = css(cssProps as any);
    });

    return (props) => {
      const { [prop]: selected = defaultVariant } = props;
      const styles = {};
      if (!selected) return styles;

      return merge(
        styles,
        baseFn(props),
        variantFns?.[selected as Keys]?.(props)
      );
    };
  };
}
