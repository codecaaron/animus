import { Theme } from '@emotion/react';
import { InteropTheme } from './theme';

import { DefaultCSSPropertyValue, PropertyTypes } from './properties';
import {
  AbstractProps,
  CSSObject,
  CSSPropMap,
  CSSProps,
  ResponsiveProp,
  ThemeProps,
} from './props';

export type MapScale = Record<string | number, string | number>;
export type CustomScale =
  | readonly (string | number | CSSObject)[] & {
      length: 0;
    };
export type ArrayScale = readonly (string | number)[];
export interface BaseProperty {
  property: keyof PropertyTypes;
  properties?: readonly (keyof PropertyTypes)[];
}

export interface Prop extends BaseProperty {
  scale?: keyof Theme | keyof InteropTheme | MapScale | ArrayScale;
  variable?: string;
  transform?: (
    val: string | number,
    prop?: string,
    props?: AbstractProps
  ) => string | number | CSSObject;
}

export interface AbstractParser {
  (props: AbstractProps, orderProps?: boolean): CSSObject;
  propNames: string[];
  config: Record<string, Prop>;
}

export type PropertyValues<
  Property extends keyof PropertyTypes,
  All extends boolean = false
> = Exclude<
  PropertyTypes<All extends true ? DefaultCSSPropertyValue : never>[Property],
  All extends true ? never : object | any[]
>;

export type ScaleValue<Config extends Prop> =
  Config['scale'] extends keyof Theme
    ? keyof Theme[Config['scale']] | PropertyValues<Config['property']>
    : Config['scale'] extends MapScale
    ? keyof Config['scale'] | PropertyValues<Config['property']>
    : Config['scale'] extends ArrayScale
    ? Config['scale'][number] | PropertyValues<Config['property']>
    : PropertyValues<Config['property'], true>;

export type Scale<Config extends Prop> = ResponsiveProp<
  ScaleValue<Config> | ((theme: Theme) => ScaleValue<Config>)
>;

export interface Parser<Config extends Record<string, Prop>> {
  (props: ParserProps<Config>, orderProps?: boolean): CSSObject;
  propNames: Extract<keyof Config, string>[];
  config: Config;
}

export interface Variant<P extends AbstractParser> {
  <
    Keys extends keyof Props,
    Base extends AbstractProps,
    Props extends Record<Keys, AbstractProps>,
    PropKey extends Readonly<string> = 'variant'
  >(options: {
    prop?: PropKey;
    defaultVariant?: keyof Props;
    base?: CSSProps<Base, SystemProps<P>>;
    variants: CSSPropMap<Props, SystemProps<P>>;
  }): (
    props: ThemeProps<{
      [Key in PropKey]?: Keys | false;
    }>
  ) => CSSObject;
}

export interface States<P extends AbstractParser> {
  <Props extends Record<string, AbstractProps>>(
    states: CSSPropMap<Props, SystemProps<P>>
  ): (props: ThemeProps<{ [K in keyof Props]?: boolean }>) => CSSObject;
}

export interface CSS<P extends AbstractParser> {
  <Props extends AbstractProps>(config: CSSProps<Props, SystemProps<P>>): (
    props: ThemeProps
  ) => CSSObject;
}

export type ParserProps<Config extends Record<string, Prop>> = ThemeProps<{
  [P in keyof Config]?: Scale<Config[P]>;
}>;

export type SystemProps<
  P extends AbstractParser,
  SafeProps = Omit<Arg<P>, 'theme'>
> = {
  [K in keyof SafeProps]: SafeProps[K];
};

export type Arg<T extends (...args: any) => any> = Parameters<T>[0];

export interface PropConfig {
  props: Record<string, Prop>;
  groups: Record<string, string[]>;
}
