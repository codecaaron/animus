import type {
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
  SystemProp,
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
  PR extends Record<string, SystemProp>,
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
    CP & Record<string, SystemProp>
  >;
};

type ActiveGroupPropNames<
  PR extends Record<string, SystemProp>,
  GR extends Record<string, (keyof PR)[]>,
  AG,
> =
  | GR[Extract<keyof StripIndex<AG>, keyof GR>][number]
  | Extract<keyof StripIndex<AG>, keyof PR>;

type GroupProps<
  PR extends Record<string, SystemProp>,
  GR extends Record<string, (keyof PR)[]>,
  AG,
> = {
  [K in ActiveGroupPropNames<PR, GR, AG> as K extends string ? K : never]?:
    | ThemedScale<PR[K & keyof PR], undefined>
    | undefined;
};

type CustomPropValues<CP extends Record<string, SystemProp>> = {
  [K in keyof StripIndex<CP>]?:
    | ThemedScale<StripIndex<CP>[K & keyof StripIndex<CP>], undefined>
    | undefined;
};

type StripIndex<T> = {
  [
    K in keyof T as string extends K ? never : number extends K ? never : K
  ]: T[K];
};

/**
 * Each axis's options, read from its `variants` table alone. A declaration
 * build without `exactOptionalPropertyTypes` prints a config's optional fields
 * as `?: X | undefined`, so testing the whole config against `VariantConfig`
 * fails in a consumer that sets it, and the axis would widen to `string`.
 */
type VariantProps<V> = {
  [K in keyof StripIndex<V>]?: StripIndex<V>[K] extends {
    variants: infer Options;
  }
    ? keyof Options | undefined
    : string | undefined;
};

type StateProps<S> = { [K in keyof StripIndex<S>]?: boolean | undefined };

/**
 * Keys Animus consumes; the runtime strips them before DOM forwarding.
 * Unioned per source — `keyof` of the intersection hits TS2590 on emit.
 */
type AnimusManagedKeys<
  PR extends Record<string, SystemProp>,
  GR extends Record<string, (keyof PR)[]>,
  V,
  S,
  AG,
  CP extends Record<string, SystemProp>,
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
  PR extends Record<string, SystemProp>,
  GR extends Record<string, (keyof PR)[]>,
  AG,
> = GroupProps<PR, GR, AG>;

/** What `as` names on a string terminal: an element tag or a component. */
type AsTarget = keyof JSX.IntrinsicElements | ComponentType<any>;

/** Everything the builder admitted, whichever element renders. */
type AnimusOwnProps<
  PR extends Record<string, SystemProp>,
  GR extends Record<string, (keyof PR)[]>,
  V,
  S,
  AG,
  CP extends Record<string, SystemProp>,
> = ResolvedGroupProps<PR, GR, AG> &
  VariantProps<V> &
  StateProps<S> &
  CustomPropValues<CP> &
  SelectorAliasProps<ResolvedGroupProps<PR, GR, AG>> & {
    asChild?: boolean | undefined;
    className?: string | undefined;
    children?: ReactNode;
  };

/** A string terminal rendered as `E`: E's native props and ref, then Animus's. */
type AnimusNativeProps<
  E extends AsTarget,
  PR extends Record<string, SystemProp>,
  GR extends Record<string, (keyof PR)[]>,
  V,
  S,
  AG,
  CP extends Record<string, SystemProp>,
> = Omit<ComponentPropsWithRef<E>, AnimusManagedKeys<PR, GR, V, S, AG, CP>> &
  AnimusOwnProps<PR, GR, V, S, AG, CP>;

/**
 * The default element's props with `as` open to any target, as compose()
 * reads a slot.
 */
type AnimusConsumerProps<
  El extends keyof JSX.IntrinsicElements,
  PR extends Record<string, SystemProp>,
  GR extends Record<string, (keyof PR)[]>,
  V,
  S,
  AG,
  CP extends Record<string, SystemProp>,
> = AnimusNativeProps<El, PR, GR, V, S, AG, CP> & { as?: AsTarget | undefined };

/**
 * The element `As` selects, or the default element when `As` stays at its
 * constraint.
 */
type ElementFor<As extends AsTarget, El extends keyof JSX.IntrinsicElements> = [
  AsTarget,
] extends [As]
  ? El
  : As;

/**
 * The default element's signature comes first; without it the builder classes
 * hit TS2589 or check in seconds instead of under one. The polymorphic
 * signature comes last: `ComponentProps` and `createElement` read the last
 * signature, and a rejected JSX call reports its error, naming the prop the
 * selected element or component lacks.
 */
