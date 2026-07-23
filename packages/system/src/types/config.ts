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
  /** When false, scale-bound props accept arbitrary strings alongside scale keys via (string & {}). Default: true (strict). */
  strict?: boolean;
  currentVar?: string;
  transform?: (
    val: string | number,
    prop?: string,
    props?: AbstractProps
  ) => string | number | CSSObject;
}

// `transform` return type includes `| CSSObject` at the type level to satisfy
// consumer `.props({ ... transform: size })` calls where the imported transform's
// inferred signature demands the wider union. Runtime pipeline treats CSSObject
// returns as a no-op (rule-level transforms remain future work). Corresponding
// type-test guard is intentionally disabled — see packages/system/__tests__/types.test-d.tsx
// under "Custom Prop Transform Return Type Guard".
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

/**
 * When `strict: false`, always include globals ((string & {}) | 0) for typeahead
 * with escape hatch, regardless of whether the scale has values.
 * When strict is omitted or true, fall back to IsEmpty (current behavior).
 */
type StrictOrEmpty<Config extends Prop, ScaleT> = Config['strict'] extends false
  ? true
  : IsEmpty<ScaleT>;

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

/**
 * Container-relative length units (design D11): the six container-query units,
 * admitted verbatim as string values on strict scale-typed props. The resolver
 * already accepts and emits these opaquely (D11 — container units transit the
 * scale-lookup/transform/pass-through paths with no special awareness); this
 * union closes the type-side gap so `gap: '2cqi'` typechecks WITHOUT widening a
 * strict scale prop to arbitrary strings (`'2vw'` stays rejected — admission is
 * these six suffixes only). Shallow, flat union — no cross-products (the repo's
 * TS2589 zone is string-embedded unions, design D9). The `${number}` prefix is
 * load-bearing: a bare `'cqi'` (no numeric part) is not assignable.
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

/** Raw nested-selector block keys (`'&:hover'`, `'&[data-state]'`, `'& > *'`). */
type RawSelectorKey = `&${string}`;

/**
 * Published alias keys (design D9): registered condition aliases + registered
 * custom selector aliases, drawn from the augmentable `Conditions`/`Selectors`
 * interfaces. `never` until a consumer augments.
 *
 * JOINT NAMESPACE (inc-04 F8/F9): conditions and selectors share the single `_`
 * block-key namespace, so this gate reads BOTH interfaces. Publishing EITHER
 * `Conditions` OR `Selectors` makes this non-`never`, which flips
 * `KnownUnderscoreKey` (below) from permissive to validating for the WHOLE `_`
 * namespace — not just the published side. This joint gate is documented here
 * and at the `Conditions` interface declaration (`conditions.ts`); the
 * `Selectors` interface (`selectors.ts`) feeds the same `keyof … | keyof …`
 * union.
 */
type PublishedAliasKeys = Extract<
  keyof Conditions | keyof Selectors,
  `_${string}`
>;

/**
 * The `_`-prefixed keys accepted as recursing block keys.
 *
 * Graceful degradation (mirrors the empty-`Theme` fallback and
 * `MediaQueryMap`'s `string extends BreakpointKeys` branch): when no condition
 * or selector aliases are published, ALL `_${string}` keys stay permissive —
 * a system that registered aliases via `.addConditions()` but did not augment
 * `Conditions` (e.g. the vite-app fixture) still authors its aliased blocks
 * without error. Once a publication exists, built-in selector aliases AND
 * built-in condition aliases plus the published keys recurse; every other `_`
 * key falls to the branded `UnknownConditionAlias` arm.
 *
 * Built-ins (`BuiltInSelectorAlias | BuiltInConditionAlias`) are STATIC unions
 * in the validating branch, never members of the augmentable interfaces (design
 * D8; see `BUILT_IN_CONDITIONS` in `conditions.ts`) — so `_motionReduce`,
 * `_osDark`, … type as valid block keys with ZERO condition registrations, yet
 * an empty publication keeps the whole namespace permissive (graceful
 * degradation preserved).
 */
type KnownUnderscoreKey = [PublishedAliasKeys] extends [never]
  ? `_${string}`
  : BuiltInSelectorAlias | BuiltInConditionAlias | PublishedAliasKeys;

/** Pass-through CSS property value (design D10 + `animationName` widening). */
type PassThroughProp<K extends keyof PropertyTypes> = K extends 'animationName'
  ? ResponsiveProp<KeyframeRef<string> | PropertyTypes[K]>
  : ResponsiveProp<PropertyTypes[K]>;

/**
 * The `_`-prefixed MEMBERS of a recursing block body. Optional members over a
 * closed set (built-ins + published) reject unknown `_` keys at depth as excess
 * properties; when nothing is published the set opens to `` `_${string}` `` —
 * a pattern index signature — keeping non-augmenting systems permissive.
 */
