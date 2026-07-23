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
 * This module hosts BOTH the runtime registry and the authoring TYPE surface
 * (inc 04): the augmentable `Conditions`/`Selectors` publication, the
 * `ConditionsOf`/`SelectorsOf` extractors, the branded rejection types
 * (`UnknownConditionAlias`/`UnknownAtRule`), and the shallow `RawAtRuleKey`
 * shapes consumed by `ThemedCSSProps`' kind-dispatched arms. `addConditions()`
 * constrains values to `@media`/`@container`/`@supports`-prefixed strings at
 * the type level; `inferConditionKind` remains the runtime fail-loud check.
 */

/** The three condition kinds, inferred from the at-rule prefix of the value. */
export type ConditionKind = 'media' | 'container' | 'supports';

// ─────────────────────────────────────────────────────────────────────────
// Authoring TYPE surface (increment 04, design D9)
//
// Registered condition aliases publish their literal key types through module
// augmentation — an augmentable `interface Conditions` the consumer extends
// once with `ConditionsOf<typeof system>`, mirroring the augmented `Theme` for
// breakpoints. No generic threads through the `Animus` class family; the
// `ThemedCSSProps` arms read this global interface directly.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Augmentable registry of registered condition alias keys. Empty by default;
 * a consumer publishes its registrations with:
 *
 * ```ts
 * declare module '@animus-ui/system' {
 *   interface Conditions extends Record<ConditionsOf<typeof ds>, true> {}
 * }
 * ```
 *
 * When this interface is empty (no publication), `ThemedCSSProps` keeps
 * `_`-prefixed block keys permissive — the same graceful degradation the
 * augmentable `Theme` uses (empty theme ⇒ raw CSS values). Once populated, the
 * validating arms engage: unknown `_` keys resolve to `UnknownConditionAlias`.
 *
 * JOINT NAMESPACE (inc-04 F8/F9): condition and selector aliases share the one
 * `_` block-key namespace, so publishing EITHER `Conditions` OR `Selectors`
 * flips BOTH namespaces from permissive to validating (see `KnownUnderscoreKey`
 * in `types/config.ts`, whose gate reads `keyof Conditions | keyof Selectors`).
 *
 * Built-in condition aliases (`BUILT_IN_CONDITIONS`, design D8) are NOT members
 * of this interface — they live in the static `BuiltInConditionAlias` union
 * (`types/config.ts`), mirroring `BuiltInSelectorAlias`. Defaulting members here
 * would make publication permanently non-empty and destroy the degradation
 * contract above (a non-augmenting consumer with custom aliases would flip from
 * permissive to branded-rejection the day built-ins shipped).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Conditions {}

declare const CONDS_BRAND: unique symbol;
declare const SELS_BRAND: unique symbol;

/**
 * Phantom brand carried on `build()`'s system output, threading the accumulated
 * registered condition (`C`) and custom selector (`S`) alias-key unions to the
 * consumer's augmentation site. Type-only — never present at runtime.
 */
export interface RegistryBrand<
  C extends string = never,
  S extends string = never,
> {
  readonly [CONDS_BRAND]?: C;
  readonly [SELS_BRAND]?: S;
}

/** Extract the registered condition alias keys from a built system. */
export type ConditionsOf<Sys> =
  Sys extends RegistryBrand<infer C, string> ? C : never;

/** Extract the registered custom selector alias keys from a built system. */
export type SelectorsOf<Sys> =
  Sys extends RegistryBrand<string, infer S> ? S : never;

/**
 * Branded rejection for a `_`-prefixed block key that is neither a registered
 * condition alias, a registered selector alias, a built-in selector alias,
 * nor a built-in condition alias.
 * The type name carries the offending key; the `hint` states the remedy. Never
 * a bare `never` arm — `never` produces a misleading "not assignable to
 * 'undefined'" (design D9, measured).
 */
export interface UnknownConditionAlias<K extends string> {
  readonly __unknownConditionAlias: K;
  readonly hint: `"${K}" is not a registered condition or selector alias. Register it with .addConditions() / .addSelectors(), or use a raw "&…" selector or "@media|@container|@supports (…)" key.`;
}

/**
 * Branded rejection for an `@`-prefixed block key that does not match an
 * accepted at-rule shape (`@media …` / `@container …` / `@supports …`). The
 * type name carries the offending key; the `hint` states the remedy.
 */
export interface UnknownAtRule<K extends string> {
  readonly __unknownAtRule: K;
  readonly hint: `"${K}" is not a valid at-rule block key. At-rule keys must begin with "@media ", "@container ", or "@supports " followed by a parenthesized/feature tail.`;
}

/**
 * SHALLOW at-rule key shapes (design D9): prefix + tail only. Deep query-grammar
 * template literals are the repo's one known TS2589 zone (string-embedded
 * unions) and stay out — Rust validates queries for real; the type layer stops
 * at the prefix. The trailing space after each at-rule name is load-bearing: it
 * rejects prefix typos (`@containr …`, `@medi …`) without a closed grammar.
 */
export type RawAtRuleKey =
  | `@media ${string}`
  | `@container ${string}`
  | `@supports ${string}`;

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
 * Built-in condition aliases (design D8, increment 06).
 *
 * The Panda-compatible media-feature set: motion, print, orientation, contrast,
 * and OS color-scheme preferences. Every alias is a pure `@media` feature query
 * (`kind: 'media'`). Color-mode aliases (`_dark` / `_light`) are DELIBERATELY
 * excluded — they are selector-kind (`[data-color-mode]`) surface owned by the
 * `system-color-scheme` change, not media features.
 *
 * ORDER BAND (inc-03 full-pass): built-ins occupy a reserved band BELOW the user
 * band — one slot of 10 per alias in table row order, 300–380. The user band
 * starts at 500 (`mergeConditions` floors allocation at 490 → first user alias
 * is 500), so built-ins and user registrations never interleave on collision.
 * This mirrors the selector registry's real layout (built-ins 10–440, users
 * 500+).
 *
 * The static type-level mirror is `BuiltInConditionAlias` in `types/config.ts`
 * (added to `KnownUnderscoreKey`'s VALIDATING branch, exactly like
 * `BuiltInSelectorAlias`). Built-ins are NOT members of the augmentable
 * `Conditions` interface: interface members would make publication permanently
 * non-empty, killing inc-04's graceful-degradation contract. The
 * `types.test-d.tsx` drift positives keep the two in sync.
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
 * supported at-rule name. The compile-time complement is `addConditions()`'s
 * value constraint (`@media`/`@container`/`@supports`-prefixed template
 * literals); this runtime throw remains the backstop for untyped callers.
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
