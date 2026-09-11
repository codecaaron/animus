/**
 * `order` is cascade precedence inside a layer: a later entry overrides an
 * earlier one at equal specificity.
 */

export interface SelectorAlias {
  selector: string;
  order: number;
}

export type SelectorAliasMap = Record<string, SelectorAlias>;

/**
 * Module augmentation publishes custom aliases as typed `_` keys. Augmenting
 * either `Selectors` or `Conditions` makes the whole `_` namespace validating.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Selectors {}

export const BUILT_IN_SELECTORS: SelectorAliasMap = {
  _link: { selector: '&:link', order: 10 },
  _visited: { selector: '&:visited', order: 20 },
  _hover: { selector: '&:hover', order: 30 },
  _focusWithin: { selector: '&:focus-within', order: 40 },
  _focus: { selector: '&:focus', order: 50 },
  _focusVisible: { selector: '&:focus-visible', order: 60 },
  _active: { selector: '&:active', order: 70 },
  _target: { selector: '&:target', order: 80 },

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

  _disabled: {
    selector:
      '&:disabled, &[disabled], &[aria-disabled="true"], &[data-disabled]',
    order: 200,
  },

  _before: { selector: '&::before', order: 300 },
  _after: { selector: '&::after', order: 310 },
  _placeholder: { selector: '&::placeholder', order: 320 },
  _selection: { selector: '&::selection', order: 330 },

  _first: { selector: '&:first-child', order: 400 },
  _last: { selector: '&:last-child', order: 410 },
  _even: { selector: '&:nth-child(even)', order: 420 },
  _odd: { selector: '&:nth-child(odd)', order: 430 },
  _empty: { selector: '&:empty', order: 440 },
};

/**
 * Order allocation continues past the highest existing order (floor 490, so
 * the first custom alias is 500); restarting per call would collide.
 */
export function mergeSelectors(
  base: SelectorAliasMap,
  custom: Record<string, string>
): SelectorAliasMap {
  const merged = { ...base };
  let nextOrder =
    Math.max(490, ...Object.values(merged).map((s) => s.order)) + 10;

  for (const [key, selector] of Object.entries(custom)) {
    if (key in merged) {
      merged[key] = { selector, order: merged[key].order };
    } else {
      merged[key] = { selector, order: nextOrder };
      nextOrder += 10;
    }
  }

  return merged;
}

export function getSortedAliasKeys(map: SelectorAliasMap): string[] {
  return Object.keys(map).sort((a, b) => map[a].order - map[b].order);
}

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
