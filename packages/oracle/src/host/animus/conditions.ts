import { and, collectCuts, eq, range, TRUE } from '../../core/predicate';

import type { Predicate } from '../../core/predicate';
import type { AtCondition } from './css-parse';

/**
 * At-rule conditions → scenario guards.
 *
 * The mapping is the whole reason a media query is checkable rather than
 * merely quotable: `(min-width: 640px)` becomes a `range` over the declared
 * `viewport.inline` axis, so `enumerateCells` can decide it at every cell
 * instead of sampling it at whatever width someone happened to try.
 *
 * Two of the dimensions produced here are deliberately *not* in the default
 * scenario domain (`scenario.ts` omits them):
 *
 * - `container:<name>:inline-size` is geometry-coupled — the container's
 *   inline size is a layout result, not an input a caller can pin, so binding
 *   it would let a probe assert a width the model never derived. Rules guarded
 *   by it carry a `geometry` obligation instead.
 * - `supports:<raw>` and `media:<feature>` are environment facts. Leaving them
 *   unbound makes their rules *inactive* under `evalPredicate`, which is the
 *   sound direction: the adapter states the guard, and an engine that wants
 *   the rule live has to declare the assumption.
 */
export const VIEWPORT_DIMENSION = 'viewport.inline';

export const MODE_DIMENSION = 'mode';

export const ANONYMOUS_CONTAINER = 'anonymous';

export const containerDimension = (name: string | undefined): string =>
  `container:${name ?? ANONYMOUS_CONTAINER}:inline-size`;

export const mediaDimension = (feature: string): string => `media:${feature}`;

export const supportsDimension = (raw: string): string => `supports:${raw}`;

/** The scenario axis one at-rule condition tests. */
export const dimensionOf = (condition: AtCondition): string => {
  switch (condition.kind) {
    case 'media-min-width':
      return VIEWPORT_DIMENSION;
    case 'media-feature':
      return mediaDimension(condition.feature);
    case 'media-raw':
      return mediaDimension(condition.raw);
    case 'container':
      return containerDimension(condition.name);
    case 'supports':
      return supportsDimension(condition.raw);
  }
};

export const predicateOf = (condition: AtCondition): Predicate => {
  switch (condition.kind) {
    case 'media-min-width':
      return range(VIEWPORT_DIMENSION, {
        min: condition.px,
        minInclusive: true,
      });
    case 'media-feature':
      return eq(mediaDimension(condition.feature), condition.value);
    case 'media-raw':
      return eq(mediaDimension(condition.raw), true);
    case 'container':
      return range(containerDimension(condition.name), {
        min: condition.px,
        minInclusive: true,
      });
    case 'supports':
      return eq(supportsDimension(condition.raw), true);
  }
};

/** A nested at-rule stack is a conjunction; an empty stack is `TRUE`. */
export const conditionFor = (atStack: readonly AtCondition[]): Predicate =>
  atStack.length === 0 ? TRUE : and(...atStack.map(predicateOf));

/**
 * The numeric thresholds every modeled guard is sensitive to, merged per
 * dimension and sorted.
 *
 * This is what `ScenarioProvider.cuts()` returns, and the cell invariant of
 * `enumerateCells` rests on it: a threshold that exists in a rule but not in
 * `cuts` makes the guard non-constant inside a cell, and cell sampling stops
 * being a proof. Over-collecting (thresholds on dimensions that turn out to be
 * finite, or on the unbound container axis) only refines a partition that is
 * never enumerated for them, so this deliberately keeps everything it finds.
 */
export const cutsOfPredicates = (
  predicates: readonly Predicate[]
): Record<string, number[]> => {
  const merged = new Map<string, Set<number>>();

  for (const predicate of predicates) {
    const cuts = collectCuts(predicate);
    for (const dimension of Object.keys(cuts)) {
      const set = merged.get(dimension) ?? new Set<number>();
      for (const cut of cuts[dimension]) set.add(cut);
      merged.set(dimension, set);
    }
  }

  // Dimension order is the map's own entries sorted by name, so the sets and
  // their names cannot come apart the way a name-keyed second lookup can, and
  // the emitted key order stays the historical one (names ascending, each
  // dimension's thresholds ascending).
  return Object.fromEntries(
    Array.from(merged.entries())
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([dimension, cuts]): [string, number[]] => [
        dimension,
        Array.from(cuts).sort((left, right) => left - right),
      ])
  );
};

/**
 * Interaction pseudo-classes (`:hover`, `:focus-visible`, `:active`) are
 * carried on `SelectorModel.pseudo` and contribute *no* guard.
 *
 * Modeling them as scenario dimensions would be worse than leaving them out:
 * an unbound dimension evaluates FALSE, so every hover rule would silently
 * report as inactive in scenarios that never mentioned hover, and a bound one
 * would claim the oracle models interaction state it has no way to derive.
 * Engines see the pseudo list on the selector and decide; the universe states
 * the exclusion.
 */
export const PSEUDO_STATE_EXCLUSION =
  'interaction pseudo-class state (:hover, :focus-visible, :active, …) — ' +
  'carried on the selector model, not modeled as a scenario dimension';
