import { merge } from 'lodash';
import { CSSObject, ThemeProps } from '../types/props';
import { CSS, Parser, Prop, States, TransformerMap } from './config';
import { createCss } from './createCss';

export function createStates<
  Config extends Record<string, Prop>,
  P extends Parser<TransformerMap<Config>>
>(config: Config): States<P> {
  const css: CSS<P> = createCss(config);

  return (states) => {
    const orderedStates = Object.keys(states);
    type Keys = keyof typeof states;
    const stateFns = {} as Record<Keys, (props: ThemeProps) => CSSObject>;

    orderedStates.forEach((key) => {
      const stateKey = key as Keys;
      const cssProps = states[stateKey];
      stateFns[stateKey] = css(cssProps as any);
    });

    return (props) => {
      const styles = {};
      orderedStates.forEach((state) => {
        merge(styles, props[state] && stateFns[state](props));
      });

      return styles;
    };
  };
}
