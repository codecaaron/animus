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
  /** Only a declaration prop has a kind. */
  kind?: never;
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
  ) => string | number;
}

/**
 * Binds a system prop to a declaration scale registered with
 * `addDeclarationScale`: each key applies its complete record of `members`.
 * It has no primary property, transform, negative form or raw-value fallback.
 */
export interface DeclarationProp {
  kind: 'declarations';
  scale: DeclarationScaleName;
  members: readonly (keyof PropertyTypes)[];
  property?: never;
  properties?: never;
  transform?: never;
  negative?: never;
  strict?: never;
  variable?: never;
  currentVar?: never;
}

/** Any system prop definition: a value prop or a declaration prop. */
export type SystemProp = Prop | DeclarationProp;

type DeclarationScalesOf<T> = T extends {
  __declarationScales: infer Scales;
}
  ? Scales
  : {};

/**
 * The theme's declaration scale names, plus any string: the literal members
 * keep an authored name literal, so its keys can be read back.
 */
type DeclarationScaleName =
  | Extract<keyof DeclarationScalesOf<Theme>, string>
  | (string & {});

/** The keys of a declaration prop's scale; any key while the theme is unknown. */
export type DeclarationKey<Config extends DeclarationProp> =
  Config['scale'] extends keyof DeclarationScalesOf<Theme>
    ? keyof DeclarationScalesOf<Theme>[Config['scale']]
    : string | number;

// A transform returns a string or a finite number: build-time evaluation
// rejects an object result, and the runtime drops it.
export interface CustomPropConfig extends Prop {
  transform?: (
    val: string | number,
    prop?: string,
    props?: AbstractProps
  ) => string | number;
}

export interface AbstractParser {
  (props: AbstractProps, orderProps?: boolean): CSSObject;
  propNames: string[];
  config: Record<string, Prop>;
}

type IsEmpty<T> = [] extends T ? true : false | {} extends T ? true : false;

type StrictOrEmpty<
  Config extends SystemProp,
  ScaleT,
> = Config['strict'] extends false ? true : IsEmpty<ScaleT>;

type NegateKeys<T> = T extends number
  ? T extends 0
    ? never
    : `-${T}` extends `${infer N extends number}`
      ? N
      : never
  : never;

// `& string` drops a declaration prop's absent property; intersecting with
// `keyof PropertyTypes` instead expands the key union against itself.
export type PropertyValues<
  Property extends SystemProp,
  IncludeGlobals = false,
> = Exclude<
  PropertyTypes<
    IncludeGlobals extends true ? (string & {}) | 0 : never
  >[Property['property'] & string],
  IncludeGlobals extends true ? never : object | any[]
>;

type NegativeOf<
  Config extends SystemProp,
  Keys,
> = Config['negative'] extends true ? NegateKeys<Extract<Keys, number>> : never;

/**
 * What a strict scale admits beside its keys and keywords, as strict
 * extraction and the runtime do: the string zero on a property that takes a
 * length, and a reference to one of the scale's own tokens. A non-strict scale
 * already admits both through its raw values. The numeric zero waits: adding
 * a number to every length prop overflows the union TS builds when checking
 * keyframe frames against a large prop registry (TS2590).
 */
type StrictAdmissions<
  Config extends SystemProp,
  Strict,
  ScaleName,
  Keys,
> = Strict extends true
  ? never
  :
      | (0 extends PropertyValues<Config, true> ? '0' : never)
      | (ScaleName extends string
          ? `{${ScaleName}.${Extract<Keys, string | number>}}`
          : never);

export type ScaleValue<
  Config extends SystemProp,
  T extends BaseTheme,
> = Config['scale'] extends keyof TokenScales<T>
  ?
      | keyof TokenScales<T>[Config['scale']]
      | NegativeOf<Config, keyof TokenScales<T>[Config['scale']]>
      | PropertyValues<
          Config,
          StrictOrEmpty<Config, TokenScales<T>[Config['scale']]>
        >
      | StrictAdmissions<
          Config,
          StrictOrEmpty<Config, TokenScales<T>[Config['scale']]>,
          Config['scale'],
          keyof TokenScales<T>[Config['scale']]
        >
  : Config['scale'] extends MapScale
    ?
        | keyof Config['scale']
        | NegativeOf<Config, keyof Config['scale']>
        | PropertyValues<Config, StrictOrEmpty<Config, Config['scale']>>
        | StrictAdmissions<
            Config,
            StrictOrEmpty<Config, Config['scale']>,
            never,
            never
          >
    : Config['scale'] extends ArrayScale
      ?
          | Config['scale'][number]
          | PropertyValues<Config, StrictOrEmpty<Config, Config['scale']>>
          | StrictAdmissions<
              Config,
              StrictOrEmpty<Config, Config['scale']>,
              never,
              never
            >
      : PropertyValues<Config, true>;

