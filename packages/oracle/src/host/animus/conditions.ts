import { and, collectCuts, eq, range, TRUE } from '../../core/predicate';

import type { Predicate } from '../../core/predicate';
import type { AtCondition } from './css-parse';

export const VIEWPORT_DIMENSION = 'viewport.inline';

export const MODE_DIMENSION = 'mode';

export const ANONYMOUS_CONTAINER = 'anonymous';

export const containerDimension = (name: string | undefined): string =>
  `container:${name ?? ANONYMOUS_CONTAINER}:inline-size`;

export const mediaDimension = (feature: string): string => `media:${feature}`;

export const supportsDimension = (raw: string): string => `supports:${raw}`;

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

export const conditionFor = (atStack: readonly AtCondition[]): Predicate =>
  atStack.length === 0 ? TRUE : and(...atStack.map(predicateOf));

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

  return Object.fromEntries(
    Array.from(merged.entries())
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([dimension, cuts]): [string, number[]] => [
        dimension,
        Array.from(cuts).sort((left, right) => left - right),
      ])
  );
};

export const PSEUDO_STATE_EXCLUSION =
  'interaction pseudo-class state (:hover, :focus-visible, :active, …) — ' +
  'carried on the selector model, not modeled as a scenario dimension';
