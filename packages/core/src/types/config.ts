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
import { CompatTheme } from '../compatTheme';

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

export type PropertyValues<Values, Property extends keyof PropertyTypes> =
  | Values
  | Exclude<
      PropertyTypes<
        Values extends never ? DefaultCSSPropertyValue : never
      >[Property],
      Values extends never ? never : object | any[]
    >;

type LiteralScale<S> = S extends keyof Theme
  ? keyof Theme[S]
  : S extends keyof CompatTheme
  ? CompatTheme[S]
  : S;

export type ScaleValue<
  S extends Prop['scale'],
  C extends Prop['property']
> = PropertyValues<
  LiteralScale<S> extends MapScale
    ? keyof LiteralScale<S>
    : LiteralScale<S> extends ArrayScale
    ? LiteralScale<S>[number]
    : never,
  C
>;

export type Scale<Config extends Prop> = ResponsiveProp<
  | ScaleValue<Config['scale'], Config['property']>
  | ((theme: Theme) => ScaleValue<Config['scale'], Config['property']>)
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
