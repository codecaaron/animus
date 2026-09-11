import type {
  ComponentProps,
  ComponentPropsWithRef,
  ComponentType,
  ForwardRefExoticComponent,
  JSX,
  ReactNode,
} from 'react';

import type { AnimusExtended } from '../AnimusExtended';
import type {
  AbstractParser,
  CSSPropMap,
  CSSProps,
  Prop,
  SelectorAliasProps,
  SystemProps,
  ThemedScale,
  VariantConfig,
} from './config';
import type { AbstractProps } from './props';

// Brands carrying pre-computed types: compose() reads them by indexed access,
// since inferring through ForwardRefExoticComponent explodes type depth.

declare const ConsumerProps: unique symbol;
declare const VariantConfigBrand: unique symbol;

/**
 * Structural constraint for compose() slots. `any` as P avoids expanding the
 * full AnimusComponent intersection, which hits TS2590 on large registries.
 */
export type AnyBrandedComponent = ForwardRefExoticComponent<any> & {
  readonly [ConsumerProps]: unknown;
  readonly [VariantConfigBrand]: unknown;
  extend: () => unknown;
};

type ExtendFn<
  PR extends Record<string, Prop>,
  GR extends Record<string, (keyof PR)[]>,
  BS,
  V,
  S,
  AG,
  CP,
> = {
  extend: () => AnimusExtended<
    PR,
    GR,
    BS & CSSProps<AbstractProps, SystemProps<AbstractParser>>,
    V & Record<string, VariantConfig>,
    S & CSSPropMap<AbstractProps, SystemProps<AbstractParser>>,
    AG & Record<string, true>,
    CP & Record<string, Prop>
  >;
};

type ActiveGroupPropNames<
  PR extends Record<string, Prop>,
  GR extends Record<string, (keyof PR)[]>,
  AG,
> =
  | GR[Extract<keyof StripIndex<AG>, keyof GR>][number]
  | Extract<keyof StripIndex<AG>, keyof PR>;

type GroupProps<
  PR extends Record<string, Prop>,
  GR extends Record<string, (keyof PR)[]>,
  AG,
> = {
  [
    K in ActiveGroupPropNames<PR, GR, AG> as K extends string ? K : never
  ]?: ThemedScale<PR[K & keyof PR]>;
};

type CustomPropValues<CP extends Record<string, Prop>> = {
  [K in keyof StripIndex<CP>]?: ThemedScale<
    StripIndex<CP>[K & keyof StripIndex<CP>]
  >;
};

type StripIndex<T> = {
  [
    K in keyof T as string extends K ? never : number extends K ? never : K
  ]: T[K];
};

type VariantProps<V> = {
  [K in keyof StripIndex<V>]?: StripIndex<V>[K] extends VariantConfig
    ? keyof StripIndex<V>[K]['variants']
    : string;
};

type StateProps<S> = { [K in keyof StripIndex<S>]?: boolean };

/**
 * Keys Animus consumes; the runtime strips them before DOM forwarding.
 * Unioned per source — `keyof` of the intersection hits TS2590 on emit.
 */
type AnimusManagedKeys<
  PR extends Record<string, Prop>,
  GR extends Record<string, (keyof PR)[]>,
  V,
  S,
  AG,
  CP extends Record<string, Prop>,
> =
  | ActiveGroupPropNames<PR, GR, AG>
  | keyof VariantProps<V>
  | keyof StateProps<S>
  | keyof StripIndex<CP>
  | 'as'
  | 'asChild'
  | 'className'
  | 'children';

/**
 * Named alias so group props and selector-alias values share one mapped type;
 * inlining it re-derives the type instead of hitting the structural cache.
 */
type ResolvedGroupProps<
  PR extends Record<string, Prop>,
  GR extends Record<string, (keyof PR)[]>,
  AG,
> = GroupProps<PR, GR, AG>;

type AnimusConsumerProps<
  El extends keyof JSX.IntrinsicElements,
  PR extends Record<string, Prop>,
  GR extends Record<string, (keyof PR)[]>,
  V,
  S,
  AG,
  CP extends Record<string, Prop>,
