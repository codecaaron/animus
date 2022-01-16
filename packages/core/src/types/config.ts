import { Theme } from '@emotion/react';
import { InteropTheme } from './theme';

import { CSSObject } from './shared';
import { DefaultCSSPropertyValue, PropertyTypes } from './properties';
import {
  CSSProps,
  CSSPropMap,
  AbstractProps,
  ResponsiveProp,
  ThemeProps,
} from './props';
import { Arg } from '..';
import { ArrayScale, MapScale } from './scales';

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

export type ParserProps<Config extends Record<string, Prop>> = ThemeProps<{
  [P in keyof Config]?: Scale<Config[P]>;
}>;

export interface Parser<Config extends Record<string, Prop>> {
  (props: ParserProps<Config>, orderProps?: boolean): CSSObject;
  propNames: Extract<keyof Config, string>[];
  config: Config;
}

export type SystemProps<
  P extends AbstractParser,
  SafeProps = Omit<Arg<P>, 'theme'>
> = {
  [K in keyof SafeProps]: SafeProps[K];
};

export interface VariantConfig {
  prop?: any;
  defaultVariant?: any;
  base?: CSSProps<AbstractProps, SystemProps<AbstractParser>>;
  variants: CSSPropMap<AbstractProps, SystemProps<AbstractParser>>;
}
