import { ds } from './kit';

import type { Published } from './kit';
import type { Conditions, Selectors } from '@animus-ui/system';

// Contract: where one alias registry is empty, a style block still rejects an
// unknown `_` key (the cold review's `_hovre`), and accepts the registered
// selector and the built-in aliases.
type IsExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
export type EmptyRegistryPublishesNothing = Assert<
  IsExact<Published, [never, '_busy']>
>;
export type NoConditionKeys = Assert<IsExact<keyof Conditions, never>>;
export type SelectorKeys = Assert<IsExact<keyof Selectors, '_busy'>>;

ds.styles({ _busy: { color: 'ink' } });
ds.styles({ _hover: { color: 'ink' } });
ds.styles({ _motionReduce: { p: 'sm' } });
// @ts-expect-error `_hovre` is no registered or built-in alias
ds.styles({ _hovre: { color: 'ink' } });
// @ts-expect-error nor inside a registered block
ds.styles({ _busy: { _hovre: { color: 'ink' } } });
