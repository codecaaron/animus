import { fnv1a, type NamedRef, namedEntries, serializeBlock } from './named';

import type { AbstractProps } from './types/props';

/** The view-transition pseudo-elements a transition styles, by slot. */
const VIEW_TRANSITION_SLOTS = {
  group: 'view-transition-group',
  imagePair: 'view-transition-image-pair',
  old: 'view-transition-old',
  new: 'view-transition-new',
} as const;

export type ViewTransitionSlot = keyof typeof VIEW_TRANSITION_SLOTS;

/** Each slot's styles: a block of styles, as a global style block takes. */
export type ViewTransitionSlots = {
  readonly [S in ViewTransitionSlot]?: AbstractProps;
};

export type ViewTransitionRef<Name extends string> = NamedRef<
  'ViewTransitionRef',
  Name
>;

export type ViewTransitions<Map extends Record<string, ViewTransitionSlots>> = {
  readonly __brand: 'ViewTransitions';
  readonly __transitions: {
    readonly [K in keyof Map & string]: {
      readonly name: string;
      readonly slots: Map[K];
    };
  };
} & {
  readonly [K in keyof Map & string]: ViewTransitionRef<K>;
};

/**
 * Each transition, a class named `animus-vt-{hash}` from its slots, with a
 * ref that prints as that class. A slot other than `group`, `imagePair`,
 * `old` and `new` throws.
 */
export function viewTransitions<
  Map extends Record<string, ViewTransitionSlots>,
>(map: Map): ViewTransitions<Map> {
  const { entries, refs } = namedEntries(
    map,
    'ViewTransitionRef',
    (key, slots: ViewTransitionSlots) => {
      const rejected = Object.keys(slots).filter(
        (slot) => !Object.hasOwn(VIEW_TRANSITION_SLOTS, slot)
      );
      if (rejected.length > 0) {
        throw new TypeError(
          `createViewTransitions: "${key}" sets ${rejected.join(', ')} — a ` +
            'transition styles only its group, imagePair, old and new slots.'
        );
      }
      return { name: `animus-vt-${fnv1a(serializeBlock(slots))}`, slots };
    }
  );
  // SAFETY: `entries` and `refs` hold exactly the keys of `map`, each built
  // from that key's slots.
  return {
    __brand: 'ViewTransitions' as const,
    __transitions: entries,
    ...refs,
  } as ViewTransitions<Map>;
}
