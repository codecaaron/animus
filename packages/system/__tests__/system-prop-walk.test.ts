import { describe, expect, it } from 'vitest';

import {
  listedPropsSet,
  resolveClasses,
  resolveConfig,
} from '../src/runtime/resolveClasses';

/** Seeded, so a failing prop set reproduces. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

const NAMES = 'p px m gap bg color display width tone size inset top'.split(
  ' '
);
const NOISE = ['children', 'onClick', 'className', 'data-x', 'as'];
/** Nullish values are unset; falsy ones are set. */
type PropValue = null | undefined | number | string | boolean;
const VALUES: PropValue[] = [null, undefined, 0, '', false, 4];

/**
 * Contract: the system-prop walk visits exactly the listed props a site
 * sets, in list order, as walking the whole list and skipping each unset
 * name does, and reads each listed value once, as that walk did. The walk
 * lists the listed props a site holds; the loop skips each unset one as it
 * reads it. The loop body is the same for both, so every class string,
 * dynamic style, witness and warning is the full-list walk's.
 */
describe('the system-prop walk', () => {
  it('visits the props the full-list walk visits, in its order', () => {
    const next = random(20261019);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)];
    for (let run = 0; run < 2000; run++) {
      // Lists in any order, sometimes with a repeat, which resolveConfig
      // keeps at its first position.
      const listed = NAMES.filter(() => next() < 0.6).sort(() => next() - 0.5);
      if (next() < 0.1 && listed.length > 0) listed.push(pick(listed));
      const config = resolveConfig('animus-X', { systemPropNames: listed });
      const names = config.systemPropNames ?? [];
      const entries: [string, PropValue][] = [];
      for (let i = Math.floor(next() * 8); i > 0; i--) {
        entries.push([next() < 0.7 ? pick(NAMES) : pick(NOISE), pick(VALUES)]);
      }
      // A prop set through the prototype is set as the list walk reads it.
      const props: Record<string, PropValue> =
        next() < 0.1
          ? Object.assign(
              Object.create({ [pick(NAMES)]: 1 }),
              Object.fromEntries(entries)
            )
          : Object.fromEntries(entries);
      // The loop's own skip of an unset value narrows what the walk lists.
      const visited = (
        names.length > 0
          ? listedPropsSet(props, names, config.systemPropIndex ?? new Map())
          : []
      ).filter((name) => props[name] != null);
      expect(visited, JSON.stringify({ listed, props })).toEqual(
        names.filter((name) => props[name] != null)
      );
    }
  });

  // A getter whose value changes resolves its first read, as the full-list
  // walk did (0.1.65): the walk reads each listed value once.
  it('reads each listed value once', () => {
    let reads = 0;
    const props = {
      get color() {
        reads++;
        return reads === 1 ? 'red' : 'blue';
      },
    };
    const config = resolveConfig('animus-X', { systemPropNames: ['color'] });
    const { classes } = resolveClasses('animus-X', props, config, {
      color: { red: 'color-red', blue: 'color-blue' },
    });
    expect(classes).toEqual(['animus-X', 'color-red']);
    expect(reads).toBe(1);
  });
});
