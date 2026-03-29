import { PropertyTypes } from './properties';
import { AbstractProps, ResponsiveProp, ThemeProps } from './props';
import { ArrayScale, MapScale } from './scales';
import { CSSObject } from './shared';
import { BaseTheme, Theme, TokenScales } from './theme';
import { Arg } from './utils';

export interface BaseProperty {
  property: keyof PropertyTypes;
  properties?: readonly (keyof PropertyTypes)[];
}

export interface Prop extends BaseProperty {
  scale?: string | MapScale | ArrayScale;
  variable?: string;
  negative?: boolean;
  currentVar?: string;
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

/**
 * Negate numeric literal types.
 * `NegateKeys<4 | 8 | 16>` → `-4 | -8 | -16`
 * Excludes 0 (negative zero is meaningless).
 */
type NegateKeys<T> = T extends number
  ? T extends 0
    ? never
    : `-${T}` extends `${infer N extends number}`
      ? N
      : never
  : never;

export type PropertyValues<
  Property extends Prop,
  IncludeGlobals = false,
> = Exclude<
  PropertyTypes<
    IncludeGlobals extends true ? (string & {}) | 0 : never
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
type NegativeOf<Config extends Prop, Keys> = Config['negative'] extends true
  ? NegateKeys<Extract<Keys, number>>
  : never;

export type ScaleValue<
  Config extends Prop,
  T extends BaseTheme,
> = Config['scale'] extends keyof TokenScales<T>
  ?
      | keyof TokenScales<T>[Config['scale']]
      | NegativeOf<Config, keyof TokenScales<T>[Config['scale']]>
      | PropertyValues<Config, IsEmpty<TokenScales<T>[Config['scale']]>>
  : Config['scale'] extends MapScale
    ?
        | keyof Config['scale']
        | NegativeOf<Config, keyof Config['scale']>
        | PropertyValues<Config, IsEmpty<Config['scale']>>
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

/**
 * Theme-fixed scale value — uses the augmentable Theme interface
 * instead of a generic T. This enables type-safe CSS object constraints
 * without threading T through the entire class hierarchy.
 */
/** Colors-only: accept `{colors.key/number}` opacity syntax in component styles. */
type ColorOpacityRef<Config extends Prop> = Config['scale'] extends 'colors'
  ? 'colors' extends keyof TokenScales<Theme>
    ? `{colors.${keyof TokenScales<Theme>[Config['scale'] & keyof TokenScales<Theme>] & string}/${number}}`
    : never
  : never;

export type ThemedScaleValue<Config extends Prop> =
  Config['scale'] extends keyof TokenScales<Theme>
    ?
        | keyof TokenScales<Theme>[Config['scale']]
        | NegativeOf<Config, keyof TokenScales<Theme>[Config['scale']]>
        | PropertyValues<Config, IsEmpty<TokenScales<Theme>[Config['scale']]>>
        | ColorOpacityRef<Config>
    : Config['scale'] extends MapScale
      ?
          | keyof Config['scale']
          | NegativeOf<Config, keyof Config['scale']>
          | PropertyValues<Config, IsEmpty<Config['scale']>>
      : Config['scale'] extends ArrayScale
        ?
            | Config['scale'][number]
            | PropertyValues<Config, IsEmpty<Config['scale']>>
        : PropertyValues<Config, true>;

export type ThemedScale<Config extends Prop> = ResponsiveProp<
  ThemedScaleValue<Config>
>;

/**
 * Theme-aware CSS props — uses the augmentable Theme interface
 * to constrain values per-key. No generic T needed.
 *
 * When Theme is augmented, props with scales get constrained to scale keys.
 * When Theme is NOT augmented (empty), falls back to standard CSS values.
 */
export type ThemedCSSProps<Props, Config extends Record<string, Prop>> = {
  [K in keyof Props]?: K extends keyof Config
    ? ThemedScale<Config[K]>
    : K extends keyof PropertyTypes
      ? PropertyTypes[K]
      : Omit<PropertyTypes, keyof Config> & {
          [P in keyof Config]?: ThemedScale<Config[P]>;
        };
};

export type ThemedCSSPropMap<Props, Config extends Record<string, Prop>> = {
  [K in keyof Props]?: ThemedCSSProps<Props[K], Config>;
};

export interface VariantConfig {
  prop?: string;
  defaultVariant?: string;
  base?: CSSProps<AbstractProps, SystemProps<AbstractParser>>;
  variants: CSSPropMap<AbstractProps, SystemProps<AbstractParser>>;
}

export interface CompoundEntry {
  condition: Record<string, string>;
  styles: CSSProps<AbstractProps, SystemProps<AbstractParser>>;
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
