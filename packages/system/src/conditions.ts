/**
 * Condition alias registry — maps `_`-prefixed alias keys to at-rule condition
 * strings (`@media` / `@container` / `@supports`). Parallel in shape to the
 * selector alias registry (`selectors.ts`): alias → `{ value, order, kind }`.
 *
 * `order` determines cascade precedence within a layer (aliased conditions emit
 * in registry order, per design D4). `kind` is inferred from the at-rule prefix
 * of `value` (design D3) and drives which at-rule the extractor wraps the block
 * in. Serialized into the manifest as the NEW `conditionAliases` field, leaving
 * `selectorAliases` byte-for-byte unchanged.
 *
 * This module is RUNTIME + registry-support types only. The authoring TYPE
 * surface for condition block keys (an augmentable `Conditions` interface,
 * `ThemedCSSProps` arms) lands with increment 04; here the `addConditions()`
 * builder method types its keys/values as plain strings.
 */

/** The three condition kinds, inferred from the at-rule prefix of the value. */
export type ConditionKind = 'media' | 'container' | 'supports';

export interface ConditionAlias {
  /** Full at-rule condition string, e.g. `@media (prefers-reduced-motion: reduce)`. */
  value: string;
  /** Sort index for cascade ordering within a layer. */
  order: number;
  /** Condition kind, inferred from the at-rule prefix of `value`. */
  kind: ConditionKind;
}

export type ConditionAliasMap = Record<string, ConditionAlias>;

/**
 * Built-in condition aliases.
 *
 * EMPTY for this increment (03): user registrations only. The Panda-compatible
 * built-in media-feature set (`_motionReduce`, `_print`, `_osDark`, …) ships in
 * increment 06 (design D8). A no-registration system therefore serializes an
 * empty condition map, keeping every existing manifest byte-identical.
 */
export const BUILT_IN_CONDITIONS: ConditionAliasMap = {};

/** The supported at-rule prefixes, longest-first so `@media`/`@container`/
 *  `@supports` match unambiguously. */
const CONDITION_PREFIXES: readonly [string, ConditionKind][] = [
  ['@media', 'media'],
  ['@container', 'container'],
  ['@supports', 'supports'],
];

/**
 * Infer the condition kind from an at-rule value's prefix (design D3).
 * Throws (fail-loud, build time) when the value does not begin with a
 * supported at-rule name — the corresponding compile-time type error lands
 * with increment 04.
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
 * Merge user-provided condition aliases with a base map.
 *
 * - User aliases override built-ins of the same name, preserving the existing
 *   order (mirrors `mergeSelectors`).
 * - New aliases allocate orders CONTINUING from the highest existing order
 *   (floored at 490, so the first user alias lands at 500) rather than
 *   restarting at 500 each call — chained `.addConditions()` calls must not
 *   collide on order 500.
 * - Fails loud when a condition alias name is already reserved by the SELECTOR
 *   alias registry (`reservedSelectorNames`): the two registries share the `_`
 *   namespace at the call site and their names MUST be disjoint, else a block
 *   key would be ambiguous. The error names the offending alias and both
 *   registries.
 */
export function mergeConditions(
  base: ConditionAliasMap,
  custom: Record<string, string>,
  reservedSelectorNames: ReadonlySet<string> = new Set<string>()
): ConditionAliasMap {
  const merged = { ...base };
  // Continue order allocation past every existing entry (floor 490 → first
  // user alias is 500), instead of restarting at 500 per call.
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
      // Override: preserve the existing order, replace value + re-infer kind.
      merged[key] = { value, order: merged[key].order, kind };
    } else {
      merged[key] = { value, order: nextOrder, kind };
      nextOrder += 10;
    }
  }

  return merged;
}

/** Get the sorted alias keys for deterministic cascade ordering. */
export function getSortedConditionKeys(map: ConditionAliasMap): string[] {
  return Object.keys(map).sort((a, b) => map[a].order - map[b].order);
}

/**
 * Serialize the condition map for the extraction pipeline.
 * Emits `alias → { value, order, kind }` in registry (cascade) order so the
 * JSON is deterministic. Distinct in SHAPE from the selector map (which
 * flattens to `alias → selector`) — the object entry is forward-compatible
 * with a future multi-valued `values: string[]` property (design D3).
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
