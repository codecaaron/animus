import type { AbstractProps } from './types/props';

type FallbackMember = string | number;

/** How a call's value spells its members: the one key of an object of
 *  them, which the system loader serializes and extraction reads. */
const FALLBACKS_KEY = '$animus.firstThatWorks';

/**
 * A call's value. It carries every member, so a name hashed from styles
 * tells two lists apart and a sealed record knows it holds one; it prints
 * as the preferred member, which is what a runtime prop applies.
 */
class Fallbacks {
  readonly [FALLBACKS_KEY]: readonly FallbackMember[];

  constructor(members: readonly [FallbackMember, ...FallbackMember[]]) {
    this[FALLBACKS_KEY] = members;
  }

  toString(): string {
    return String(this[FALLBACKS_KEY][0]);
  }

  valueOf(): FallbackMember {
    return this[FALLBACKS_KEY][0];
  }
}

/**
 * Ordered fallbacks for one property, the preferred value first. Extraction
 * emits them in reverse, so the last declaration a browser supports wins;
 * a run of bare `var(--…)` members folds into one nested `var()` fallback,
 * and members after that run's first non-variable fallback never apply and
 * are not emitted. A minifier lowering for targets (Lightning CSS) drops a
 * fallback every target already supports.
 *
 * Read statically in component styles, and through the system's
 * evaluation in registered global styles and keyframes. Written as a
 * call-site prop, the runtime applies the preferred value alone. It is a
 * style value: a theme scale takes no fallback list.
 */
export function firstThatWorks<
  const Values extends readonly [
    FallbackMember,
    FallbackMember,
    ...FallbackMember[],
  ],
>(...values: Values): Values[number];
export function firstThatWorks(
  ...values: [FallbackMember, ...FallbackMember[]]
): Fallbacks {
  return new Fallbacks(values);
}

/**
 * The members of a `firstThatWorks` value found where a style value sits,
 * preferred first, read by its key so a value another copy of this package
 * made is one too; `undefined` for any other value.
 */
export function fallbackMembersOf(
  value: AbstractProps
): readonly FallbackMember[] | undefined {
  const members = Object.getOwnPropertyDescriptor(value, FALLBACKS_KEY)?.value;
  return Array.isArray(members) ? members : undefined;
}
