type FallbackMember = string | number;

/** How extraction spells a call: the one key of an object of its members. */
const FALLBACKS_KEY = '$animus.firstThatWorks';

/** Set on the global object by the extraction host (the system loader). */
const READS_FALLBACKS = '__ANIMUS_READS_FALLBACKS__';

/**
 * A call's members under extraction. They serialize for the loader as the
 * one key extraction reads, and the value prints as the preferred member,
 * so a name hashed from styles is the same with and without extraction.
 */
class Fallbacks {
  readonly [FALLBACKS_KEY]: readonly FallbackMember[];

  constructor(members: readonly [FallbackMember, ...FallbackMember[]]) {
    this[FALLBACKS_KEY] = members;
  }

  toString(): string {
    return String(this[FALLBACKS_KEY][0]);
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
 * evaluation in registered global styles and keyframes. Anywhere else, a
 * call-site prop included, it returns the preferred value alone.
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
): FallbackMember | Fallbacks {
  if (
    Object.getOwnPropertyDescriptor(globalThis, READS_FALLBACKS)?.value !== true
  ) {
    return values[0];
  }
  return new Fallbacks(values);
}