export type Scale<Config extends SystemProp, T extends BaseTheme> = [
  Config,
] extends [DeclarationProp]
  ? ResponsiveProp<DeclarationKey<Extract<Config, DeclarationProp>>>
  : ResponsiveProp<ScaleValue<Config, T>>;

export type ParserProps<
  Config extends Record<string, SystemProp>,
  T extends BaseTheme,
> = ThemeProps<
  {
    [P in keyof Config]?: Scale<Config[P], T>;
  },
  T
>;

export interface Parser<
  Config extends Record<string, SystemProp>,
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

type ColorOpacityRef<Config extends SystemProp> =
  Config['scale'] extends 'colors'
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

export type ThemedScaleValue<Config extends SystemProp> =
  Config['scale'] extends keyof TokenScales<Theme>
    ?
        | keyof TokenScales<Theme>[Config['scale']]
        | NegativeOf<Config, keyof TokenScales<Theme>[Config['scale']]>
        | PropertyValues<
            Config,
            StrictOrEmpty<Config, TokenScales<Theme>[Config['scale']]>
          >
        | StrictAdmissions<
            Config,
            StrictOrEmpty<Config, TokenScales<Theme>[Config['scale']]>,
            Config['scale'],
            keyof TokenScales<Theme>[Config['scale']]
          >
        | ColorOpacityRef<Config>
        | ContainerUnitValue
    : Config['scale'] extends MapScale
      ?
          | keyof Config['scale']
          | NegativeOf<Config, keyof Config['scale']>
          | PropertyValues<Config, StrictOrEmpty<Config, Config['scale']>>
          | StrictAdmissions<
              Config,
              StrictOrEmpty<Config, Config['scale']>,
              never,
              never
            >
          | ContainerUnitValue
      : Config['scale'] extends ArrayScale
        ?
            | Config['scale'][number]
            | PropertyValues<Config, StrictOrEmpty<Config, Config['scale']>>
            | StrictAdmissions<
                Config,
                StrictOrEmpty<Config, Config['scale']>,
                never,
                never
              >
        : PropertyValues<Config, true>;

/** `Omitted` is what a breakpoint may hold to mean it was left out. */
export type ThemedScale<Config extends SystemProp, Omitted = never> = [
  Config,
] extends [DeclarationProp]
  ? ResponsiveProp<DeclarationKey<Extract<Config, DeclarationProp>>, Omitted>
  : ResponsiveProp<ThemedScaleValue<Config>, Omitted>;

type RawSelectorKey = `${string}&${string}`;

type PublishedAliasKeys = Extract<
  keyof Conditions | keyof Selectors,
  `_${string}`
>;

type KnownUnderscoreKey = [PublishedAliasKeys] extends [never]
  ? `_${string}`
  : BuiltInSelectorAlias | BuiltInConditionAlias | PublishedAliasKeys;

/** A keyword with `!important`, which CSS accepts after any declared value,
 *  or the shorthand `!` that means the same. */
type Important<Value> = Value extends string
  ? `${Value} !important` | `${Value}!`
  : never;

// A style value may carry `!important`. A registered prop's value does not:
// widening every prop's union overflows (TS2590) where a consumer relates a
// component's whole props to an annotation or a spread.
type PassThroughProp<K extends keyof PropertyTypes> = K extends 'animationName'
  ? ResponsiveProp<KeyframeRef<string> | PropertyTypes[K]>
  : ResponsiveProp<PropertyTypes[K] | Important<PropertyTypes<never>[K]>>;

type UnderscoreBlockMembers<Config extends Record<string, SystemProp>> = {
  [K in KnownUnderscoreKey]?: ThemedBlockBody<Config>;
};

/**
 * Must stay a FIXED type: an arm referencing the outer inferred `Props` is
 * reverse-mapped away at `.styles()` and stops checking nested values.
 */
type ThemedBlockBody<Config extends Record<string, SystemProp>> = {
  [K in Exclude<keyof PropertyTypes, keyof Config>]?: PassThroughProp<K>;
} & {
  [P in keyof Config]?: ThemedScale<Config[P]>;
} & {
  [K in RawSelectorKey | RawAtRuleKey]?: ThemedBlockBody<Config>;
} & UnderscoreBlockMembers<Config>;

export type ThemedCSSProps<Props, Config extends Record<string, SystemProp>> = {
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

export type ThemedCSSPropMap<
  Props,
  Config extends Record<string, SystemProp>,
> = {
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

/**
 * Built-in media-condition aliases. A static union, never members of the
 * augmentable `Conditions`: membership would make the `_` namespace validating
 * for every consumer. Every alias needs a matching entry in
 * `BUILT_IN_CONDITIONS` in conditions.ts, and only type tests catch that drift.
 */
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
  [K in BuiltInSelectorAlias | Extract<keyof Selectors, `_${string}`>]?:
    | Partial<GroupPropValues>
    | undefined;
};