export type AnimusComponent<
  El extends keyof JSX.IntrinsicElements,
  PR extends Record<string, SystemProp>,
  GR extends Record<string, (keyof PR)[]>,
  BS,
  V,
  S,
  AG,
  CP extends Record<string, SystemProp>,
> = ForwardRefExoticComponent<
  AnimusNativeProps<El, PR, GR, V, S, AG, CP> & { as?: El | undefined }
> &
  (<As extends AsTarget>(
    props: AnimusNativeProps<ElementFor<As, El>, PR, GR, V, S, AG, CP> & {
      as?: As | undefined;
    }
  ) => ReactNode) &
  ExtendFn<PR, GR, BS, V, S, AG, CP> & {
    readonly [ConsumerProps]: AnimusConsumerProps<El, PR, GR, V, S, AG, CP>;
    readonly [VariantConfigBrand]: V;
    readonly variantDefaults: Readonly<Record<string, string>>;
  };

/** `Omit` per union member, so a discriminated-union target keeps each arm. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/**
 * The wrapped component's own props, with its ref, then exactly what the
 * builder admitted: the active groups' props, variants, states and custom
 * props. Managed keys are removed from the wrapped component's props first —
 * intersecting a variant union with its own type for a key collapses to never.
 * `as` and `asChild` are the target's own, since the runtime hands them to it:
 * a target without them does not offer them.
 */
type AnimusWrappedConsumerProps<
  C extends ComponentType<any>,
  PR extends Record<string, SystemProp>,
  GR extends Record<string, (keyof PR)[]>,
  V,
  S,
  AG,
  CP extends Record<string, SystemProp>,
> = DistributiveOmit<
  ComponentPropsWithRef<C>,
  Exclude<AnimusManagedKeys<PR, GR, V, S, AG, CP>, 'as' | 'asChild'>
> &
  ResolvedGroupProps<PR, GR, AG> &
  VariantProps<V> &
  StateProps<S> &
  CustomPropValues<CP> &
  SelectorAliasProps<ResolvedGroupProps<PR, GR, AG>> & {
    className?: string | undefined;
    children?: ReactNode;
  };

export type AnimusWrappedComponent<
  C extends ComponentType<any>,
  PR extends Record<string, SystemProp>,
  GR extends Record<string, (keyof PR)[]>,
  BS,
  V,
  S,
  AG,
  CP extends Record<string, SystemProp>,
> = ForwardRefExoticComponent<
  AnimusWrappedConsumerProps<C, PR, GR, V, S, AG, CP>
> &
  ExtendFn<PR, GR, BS, V, S, AG, CP> & {
    readonly [ConsumerProps]: AnimusWrappedConsumerProps<
      C,
      PR,
      GR,
      V,
      S,
      AG,
      CP
    >;
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
  ? Omit<P, 'extend'> & {
      className?: string | undefined;
      children?: ReactNode;
    }
  : C extends ForwardRefExoticComponent<infer P>
    ? Omit<P, 'extend'> & {
        className?: string | undefined;
        children?: ReactNode;
      }
    : never;

export type ComposedFamily<Slots extends Record<string, unknown>> = {
  [K in keyof Slots]: ForwardRefExoticComponent<SealedProps<Slots[K]>>;
};

/** An `asClass()` resolver's input: exactly the props the builder admitted. */
export type AnimusClassProps<
  PR extends Record<string, SystemProp>,
  GR extends Record<string, (keyof PR)[]>,
  V,
  S,
  AG,
  CP extends Record<string, SystemProp>,
> = ResolvedGroupProps<PR, GR, AG> &
  VariantProps<V> &
  StateProps<S> &
  CustomPropValues<CP> &
  SelectorAliasProps<ResolvedGroupProps<PR, GR, AG>>;

/**
 * The `asClass()` input of the builder `B`, read from the registries its
 * public fields carry. Resolved from the receiver at the call, so the
 * builder classes' own type parameters never carry it.
 */
export type BuilderClassProps<B> = B extends {
  propRegistry: infer PR extends Record<string, SystemProp>;
}
  ? B extends {
      groupRegistry: infer GR extends Record<string, (keyof PR)[]>;
      variants: infer V;
      statesConfig: infer S;
      activeGroups: infer AG;
      custom: infer CP extends Record<string, SystemProp>;
    }
    ? AnimusClassProps<PR, GR, V, S, AG, CP>
    : never
  : never;
