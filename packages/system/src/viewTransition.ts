import { Fallbacks } from './firstThatWorks';
import { fnv1a } from './keyframes';

import type { AbstractProps } from './types/props';

/** The view-transition pseudo-elements a transition styles, by slot. */
export const VIEW_TRANSITION_SLOTS = {
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

/** Prints, and serializes, as the generated name. */
export interface ViewTransitionRef<Name extends string> {
  readonly __brand: 'ViewTransitionRef';
  readonly __name: Name;
  toString(): string;
  valueOf(): string;
  toJSON(): string;
}

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

/** Slots as a string, nested blocks included; fallbacks print as their
 *  preferred member, as they apply without extraction. */
const serializeSlots = (slots: ViewTransitionSlots): string =>
  JSON.stringify(slots, (_key, value) =>
    value instanceof Fallbacks ? String(value) : value
  );

/**
 * Each transition, a class named `animus-vt-{hash}` from its slots, with a
 * ref that prints as that class. A slot other than `group`, `imagePair`,
 * `old` and `new` throws.
 */
export function viewTransitions<
  Map extends Record<string, ViewTransitionSlots>,
>(map: Map): ViewTransitions<Map> {
  const transitions: Record<
    string,
    { name: string; slots: ViewTransitionSlots }
  > = {};
  const refs: Record<string, ViewTransitionRef<string>> = {};
  for (const [key, slots] of Object.entries(map)) {
    const rejected = Object.keys(slots).filter(
      (slot) => !Object.hasOwn(VIEW_TRANSITION_SLOTS, slot)
    );
    if (rejected.length > 0) {
      throw new TypeError(
        `createViewTransitions: "${key}" sets ${rejected.join(', ')} — a ` +
          'transition styles only its group, imagePair, old and new slots.'
      );
    }
    const name = `animus-vt-${fnv1a(serializeSlots(slots))}`;
    transitions[key] = { name, slots };
    refs[key] = {
      __brand: 'ViewTransitionRef',
      __name: key,
      toString: () => name,
      valueOf: () => name,
      toJSON: () => name,
    };
  }
  // SAFETY: `transitions` and `refs` hold exactly the keys of `map`, each
  // entry built from that key's slots.
  return {
    __brand: 'ViewTransitions' as const,
    __transitions: transitions,
    ...refs,
  } as ViewTransitions<Map>;
}
