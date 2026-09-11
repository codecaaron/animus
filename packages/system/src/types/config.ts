import {
  type Conditions,
  type RawAtRuleKey,
  type UnknownAtRule,
  type UnknownConditionAlias,
} from '../conditions';
import { KeyframeRef } from '../keyframes';
import { type Selectors } from '../selectors';
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
  /**
   * When false, scale-bound props accept arbitrary strings alongside scale
   * keys. Defaults to true.
   */
  strict?: boolean;
  currentVar?: string;
  transform?: (
    val: string | number,
    prop?: string,
    props?: AbstractProps
  ) => string | number | CSSObject;
}

export interface CustomPropConfig extends Prop {
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

type StrictOrEmpty<Config extends Prop, ScaleT> = Config['strict'] extends false
  ? true
  : IsEmpty<ScaleT>;

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
      | PropertyValues<
          Config,
          StrictOrEmpty<Config, TokenScales<T>[Config['scale']]>
        >
  : Config['scale'] extends MapScale
    ?
        | keyof Config['scale']
        | NegativeOf<Config, keyof Config['scale']>
        | PropertyValues<Config, StrictOrEmpty<Config, Config['scale']>>
    : Config['scale'] extends ArrayScale
      ?
          | Config['scale'][number]
          | PropertyValues<Config, StrictOrEmpty<Config, Config['scale']>>
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

type ColorOpacityRef<Config extends Prop> = Config['scale'] extends 'colors'
  ? 'colors' extends keyof TokenScales<Theme>
    ? `{colors.${keyof TokenScales<Theme>[Config['scale'] & keyof TokenScales<Theme>] & string}/${number}}`
    : never
  : never;

/**
 * The six container-query units, admitted on strict scale props ('2vw' stays
 * rejected). The union stays flat — cross-products hit TS2589.
 */
export type ContainerUnitValue =
  | `${number}cqw`
  | `${number}cqi`
  | `${number}cqh`
  | `${number}cqb`
  | `${number}cqmin`
  | `${number}cqmax`;

export type ThemedScaleValue<Config extends Prop> =
  Config['scale'] extends keyof TokenScales<Theme>
    ?
        | keyof TokenScales<Theme>[Config['scale']]
        | NegativeOf<Config, keyof TokenScales<Theme>[Config['scale']]>
        | PropertyValues<
            Config,
            StrictOrEmpty<Config, TokenScales<Theme>[Config['scale']]>
          >
        | ColorOpacityRef<Config>
        | ContainerUnitValue
    : Config['scale'] extends MapScale
      ?
          | keyof Config['scale']
          | NegativeOf<Config, keyof Config['scale']>
          | PropertyValues<Config, StrictOrEmpty<Config, Config['scale']>>
          | ContainerUnitValue
      : Config['scale'] extends ArrayScale
        ?
            | Config['scale'][number]
            | PropertyValues<Config, StrictOrEmpty<Config, Config['scale']>>
        : PropertyValues<Config, true>;

export type ThemedScale<Config extends Prop> = ResponsiveProp<
  ThemedScaleValue<Config>
>;

type RawSelectorKey = `${string}&${string}`;

type PublishedAliasKeys = Extract<
  keyof Conditions | keyof Selectors,
  `_${string}`
>;

type KnownUnderscoreKey = [PublishedAliasKeys] extends [never]
  ? `_${string}`
  : BuiltInSelectorAlias | BuiltInConditionAlias | PublishedAliasKeys;

type PassThroughProp<K extends keyof PropertyTypes> = K extends 'animationName'
  ? ResponsiveProp<KeyframeRef<string> | PropertyTypes[K]>
  : ResponsiveProp<PropertyTypes[K]>;

type UnderscoreBlockMembers<Config extends Record<string, Prop>> = {
  [K in KnownUnderscoreKey]?: ThemedBlockBody<Config>;
};

/**
 * Must stay a FIXED type: an arm referencing the outer inferred `Props` is
 * reverse-mapped away at `.styles()` and stops checking nested values.
 */
type ThemedBlockBody<Config extends Record<string, Prop>> = {
  [K in Exclude<keyof PropertyTypes, keyof Config>]?: PassThroughProp<K>;
} & {
  [P in keyof Config]?: ThemedScale<Config[P]>;
} & {
  [K in RawSelectorKey | RawAtRuleKey]?: ThemedBlockBody<Config>;
} & UnderscoreBlockMembers<Config>;

export type ThemedCSSProps<Props, Config extends Record<string, Prop>> = {
  [K in keyof Props]?: K extends keyof Config
    ? ThemedScale<Config[K]>
    : K extends RawSelectorKey
      ? ThemedBlockBody<Config>
      : K extends RawAtRuleKey
        ? ThemedBlockBody<Config>
        : K extends KnownUnderscoreKey
          ? ThemedBlockBody<Config>
          : K extends keyof PropertyTypes
            ? PassThroughProp<K>
            : K extends `_${string}`
              ? UnknownConditionAlias<K & string>
              : K extends `@${string}`
                ? UnknownAtRule<K & string>
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

export type BuiltInSelectorAlias =
  | '_link'
  | '_visited'
  | '_hover'
  | '_focus'
  | '_focusVisible'
  | '_focusWithin'
  | '_active'
  | '_target'
  | '_disabled'
  | '_checked'
  | '_invalid'
  | '_required'
  | '_readOnly'
  | '_expanded'
  | '_selected'
  | '_pressed'
  | '_before'
  | '_after'
  | '_placeholder'
  | '_selection'
  | '_first'
  | '_last'
  | '_even'
  | '_odd'
  | '_empty';

export type BuiltInConditionAlias =
  | '_motionReduce'
  | '_motionSafe'
  | '_print'
  | '_portrait'
  | '_landscape'
  | '_moreContrast'
  | '_lessContrast'
  | '_osDark'
  | '_osLight';

export type SelectorAliasProps<GroupPropValues> = {
  [
    K in BuiltInSelectorAlias | Extract<keyof Selectors, `_${string}`>
  ]?: Partial<GroupPropValues>;
};
