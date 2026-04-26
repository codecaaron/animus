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
  SelectorAliasProps,
  SystemProps,
  ThemedScale,
  VariantConfig,
} from './config';
import type { AbstractProps } from './props';

// ─── Phantom Brands ───────────────────────────────────────────
//
// Symbol-keyed properties that carry pre-computed types on
// AnimusComponent. compose() reads these via direct indexed
// access instead of conditional inference through
// ForwardRefExoticComponent, avoiding depth explosion in
// environments with extra type-checking overhead (Next.js TS plugin).

declare const ConsumerProps: unique symbol;
declare const VariantConfigBrand: unique symbol;

/**
 * Minimal structural constraint for compose() slots.
 * Extends ForwardRefExoticComponent<any> for createElement compat,
 * plus the phantom brands. Using `any` as P avoids expanding the
 * full 8-generic AnimusComponent intersection, preventing TS2590
 * "union type too complex" when the property registry is large.
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

/**
 * Compute the group prop names from active groups.
 * GR maps group names to prop name arrays, AG records which groups are active.
 * The result is the union of prop names from all active groups.
 */
type ActiveGroupPropNames<
  PR extends Record<string, Prop>,
  GR extends Record<string, (keyof PR)[]>,
  AG,
> =
  | GR[Extract<keyof StripIndex<AG>, keyof GR>][number]
  | Extract<keyof StripIndex<AG>, keyof PR>;

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
 * StripIndex removes index signatures from ExtendFn constraint intersections.
 */
type CustomPropValues<CP extends Record<string, Prop>> = {
  [K in keyof StripIndex<CP>]?: ThemedScale<
    StripIndex<CP>[K & keyof StripIndex<CP>]
  >;
};

/** Strip string/number index signatures, keeping only literal keys. */
type StripIndex<T> = {
  [K in keyof T as string extends K
    ? never
    : number extends K
      ? never
      : K]: T[K];
};

/**
 * Compute variant props — each variant key accepts one of its variant values.
 * StripIndex removes index signatures from ExtendFn constraint intersections.
 */
type VariantProps<V> = {
  [K in keyof StripIndex<V>]?: StripIndex<V>[K] extends VariantConfig
    ? keyof StripIndex<V>[K]['variants']
    : string;
};

/**
 * Compute state props — each state key is a boolean toggle.
 * StripIndex removes index signatures from ExtendFn constraint intersections.
 */
type StateProps<S> = { [K in keyof StripIndex<S>]?: boolean };

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
  | keyof StripIndex<CP>
  | 'as'
  | 'asChild'
  | 'className'
  | 'children';

/**
 * The consumer-facing props for an AnimusComponent, computed once at
 * definition time. Used both as ForwardRefExoticComponent's P parameter
 * and carried on the ConsumerProps brand for zero-inference access.
 */
/**
 * Resolved group props — computed once, reused for both direct group
 * props and selector alias value types. Ensures TypeScript's structural
 * cache hits on the same mapped type instead of re-deriving.
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
    as?: keyof JSX.IntrinsicElements | ComponentType<{ className?: string }>;
    asChild?: boolean;
    className?: string;
    children?: ReactNode;
  };

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
> = ForwardRefExoticComponent<AnimusConsumerProps<El, PR, GR, V, S, AG, CP>> &
  ExtendFn<PR, GR, BS, V, S, AG, CP> & {
    readonly [ConsumerProps]: AnimusConsumerProps<El, PR, GR, V, S, AG, CP>;
    readonly [VariantConfigBrand]: V;
  };

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
    StateProps<S> &
    SelectorAliasProps<GroupProps<PR, GR, {}>> & {
      as?: keyof JSX.IntrinsicElements | ComponentType<{ className?: string }>;
      asChild?: boolean;
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
 * Prefers the VariantConfigBrand (direct indexed access, no conditional
 * inference). Falls back to extend() inference for non-branded components.
 */
export type ExtractVariantsConfig<C> = C extends {
  readonly [VariantConfigBrand]: infer V;
}
  ? StripStringIndex<V>
  : C extends { extend: () => { variants: infer V } }
    ? StripStringIndex<V>
    : {};

/**
 * Extract consumer-facing variant props from an AnimusComponent.
 * Returns { size?: 'sm' | 'lg', variant?: 'fill' | 'ghost', ... }
 */
export type VariantPropsOf<C> = VariantProps<ExtractVariantsConfig<C>>;

/**
 * Extract the Root slot component from a Slots record.
 * Convention: the key must be literally 'Root' (exact match).
 */
type RootSlot<Slots extends Record<string, unknown>> =
  'Root' extends keyof Slots ? Slots['Root'] : never;

/**
 * Variant keys that exist on the Root slot.
 * Only Root variant keys are valid as shared keys — Root is the
 * source of truth and must accept the prop for CSS cascade to work.
 */
type RootVariantKeys<Slots extends Record<string, unknown>> =
  keyof VariantPropsOf<RootSlot<Slots>> & string;

/**
 * Configuration object for shared variant propagation.
 * Keys are variant names from Root. Value is `true` to share.
 * Non-Root slots that have matching variant keys receive the
 * value via CSS cascade. Slots without the key are unaffected.
 *
 * @example
 * compose(slots, { shared: { density: true, intent: true } })
 */
export type SharedConfig<Slots extends Record<string, unknown>> = {
  [K in RootVariantKeys<Slots>]?: true;
};

/**
 * Seal a component's props for compose output.
 * Prefers the ConsumerProps brand (direct indexed access — zero conditional
 * inference) over PropsOf (which must structurally match and infer through
 * ForwardRefExoticComponent). This eliminates the depth explosion that
 * occurs in Next.js environments where the TS plugin adds overhead.
 */
type SealedProps<C> = C extends {
  readonly [ConsumerProps]: infer P;
}
  ? Omit<P, 'extend'> & { className?: string; children?: ReactNode }
  : C extends ForwardRefExoticComponent<infer P>
    ? Omit<P, 'extend'> & { className?: string; children?: ReactNode }
    : never;

/**
 * The output of compose() — a record of slot names mapped to sealed
 * React components. Slot keys must be PascalCase (Root, Control, Label).
 * Props are pre-resolved per-slot via SealedProps to avoid depth
 * explosion when this type appears inside Next.js generated
 * `typeof import()` contexts.
 */
export type ComposedFamily<Slots extends Record<string, unknown>> = {
  [K in keyof Slots]: ForwardRefExoticComponent<SealedProps<Slots[K]>>;
};
