import { Theme } from '@emotion/react';

import { CSSPropMap, CSSProps } from '../types/config';
import { DefaultCSSPropertyValue, PropertyTypes } from '../types/properties';
import { AbstractProps, ResponsiveProp, ThemeProps } from '../types/props';
import { CSSObject } from '../types/shared';
import { AllUnionKeys, Key, KeyFromUnion } from '../types/utils';

export type MapScale = Record<string | number, string | number>;
export type ArrayScale = readonly (string | number | CSSObject)[] & {
  length: 0;
};

export interface BaseProperty {
  property: keyof PropertyTypes;
  properties?: readonly (keyof PropertyTypes)[];
}

export interface Prop extends BaseProperty {
  scale?: keyof Theme | MapScale | ArrayScale;
  variable?: string;
  transform?: (
    val: string | number,
    prop?: string,
    props?: AbstractProps
  ) => string | number | CSSObject;
}

export interface AbstractPropTransformer extends Prop {
  prop: string;
  styleFn: (value: unknown, prop: string, props: AbstractProps) => CSSObject;
}

export interface AbstractParser {
  (props: AbstractProps, orderProps?: boolean): CSSObject;
  propNames: string[];
  config: Record<string, AbstractPropTransformer>;
}

export type PropertyValues<
  Property extends keyof PropertyTypes,
  All extends boolean = false,
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

/**
 * Value or something
 */
export type Scale<Config extends Prop> = ResponsiveProp<
  ScaleValue<Config> | ((theme: Theme) => ScaleValue<Config>)
>;

export interface TransformFn<P extends string, Config extends Prop> {
  (
    value: Scale<Config>,
    prop: P,
    props: ThemeProps<{ [K in P]?: Scale<Config> }>
  ): CSSObject;
}

export interface PropTransformer<P extends string, C extends Prop>
  extends AbstractPropTransformer,
    Prop {
  prop: P;
  styleFn: TransformFn<P, C>;
}

export type TransformerMap<Config extends Record<string, Prop>> = {
  [P in Key<keyof Config>]: PropTransformer<Key<P>, Config[P]>;
};
export interface Parser<
  Config extends Record<string, AbstractPropTransformer>,
> {
  (props: ParserProps<Config>, orderProps?: boolean): CSSObject;
  propNames: (keyof Config)[];
  config: Config;
}

export type Compose<Args extends AbstractParser[]> = {
  [K in AllUnionKeys<Args[number]['config']>]: KeyFromUnion<
    Args[number]['config'],
    K
  >;
};
export interface Variant<P extends AbstractParser> {
  <
    Keys extends keyof Props,
    Base extends AbstractProps,
    Props extends Record<Keys, AbstractProps>,
    PropKey extends Readonly<string> = 'variant',
  >(options: {
    prop?: PropKey;
    defaultVariant?: keyof Props;
    base?: CSSProps<Base, SystemProps<P>>;
    variants: CSSPropMap<Props, SystemProps<P>>;
  }): (props: VariantProps<PropKey, Keys | false> & ThemeProps) => CSSObject;
}

export interface States<P extends AbstractParser> {
  <Props extends Record<string, AbstractProps>>(
    states: CSSPropMap<Props, SystemProps<P>>
  ): (props: Partial<Record<keyof Props, boolean>> & ThemeProps) => CSSObject;
}

export interface CSS<P extends AbstractParser> {
  <Props extends AbstractProps>(
    config: CSSProps<Props, SystemProps<P>>
  ): (props: ThemeProps) => CSSObject;
}

export type ParserProps<
  Config extends Record<string, AbstractPropTransformer>,
> = ThemeProps<{
  [P in keyof Config]?: Parameters<Config[P]['styleFn']>[2][Config[P]['prop']];
}>;

export type SystemProps<P extends AbstractParser> = {
  [K in keyof Omit<Parameters<P>[0], 'theme'>]: Omit<
    Parameters<P>[0],
    'theme'
  >[K];
};

export type VariantProps<T extends string, V> = {
  [Key in T]?: V;
};

export type Arg<T extends (...args: any) => any> = Parameters<T>[0];
export interface PropConfig {
  props: {
    [i: string]: Prop;
  };
  groups: {
    [i: string]: (string | symbol | number)[];
  };
}
