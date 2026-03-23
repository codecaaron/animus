import { DefaultCSSPropertyValue, PropertyTypes } from './properties';
import { AbstractProps, ResponsiveProp, ThemeProps } from './props';
import { ArrayScale, MapScale } from './scales';
import { CSSObject } from './shared';
import { BaseTheme, TokenScales } from './theme';
import { Arg } from './utils';

export interface BaseProperty {
  property: keyof PropertyTypes;
  properties?: readonly (keyof PropertyTypes)[];
}

export interface Prop extends BaseProperty {
  scale?: string | MapScale | ArrayScale;
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
  IncludeGlobals = false,
> = Exclude<
  PropertyTypes<
    IncludeGlobals extends true ? DefaultCSSPropertyValue : never
  >[Property['property']],
  IncludeGlobals extends true ? never : object | any[]
>;

/**
 * Resolve scale values from T directly. No CompatTheme fallback.
 *
 * Resolution order:
 * 1. If scale is a key of T's token scales → keyof T[scale]
 * 2. If scale is an inline MapScale → keyof scale
 * 3. If scale is an inline ArrayScale → scale[number]
 * 4. Otherwise → raw CSS property values
 */
export type ScaleValue<
  Config extends Prop,
  T extends BaseTheme,
> = Config['scale'] extends keyof TokenScales<T>
  ?
      | keyof TokenScales<T>[Config['scale']]
      | PropertyValues<Config, IsEmpty<TokenScales<T>[Config['scale']]>>
  : Config['scale'] extends MapScale
    ? keyof Config['scale'] | PropertyValues<Config, IsEmpty<Config['scale']>>
    : Config['scale'] extends ArrayScale
      ?
          | Config['scale'][number]
          | PropertyValues<Config, IsEmpty<Config['scale']>>
      : PropertyValues<Config, true>;

export type Scale<Config extends Prop, T extends BaseTheme> = ResponsiveProp<
  ScaleValue<Config, T>
>;

export type ParserProps<
  Config extends Record<string, Prop>,
  T extends BaseTheme,
> = ThemeProps<
  {
    [P in keyof Config]?: Scale<Config[P], T>;
  },
  T
>;

export interface Parser<
  Config extends Record<string, Prop>,
  T extends BaseTheme,
> {
  (props: ParserProps<Config, T>, orderProps?: boolean): CSSObject;
  propNames: Extract<keyof Config, string>[];
  config: Config;
}

export type SystemProps<
  P extends AbstractParser,
  SafeProps = Omit<Arg<P>, 'theme'>,
> = {
  [K in keyof SafeProps]: SafeProps[K];
};

export interface VariantConfig {
  prop?: any;
  defaultVariant?: any;
  base?: CSSProps<AbstractProps, SystemProps<AbstractParser>>;
  variants: CSSPropMap<AbstractProps, SystemProps<AbstractParser>>;
}

export type CSSPropMap<Props, System> = {
  [K in keyof Props]?: CSSProps<Props[K], System>;
};

export type CSSProps<Props, System> = {
  [K in keyof Props]?: K extends keyof System
    ? System[K]
    : K extends keyof PropertyTypes
      ? PropertyTypes[K]
      : Omit<PropertyTypes, keyof System> & Omit<System, 'theme'>;
};
