import { ds } from './test-system';

import type { PropertyTypes } from '../src/types/properties';

/**
 * Style objects accept any string or number for every `--` key today,
 * including a declared contextual variable such as `--current-bg`. Typed
 * writes to declared properties start from this signature; changing it
 * fails here on purpose. `scripts/type-budget/measure.ts` also measures
 * this file.
 */
type Assert<T extends true> = T;

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type OpenCustomPropertyValue = (string & {}) | number | undefined;

type _DeclaredNameIsOpen = Assert<
  Exact<PropertyTypes['--current-bg'], OpenCustomPropertyValue>
>;
type _UndeclaredNameIsOpen = Assert<
  Exact<PropertyTypes['--never-declared'], OpenCustomPropertyValue>
>;
type _ExactRejectsANarrowerValue = Assert<
  Exact<'red' | undefined, OpenCustomPropertyValue> extends false ? true : false
>;

export const DeclaredWrites = ds
  .styles({
    '--current-bg': 'not a color',
    _hover: { '--current-bg': 42 },
  })
  .asElement('div');

export const UndeclaredWrites = ds
  .styles({
    '--never-declared': '1px solid',
    _hover: { _focus: { '--never-declared': 0 } },
  })
  .asElement('div');
