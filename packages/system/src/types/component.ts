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

/**
 * Union of all prop keys that Animus manages. These override HTML attributes
 * of the same name — the type-level equivalent of shouldForwardProp / isPropValid.
 * The runtime (filterProps in createComponent) already strips these before
 * forwarding to the DOM element; this ensures the types match.
 *
 * Computed from each source individually (not keyof an intersection) to
 * avoid TS2590 "union type too complex" during declaration emit.
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
  | keyof CP
  | 'as'
  | 'className'
  | 'children';

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
  Omit<ComponentPropsWithRef<El>, AnimusManagedKeys<PR, GR, V, S, AG, CP>> &
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

// ─── compose() Type Infrastructure ─────────────────────────────

/**
 * Strip string index signatures from a type, keeping only
 * explicitly-declared keys. Needed because ExtendFn widens V
 * with `& Record<string, VariantConfig>`.
 */
type StripStringIndex<T> = {
  [K in keyof T as string extends K ? never : K]: T[K];
};

/**
 * Extract the raw variant config (V generic) from an AnimusComponent.
 * Routes through extend()'s return type → .variants field, then
 * strips the string index signature added by ExtendFn's intersection.
 */
export type ExtractVariantsConfig<C> = C extends {
  extend: () => { variants: infer V };
}
  ? StripStringIndex<V>
  : {};

/**
 * Extract consumer-facing variant props from an AnimusComponent.
 * Returns { size?: 'sm' | 'lg', variant?: 'fill' | 'ghost', ... }
 */
export type VariantPropsOf<C> = VariantProps<ExtractVariantsConfig<C>>;

/**
 * Union of all variant prop keys across all slots.
 */
type AllVariantKeys<Slots extends Record<string, unknown>> =
  keyof VariantPropsOf<Slots[keyof Slots]>;

/**
 * Extract the Root slot component from a Slots record.
 * Convention: the key 'root' or 'Root' (case-insensitive match).
 */
type RootSlot<Slots extends Record<string, unknown>> = {
  [K in keyof Slots]: Lowercase<K & string> extends 'root' ? Slots[K] : never;
}[keyof Slots];

/**
 * Variant keys that exist on the Root slot.
 * Only Root variant keys are valid as shared keys — Root is the
 * provider and must accept the prop to pass it through context.
 */
type RootVariantKeys<Slots extends Record<string, unknown>> =
  keyof VariantPropsOf<RootSlot<Slots>> & string;

/**
 * Configuration object for shared variant propagation.
 * Keys are variant names from Root. Value is `true` to share.
 * Non-Root slots that have matching variant keys receive the
 * value from context. Slots without the key are unaffected.
 *
 * @example
 * compose(slots, { shared: { density: true, intent: true } })
 */
export type SharedConfig<Slots extends Record<string, unknown>> = {
  [K in RootVariantKeys<Slots>]?: true;
};

/**
 * @deprecated Use SharedConfig instead. SharedVariantKeys required
 * every shared key to exist on ALL slots. SharedConfig only requires
 * the key to exist on Root.
 */
export type SharedVariantKeys<Slots extends Record<string, unknown>> = {
  [K in AllVariantKeys<Slots> & string]: keyof Slots extends infer S
    ? S extends keyof Slots
      ? K extends keyof VariantPropsOf<Slots[S]>
        ? true
        : false
      : never
    : never extends false
      ? never
      : K;
}[AllVariantKeys<Slots> & string];

/**
 * Extract the component props from a ForwardRefExoticComponent,
 * including AnimusComponent (which extends it).
 */
type PropsOf<C> = C extends ForwardRefExoticComponent<infer P> ? P : never;

/**
 * Sealed child slot — accepts source component's own props.
 * Shared variant values come from context as defaults;
 * direct props override context. Slots that don't have a
 * shared variant key simply ignore it.
 */
export type ComposedSlot<C> = ForwardRefExoticComponent<
  Omit<PropsOf<C>, 'extend'> & {
    className?: string;
    children?: ReactNode;
  }
>;

/**
 * Sealed Root slot — KEEPS shared variant props (it's the provider).
 * Also accepts children for the Provider wrapper.
 */
export type ComposedRoot<C> = ForwardRefExoticComponent<
  Omit<PropsOf<C>, 'extend'> & {
    className?: string;
    children?: ReactNode;
  }
>;

/**
 * The output of compose() — a record of capitalized slot names mapped
 * to sealed React components. Root gets ComposedRoot (keeps shared props),
 * all other slots get ComposedSlot (own props, context defaults).
 */
export type ComposedFamily<Slots extends Record<string, unknown>> = {
  [K in keyof Slots as Capitalize<K & string>]: Lowercase<
    K & string
  > extends 'root'
    ? ComposedRoot<Slots[K]>
    : ComposedSlot<Slots[K]>;
};
