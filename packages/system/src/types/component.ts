import type {
  ComponentPropsWithRef,
  ForwardRefExoticComponent,
  ReactNode,
} from 'react';

import type { AnimusExtended } from '../AnimusExtended';
import type {
  AbstractParser,
  CSSPropMap,
  CSSProps,
  Prop,
  Scale,
  SystemProps,
  VariantConfig,
} from './config';
import type { AbstractProps } from './props';
import type { BaseTheme } from './theme';

type ExtendFn<
  T extends BaseTheme,
  PR extends Record<string, Prop>,
  GR extends Record<string, (keyof PR)[]>,
  BS,
  V,
  S,
  AG,
  CP,
> = {
  extend: () => AnimusExtended<
    T,
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
 * For pragmatic type inference, we use Scale<PR[K], T> for each prop.
 */
type GroupProps<
  T extends BaseTheme,
  PR extends Record<string, Prop>,
  GR extends Record<string, (keyof PR)[]>,
  AG,
> = {
  [K in ActiveGroupPropNames<PR, GR, AG> as K extends string
    ? K
    : never]?: Scale<PR[K & keyof PR], T>;
};

/**
 * Compute custom prop types from .props() config.
 * Each key K in CP maps to Scale<CP[K], T>.
 */
type CustomPropValues<CP extends Record<string, Prop>, T extends BaseTheme> = {
  [K in keyof CP]?: Scale<CP[K], T>;
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
  T extends BaseTheme,
  PR extends Record<string, Prop>,
  GR extends Record<string, (keyof PR)[]>,
  BS,
  V,
  S,
  AG,
  CP extends Record<string, Prop>,
> = ForwardRefExoticComponent<
  ComponentPropsWithRef<El> &
    GroupProps<T, PR, GR, AG> &
    VariantProps<V> &
    StateProps<S> &
    CustomPropValues<CP, T> & { className?: string; children?: ReactNode }
> &
  ExtendFn<T, PR, GR, BS, V, S, AG, CP>;

/** Component type for .asComponent() — wraps an existing React component. */
export type AnimusWrappedComponent<
  T extends BaseTheme,
  PR extends Record<string, Prop>,
  GR extends Record<string, (keyof PR)[]>,
  BS,
  V,
  S,
  AG,
  CP,
> = ForwardRefExoticComponent<
  Record<string, any> &
    GroupProps<T, PR, GR, {}> &
    VariantProps<V> &
    StateProps<S> & { className?: string; children?: ReactNode }
> &
  ExtendFn<T, PR, GR, BS, V, S, AG, CP>;
