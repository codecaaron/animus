import type {
  ComponentPropsWithRef,
  ComponentType,
  ForwardRefExoticComponent,
  ReactNode,
} from 'react';

import type { AnimusExtended } from '../AnimusExtended';
import type {
  AbstractParser,
  CSSPropMap,
  CSSProps,
  Prop,
  SystemProps,
  ThemedScale,
  VariantConfig,
} from './config';
import type { AbstractProps } from './props';

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

/**
 * Compute the group prop names from active groups.
 * GR maps group names to prop name arrays, AG records which groups are active.
 * The result is the union of prop names from all active groups.
 */
type ActiveGroupPropNames<
  PR extends Record<string, Prop>,
  GR extends Record<string, (keyof PR)[]>,
  AG,
> = GR[Extract<keyof AG, keyof GR>][number];

/**
 * Compute the group system props — each active group prop accepts its scale-resolved type.
 * Uses the augmented Theme interface via ThemedScale (no generic T needed).
 */
type GroupProps<
  PR extends Record<string, Prop>,
  GR extends Record<string, (keyof PR)[]>,
  AG,
> = {
  [K in ActiveGroupPropNames<PR, GR, AG> as K extends string
    ? K
    : never]?: ThemedScale<PR[K & keyof PR]>;
};

/**
 * Compute custom prop types from .props() config.
 * Each key K in CP maps to ThemedScale<CP[K]>.
 */
type CustomPropValues<CP extends Record<string, Prop>> = {
  [K in keyof CP]?: ThemedScale<CP[K]>;
};

/**
 * Compute variant props — each variant key accepts one of its variant values.
 * Guard: if V widened to string index signature (Record<string, VariantConfig>),
 * produce {} instead of { [x: string]?: string } which would reject children.
 */
type VariantProps<V> = string extends keyof V
  ? {}
  : {
      [K in keyof V]?: V[K] extends VariantConfig
        ? keyof V[K]['variants']
        : string;
    };

/**
 * Compute state props — each state key is a boolean toggle.
 * Same guard against widened index signatures.
 */
type StateProps<S> = string extends keyof S ? {} : { [K in keyof S]?: boolean };

/** Component type for .asElement() — HTML element tag with full Animus props. */
export type AnimusComponent<
  El extends keyof JSX.IntrinsicElements,
  PR extends Record<string, Prop>,
  GR extends Record<string, (keyof PR)[]>,
  BS,
  V,
  S,
  AG,
  CP extends Record<string, Prop>,
> = ForwardRefExoticComponent<
  ComponentPropsWithRef<El> &
    GroupProps<PR, GR, AG> &
    VariantProps<V> &
    StateProps<S> &
    CustomPropValues<CP> & {
      as?: keyof JSX.IntrinsicElements | ComponentType<{ className?: string }>;
      className?: string;
      children?: ReactNode;
    }
> &
  ExtendFn<PR, GR, BS, V, S, AG, CP>;

/** Component type for .asComponent() — wraps an existing React component. */
export type AnimusWrappedComponent<
  PR extends Record<string, Prop>,
  GR extends Record<string, (keyof PR)[]>,
  BS,
  V,
  S,
  AG,
  CP,
> = ForwardRefExoticComponent<
  Record<string, any> &
    GroupProps<PR, GR, {}> &
    VariantProps<V> &
    StateProps<S> & {
      as?: keyof JSX.IntrinsicElements | ComponentType<{ className?: string }>;
      className?: string;
      children?: ReactNode;
    }
> &
  ExtendFn<PR, GR, BS, V, S, AG, CP>;
