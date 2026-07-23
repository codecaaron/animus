/**
 * Selector alias registry — maps `_`-prefixed alias keys to CSS selectors.
 *
 * Sort order determines cascade precedence within a layer:
 * later entries override earlier ones when specificity is equal.
 * The ordering follows CSS conventions (LVHA) and interaction semantics
 * (disabled beats interaction states, pseudo-elements after states).
 */

export interface SelectorAlias {
  /** CSS selector string (comma-separated for compound selectors) */
  selector: string;
  /** Sort index for cascade ordering within a layer */
  order: number;
}

export type SelectorAliasMap = Record<string, SelectorAlias>;

/**
 * Augmentable registry of registered CUSTOM selector alias keys (design D9).
 * Built-in selector aliases stay in the static `BuiltInSelectorAlias` union;
 * this interface publishes user registrations (`.addSelectors({ … })`) so they
 * become typed both as `ThemedCSSProps` block keys AND as component callsite
 * props (`SelectorAliasProps`) — making the `selector-alias-callsite`
 * custom-alias promise actually true. A consumer publishes with:
 *
 * ```ts
 * declare module '@animus-ui/system' {
 *   interface Selectors extends Record<SelectorsOf<typeof ds>, true> {}
 * }
 * ```
 *
 * Empty by default. JOINT NAMESPACE: publishing EITHER `Selectors` or
 * `Conditions` flips the WHOLE `_` block-key namespace to validating —
 * augmenting one without the other rejects the other's registered aliases.
 * When both are empty, `_` block keys stay fully permissive; built-in
 * selector aliases are the only `_` keys typed at CALLSITE-prop position.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Selectors {}

/**
 * Built-in selector aliases.
 *
 * Compound selectors (e.g. `_disabled`) target multiple CSS selectors
 * via comma-separation to cover native, ARIA, and data attribute conventions.
 */
export const BUILT_IN_SELECTORS: SelectorAliasMap = {
  // ── Interactive (LVHA order) ──────────────────────────────
  _link: { selector: '&:link', order: 10 },
  _visited: { selector: '&:visited', order: 20 },
  _hover: { selector: '&:hover', order: 30 },
  _focusWithin: { selector: '&:focus-within', order: 40 },
  _focus: { selector: '&:focus', order: 50 },
  _focusVisible: { selector: '&:focus-visible', order: 60 },
  _active: { selector: '&:active', order: 70 },
  _target: { selector: '&:target', order: 80 },

  // ── Form / ARIA states ────────────────────────────────────
  _checked: {
    selector: '&:checked, &[aria-checked="true"], &[data-checked]',
    order: 100,
  },
  _invalid: {
    selector: '&:invalid, &[aria-invalid="true"], &[data-invalid]',
    order: 110,
  },
  _required: { selector: '&:required, &[aria-required="true"]', order: 120 },
  _readOnly: {
    selector: '&:read-only, &[aria-readonly="true"], &[data-readonly]',
    order: 130,
  },
  _expanded: {
    selector: '&[aria-expanded="true"], &[data-expanded]',
    order: 140,
  },
  _selected: {
    selector: '&[aria-selected="true"], &[data-selected]',
    order: 150,
  },
  _pressed: {
    selector: '&[aria-pressed="true"], &[data-pressed]',
    order: 160,
  },

  // ── Disabled (wins over interaction states) ───────────────
  _disabled: {
    selector:
      '&:disabled, &[disabled], &[aria-disabled="true"], &[data-disabled]',
    order: 200,
  },

  // ── Pseudo-elements ───────────────────────────────────────
  _before: { selector: '&::before', order: 300 },
  _after: { selector: '&::after', order: 310 },
  _placeholder: { selector: '&::placeholder', order: 320 },
  _selection: { selector: '&::selection', order: 330 },

  // ── Positional ────────────────────────────────────────────
  _first: { selector: '&:first-child', order: 400 },
  _last: { selector: '&:last-child', order: 410 },
  _even: { selector: '&:nth-child(even)', order: 420 },
  _odd: { selector: '&:nth-child(odd)', order: 430 },
  _empty: { selector: '&:empty', order: 440 },
};

/**
 * Merge user-provided selectors with built-in defaults.
 * User selectors override built-in aliases of the same name.
 * New aliases get an order value based on their position (500+).
 */
export function mergeSelectors(
  base: SelectorAliasMap,
  custom: Record<string, string>
): SelectorAliasMap {
  const merged = { ...base };
  let nextOrder = 500;

  for (const [key, selector] of Object.entries(custom)) {
    if (key in merged) {
      // Override: preserve the existing order, replace selector
      merged[key] = { selector, order: merged[key].order };
    } else {
      // New alias: assign next available order
      merged[key] = { selector, order: nextOrder };
      nextOrder += 10;
    }
  }

  return merged;
}

/** Get the sorted alias keys for deterministic cascade ordering. */
export function getSortedAliasKeys(map: SelectorAliasMap): string[] {
  return Object.keys(map).sort((a, b) => map[a].order - map[b].order);
}

/**
 * Serialize the selector map for the extraction pipeline.
 * Emits a flat `Record<string, string>` (alias → selector) plus
 * the ordered key list for cascade determinism.
 */
export function serializeSelectorMap(map: SelectorAliasMap): {
  selectors: Record<string, string>;
  order: string[];
} {
  const selectors: Record<string, string> = {};
  const order = getSortedAliasKeys(map);
  for (const key of order) {
    selectors[key] = map[key].selector;
  }
  return { selectors, order };
}