> = Omit<ComponentPropsWithRef<El>, AnimusManagedKeys<PR, GR, V, S, AG, CP>> &
  ResolvedGroupProps<PR, GR, AG> &
  VariantProps<V> &
  StateProps<S> &
  CustomPropValues<CP> &
  SelectorAliasProps<ResolvedGroupProps<PR, GR, AG>> & {
    as?: keyof JSX.IntrinsicElements | ComponentType<any>;
    asChild?: boolean;
    className?: string;
    children?: ReactNode;
  };

export type AnimusComponent<
  El extends keyof JSX.IntrinsicElements,
  PR extends Record<string, Prop>,
  GR extends Record<string, (keyof PR)[]>,
  BS,
  V,
  S,
  AG,
  CP extends Record<string, Prop>,
> = ForwardRefExoticComponent<AnimusConsumerProps<El, PR, GR, V, S, AG, CP>> &
  ExtendFn<PR, GR, BS, V, S, AG, CP> & {
    readonly [ConsumerProps]: AnimusConsumerProps<El, PR, GR, V, S, AG, CP>;
    readonly [VariantConfigBrand]: V;
    readonly variantDefaults: Readonly<Record<string, string>>;
  };

/**
 * Managed keys are removed from the wrapped component's props first —
 * intersecting a variant union with its own type for a key collapses to never.
 */
type AnimusWrappedConsumerProps<
  C extends ComponentType<any>,
  PR extends Record<string, Prop>,
  GR extends Record<string, (keyof PR)[]>,
  V,
  S,
  CP extends Record<string, Prop>,
> = Omit<ComponentProps<C>, AnimusManagedKeys<PR, GR, V, S, {}, CP>> &
  Record<string, any> &
  GroupProps<PR, GR, {}> &
  VariantProps<V> &
  StateProps<S> &
  SelectorAliasProps<GroupProps<PR, GR, {}>> & {
    as?: keyof JSX.IntrinsicElements | ComponentType<any>;
    asChild?: boolean;
    className?: string;
    children?: ReactNode;
  };

export type AnimusWrappedComponent<
  C extends ComponentType<any>,
  PR extends Record<string, Prop>,
  GR extends Record<string, (keyof PR)[]>,
  BS,
  V,
  S,
  AG,
  CP extends Record<string, Prop>,
> = ForwardRefExoticComponent<AnimusWrappedConsumerProps<C, PR, GR, V, S, CP>> &
  ExtendFn<PR, GR, BS, V, S, AG, CP> & {
    readonly [ConsumerProps]: AnimusWrappedConsumerProps<C, PR, GR, V, S, CP>;
    readonly [VariantConfigBrand]: V;
    readonly variantDefaults: Readonly<Record<string, string>>;
  };

type StripStringIndex<T> = {
  [K in keyof T as string extends K ? never : K]: T[K];
};

export type ExtractVariantsConfig<C> = C extends {
  readonly [VariantConfigBrand]: infer V;
}
  ? StripStringIndex<V>
  : C extends { extend: () => { variants: infer V } }
    ? StripStringIndex<V>
    : {};

export type VariantPropsOf<C> = VariantProps<ExtractVariantsConfig<C>>;

type RootSlot<Slots extends Record<string, unknown>> =
  'Root' extends keyof Slots ? Slots['Root'] : never;

type RootVariantKeys<Slots extends Record<string, unknown>> =
  keyof VariantPropsOf<RootSlot<Slots>> & string;

export type SharedConfig<Slots extends Record<string, unknown>> = {
  [K in RootVariantKeys<Slots>]?: true;
};

type SealedProps<C> = C extends {
  readonly [ConsumerProps]: infer P;
}
  ? Omit<P, 'extend'> & { className?: string; children?: ReactNode }
  : C extends ForwardRefExoticComponent<infer P>
    ? Omit<P, 'extend'> & { className?: string; children?: ReactNode }
    : never;

export type ComposedFamily<Slots extends Record<string, unknown>> = {
  [K in keyof Slots]: ForwardRefExoticComponent<SealedProps<Slots[K]>>;
};
