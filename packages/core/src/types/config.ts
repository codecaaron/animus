import { Theme } from '@emotion/react';

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
import { CompatTheme } from '../compatTheme';

export interface BaseProperty {
  property: keyof PropertyTypes;
  properties?: readonly (keyof PropertyTypes)[];
}

export interface Prop extends BaseProperty {
  scale?: keyof Theme | keyof CompatTheme | MapScale | ArrayScale;
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

type IsEmpty<T> = [] extends T ? true : false | {} extends T ? true : false;

export type PropertyValues<
  Property extends Prop,
  IncludeGlobals = false
> = Exclude<
  PropertyTypes<
    IncludeGlobals extends true ? DefaultCSSPropertyValue : never
  >[Property['property']],
  IncludeGlobals extends true ? never : object | any[]
>;

type CompatValue<Key extends keyof CompatTheme> =
  CompatTheme[Key] extends MapScale
    ? keyof CompatTheme[Key]
    : CompatTheme[Key] extends ArrayScale
    ? CompatTheme[Key][number]
    : never;

export type ScaleValue<Config extends Prop> =
  Config['scale'] extends keyof Theme
    ?
        | keyof Theme[Config['scale']]
        | PropertyValues<Config, IsEmpty<Theme[Config['scale']]>>
    : Config['scale'] extends MapScale
    ? keyof Config['scale'] | PropertyValues<Config, IsEmpty<Config['scale']>>
    : Config['scale'] extends ArrayScale
    ? Config['scale'][number] | PropertyValues<Config, IsEmpty<Config['scale']>>
    : Config['scale'] extends keyof CompatTheme
    ?
        | CompatValue<Config['scale']>
        | PropertyValues<Config, IsEmpty<CompatTheme[Config['scale']]>>
    : PropertyValues<Config, true>;

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