type UnderscoreBlockMembers<Config extends Record<string, Prop>> = {
  [K in KnownUnderscoreKey]?: ThemedBlockBody<Config>;
};

/**
 * The recursive body of a selector/condition block (design D9, full recursion —
 * inc 05's resolver is fully recursive, so the type advertises exactly what the
 * build emits). Deliberately a FIXED type (no reference to the outer inferred
 * `Props`): a `ThemedCSSProps<Props[K], …>` arm would be reverse-mapped-inferred
 * away at the `.styles()` call boundary and silently stop CHECKING nested values
 * (booleans/off-scale keys would pass). Structuring the body as a fixed
 * intersection restores structural checking at every depth — scale-typed props
 * inside a nested block retain their scale-key validation. Raw `'&…'`/at-rule
 * keys and `_`-aliases recurse; every other nested key is a pass-through CSS
 * prop or an excess property.
 */
type ThemedBlockBody<Config extends Record<string, Prop>> = {
  // Pass-through members carry the SAME D10 responsive wrapper (+
  // `animationName` KeyframeRef widening) as the top-level arm — the
  // resolver resolves responsive maps and keyframe refs at every depth,
  // so the type must too (inc-11 full-pass F-1.2: bare `Omit<PropertyTypes>`
  // members rejected `outlineWidth: { _, sm }` and `animationName: ref`
  // inside nested blocks while the build emitted them).
  [K in Exclude<keyof PropertyTypes, keyof Config>]?: PassThroughProp<K>;
} & {
  [P in keyof Config]?: ThemedScale<Config[P]>;
} & {
  [K in RawSelectorKey | RawAtRuleKey]?: ThemedBlockBody<Config>;
} & UnderscoreBlockMembers<Config>;

/**
 * Theme-aware CSS props — uses the augmentable Theme interface to constrain
 * values per-key, plus kind-dispatched arms for block keys (design D9/D10).
 * No generic T and no `Conditions`/`Selectors` generic thread through the
 * `Animus` class family — the arms read the augmentable interfaces directly,
 * the same publication mechanism as the augmented `Theme`.
 *
 * Arm dispatch per key `K`:
 *  1. registered system prop (`keyof Config`) → `ThemedScale` (scale-narrowed).
 *  2. block keys — raw `'&…'` selectors, valid raw `'@media|@container|
 *     @supports …'` at-rules, and known/permissive `_`-aliases — recurse into
 *     `ThemedBlockBody` (the complete, checked, themed surface).
 *  3. pass-through CSS property (`keyof PropertyTypes`) → `ResponsiveProp<…>`
 *     so breakpoint value maps work on every themed prop (D10), not only
 *     propConfig-registered ones. `animationName` keeps its `KeyframeRef`
 *     widening (`animationName: motion.ember`).
 *  4. unknown `_`-prefixed key (publication present) → branded
 *     `UnknownConditionAlias<K>` naming the key + remedy.
 *  5. unknown `@`-prefixed key (malformed at-rule) → branded `UnknownAtRule<K>`.
 *  6. anything else → the legacy accept-object (non-`_`/`@` junk keys are out
 *     of D9's scope; unchanged behavior).
 */
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

/**
 * Built-in selector alias keys.
 * Each maps to one or more CSS selectors (e.g. `_hover` → `&:hover`).
 */
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
 * Built-in condition alias keys (design D8, increment 06). The Panda-compatible
 * media-feature set — motion, print, orientation, contrast, OS color-scheme.
 * Each maps to a `@media` feature query (see `BUILT_IN_CONDITIONS` in
 * `conditions.ts`, the runtime mirror this must stay in sync with — the
 * `types.test-d.tsx` positives are the drift guard).
 *
 * This is a STATIC union folded into `KnownUnderscoreKey`'s validating branch,
 * exactly like `BuiltInSelectorAlias` — NOT default members of the augmentable
 * `Conditions` interface. Interface members would make publication permanently
 * non-empty and break inc-04's graceful-degradation contract (a non-augmenting
 * consumer with custom aliases would flip from permissive to branded-rejection
 * the day built-ins shipped). Color-mode aliases (`_dark` / `_light`) are OUT —
 * they are selector-kind surface owned by the `system-color-scheme` change.
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

/**
 * Selector alias props for component callsite.
 * Each alias key accepts the same prop interface as the component's
 * system groups, wrapped in Partial<>.
 *
 * Built-in selector aliases come from the static `BuiltInSelectorAlias` union;
 * registered CUSTOM selector aliases fold in from the augmentable `Selectors`
 * interface (design D9), making the `selector-alias-callsite` custom-alias
 * promise true. Condition aliases are deliberately NOT included — conditions
 * are block-position only (media-condition-aliases spec), never callsite props.
 */
export type SelectorAliasProps<GroupPropValues> = {
  [K in
    | BuiltInSelectorAlias
    | Extract<keyof Selectors, `_${string}`>]?: Partial<GroupPropValues>;
};
