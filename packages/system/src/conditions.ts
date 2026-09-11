/**
 * Condition alias registry: `_`-prefixed alias keys → at-rule condition
 * strings, plus the authoring type surface consumers augment.
 */

export type ConditionKind = 'media' | 'container' | 'supports';

/**
 * Augmentable registry of registered condition alias keys. Empty keeps `_`
 * block keys permissive; publishing either registry validates both.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Conditions {}

declare const CONDS_BRAND: unique symbol;
declare const SELS_BRAND: unique symbol;

/**
 * Type-only phantom brand on a built system, carrying the registered
 * condition (`C`) and selector (`S`) alias keys to the augmentation site.
 */
export interface RegistryBrand<
  C extends string = never,
  S extends string = never,
> {
  readonly [CONDS_BRAND]?: C;
  readonly [SELS_BRAND]?: S;
}

export type ConditionsOf<Sys> =
  Sys extends RegistryBrand<infer C, string> ? C : never;

export type SelectorsOf<Sys> =
  Sys extends RegistryBrand<string, infer S> ? S : never;

/**
 * Branded rejection for a `_` block key that no registry owns. Not a bare
 * `never`: that reports a misleading "not assignable to 'undefined'".
 */
export interface UnknownConditionAlias<K extends string> {
  readonly __unknownConditionAlias: K;
  readonly hint: `"${K}" is not a registered condition or selector alias. Register it with .addConditions() / .addSelectors(), or use a raw "&…" selector or "@media|@container|@supports (…)" key.`;
}

export interface UnknownAtRule<K extends string> {
  readonly __unknownAtRule: K;
  readonly hint: `"${K}" is not a valid at-rule block key. At-rule keys must begin with "@media ", "@container ", or "@supports " followed by a parenthesized/feature tail.`;
}

/**
 * Rejection for an `addConditions()` key the selector registry owns. Never a
 * bare `never`: in VALUE position it drops both the check and accumulation.
 */
export interface ReservedBySelectorRegistry<K extends string> {
  readonly __reservedBySelectorRegistry: K;
  readonly hint: `"${K}" is already a selector alias — condition and selector alias names must be disjoint. Rename this condition alias, or redefine the selector with .addSelectors().`;
}

export interface ReservedByConditionRegistry<K extends string> {
  readonly __reservedByConditionRegistry: K;
  readonly hint: `"${K}" is already a condition alias — condition and selector alias names must be disjoint. Rename this selector alias, or redefine the condition with .addConditions().`;
}

/**
 * Alias names, or `never` once the union has widened to the whole `_`
 * pattern — a widened union would reject every legal alias downstream.
 */
export type NarrowedAliases<U extends string> = `_${string}` extends U
  ? never
  : U;

/**
 * Prefix + tail only: a deep query grammar hits TS2589. The trailing space
 * is load-bearing — it rejects prefix typos (`@medi …`) without a grammar.
 */
export type RawAtRuleKey =
  | `@media ${string}`
  | `@container ${string}`
  | `@supports ${string}`;

/**
 * No trailing space, unlike `RawAtRuleKey`: a value may open its query
 * immediately (`@media(width>=40em)`).
 */
export type AtRuleValue =
  | `@media${string}`
  | `@container${string}`
  | `@supports${string}`;

export interface ConditionAlias {
  /** Full at-rule condition string, e.g. `@media print`. */
  value: string;
  /** Sort index for cascade ordering within a layer. */
  order: number;
  /** Condition kind, inferred from the at-rule prefix of `value`. */
  kind: ConditionKind;
}

export type ConditionAliasMap = Record<string, ConditionAlias>;

/**
 * Media-feature aliases only — color-mode aliases are selector-kind. The
 * reserved order band (300–380) sits below the user band (500+).
 */
export const BUILT_IN_CONDITIONS: ConditionAliasMap = {
  _motionReduce: {
    value: '@media (prefers-reduced-motion: reduce)',
    order: 300,
    kind: 'media',
  },
  _motionSafe: {
    value: '@media (prefers-reduced-motion: no-preference)',
    order: 310,
    kind: 'media',
  },
  _print: { value: '@media print', order: 320, kind: 'media' },
  _portrait: {
    value: '@media (orientation: portrait)',
    order: 330,
    kind: 'media',
  },
  _landscape: {
    value: '@media (orientation: landscape)',
    order: 340,
    kind: 'media',
  },
  _moreContrast: {
    value: '@media (prefers-contrast: more)',
    order: 350,
    kind: 'media',
  },
  _lessContrast: {
    value: '@media (prefers-contrast: less)',
    order: 360,
    kind: 'media',
  },
  _osDark: {
    value: '@media (prefers-color-scheme: dark)',
    order: 370,
    kind: 'media',
  },
  _osLight: {
    value: '@media (prefers-color-scheme: light)',
    order: 380,
    kind: 'media',
  },
};

const CONDITION_PREFIXES: readonly [string, ConditionKind][] = [
  ['@media', 'media'],
  ['@container', 'container'],
  ['@supports', 'supports'],
];

/**
 * Throws on an unsupported prefix — the runtime backstop for untyped
 * callers, complementing `addConditions()`'s value constraint.
 */
export function inferConditionKind(value: string): ConditionKind {
  for (const [prefix, kind] of CONDITION_PREFIXES) {
    if (value.startsWith(prefix)) {
      return kind;
    }
  }
  throw new Error(
    `addConditions: value "${value}" must begin with @media, @container, or @supports`
  );
}

/**
 * Overrides keep the existing order; new aliases continue past the highest
 * existing order (floor 490) so chained calls never collide on 500.
 */
export function mergeConditions(
  base: ConditionAliasMap,
  custom: Record<string, string>,
  reservedSelectorNames: ReadonlySet<string> = new Set<string>()
): ConditionAliasMap {
  const merged = { ...base };
  let nextOrder =
    Math.max(490, ...Object.values(merged).map((c) => c.order)) + 10;

  for (const [key, value] of Object.entries(custom)) {
    if (reservedSelectorNames.has(key)) {
      throw new Error(
        `addConditions: alias "${key}" is already registered in the selector ` +
          `alias registry — condition and selector alias names must be ` +
          `disjoint (rename the condition alias or the selector alias).`
      );
    }
    const kind = inferConditionKind(value);
    if (key in merged) {
      merged[key] = { value, order: merged[key].order, kind };
    } else {
      merged[key] = { value, order: nextOrder, kind };
      nextOrder += 10;
    }
  }

  return merged;
}

export function getSortedConditionKeys(map: ConditionAliasMap): string[] {
  return Object.keys(map).sort((a, b) => map[a].order - map[b].order);
}

/**
 * Emits `alias → { value, order, kind }` in cascade order so the JSON is
 * deterministic.
 */
export function serializeConditionMap(
  map: ConditionAliasMap
): Record<string, ConditionAlias> {
  const conditions: Record<string, ConditionAlias> = {};
  for (const key of getSortedConditionKeys(map)) {
    conditions[key] = map[key];
  }
  return conditions;
}
