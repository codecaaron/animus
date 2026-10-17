import { describe, expect, test } from 'vitest';

import { createSystem, firstThatWorks } from '../src';

import type { VocabularyRecord } from '../src';

const bundle = () => createSystem().build();

describe('registered artifacts', () => {
  // Contract: an artifact's generated name tells two bodies apart by every
  // fallback member, not only the preferred one, for each kind.
  test('bodies that differ only in a later fallback member get different names', () => {
    const b = bundle();
    const tries = b.createPositionTry({
      a: { width: firstThatWorks('var(--w)', '100px') },
      b: { width: firstThatWorks('var(--w)', '200px') },
    });
    const transitions = b.createViewTransitions({
      a: { old: { color: firstThatWorks('var(--x)', 'red') } },
      b: { old: { color: firstThatWorks('var(--x)', 'blue') } },
    });
    const motion = b.createKeyframes({
      a: { to: { color: firstThatWorks('var(--x)', 'red') } },
      b: { to: { color: firstThatWorks('var(--x)', 'blue') } },
    });
    for (const [first, second] of [
      [tries.a, tries.b],
      [transitions.a, transitions.b],
      [motion.a, motion.b],
    ]) {
      expect(String(first)).not.toBe(String(second));
    }
  });

  // Contract: two different bodies under one generated name fail seal(),
  // since the rule emitted later would apply to both; identical bodies
  // share their name.
  test('a generated name two different bodies share fails seal', () => {
    const forged = (width: string) => ({
      __brand: 'PositionTries' as const,
      __tries: { a: { name: '--animus-pt-same', descriptors: { width } } },
    });
    expect(() =>
      bundle()
        .registerPositionTry({ one: forged('1px') })
        .registerPositionTry({ two: forged('2px') })
        .seal()
    ).toThrow(/different bodies under one generated name "--animus-pt-same"/);
    expect(() =>
      bundle()
        .registerPositionTry({ one: forged('1px') })
        .registerPositionTry({ two: forged('1px') })
        .seal()
    ).not.toThrow();
  });

  // Contract: a record is version 2 exactly when a loader reading only
  // version 1 would misread it — a position try, a view transition, or a
  // fallback value in keyframes or global styles — and version 1 otherwise.
  test('the record version rule', () => {
    const version = (
      register: (b: ReturnType<typeof bundle>) => {
        seal(): { getVocabularyRecord(): VocabularyRecord };
      }
    ) => register(bundle()).seal().getVocabularyRecord().version;
    const fallback = firstThatWorks('var(--a)', 'red');
    expect(
      version((b) =>
        b
          .registerKeyframes({
            k: b.createKeyframes({ a: { to: { opacity: 1 } } }),
          })
          .registerGlobalStyles({ g: b.createGlobalStyles({ body: {} }) })
      )
    ).toBe(1);
    expect(
      version((b) =>
        b.registerPositionTry({ p: b.createPositionTry({ a: { top: '0' } }) })
      )
    ).toBe(2);
    expect(
      version((b) =>
        b.registerViewTransitions({
          v: b.createViewTransitions({ a: { old: { opacity: 0 } } }),
        })
      )
    ).toBe(2);
    expect(
      version((b) =>
        b.registerKeyframes({
          k: b.createKeyframes({ a: { to: { color: fallback } } }),
        })
      )
    ).toBe(2);
    expect(
      version((b) =>
        b.registerGlobalStyles({
          g: b.createGlobalStyles({ body: { _hover: { color: fallback } } }),
        })
      )
    ).toBe(2);
  });
});
