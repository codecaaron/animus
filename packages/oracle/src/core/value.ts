import { canonicalJson } from './identity';
import { describePredicate, or } from './predicate';

import type { ObligationId } from './identity';
import type { Predicate } from './predicate';

/**
 * The precision lattice (DESIGN §3). A fact's value is never forced into
 * known/unknown: it is as strong as the model can support and no stronger.
 * `unknown` is not a failure — it is an addressable proof obligation.
 */
export type AbstractValue<T> =
  | { kind: 'exact'; value: T }
  | { kind: 'finite-set'; values: readonly T[] }
  | { kind: 'interval'; min: number; max: number; unit?: string }
  | { kind: 'symbolic'; expression: string; refs: readonly string[] }
  | {
      kind: 'piecewise';
      cases: readonly { guard: Predicate; value: AbstractValue<T> }[];
    }
  | { kind: 'unknown'; obligation: ObligationId };

export interface PiecewiseCase<T> {
  guard: Predicate;
  value: AbstractValue<T>;
}

export const exact = <T>(v: T): AbstractValue<T> => ({
  kind: 'exact',
  value: v,
});

/**
 * A finite set of candidates. Duplicates are removed by canonical form, and a
 * one-element set is exactly an exact value — the normal form matters because
 * values participate in fact identity.
 */
export const finiteSet = <T>(values: readonly T[]): AbstractValue<T> => {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const value of values) {
    const key = canonicalJson(value);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }
  if (unique.length === 1) return exact(unique[0]);
  return { kind: 'finite-set', values: unique };
};

export const unknownValue = <T>(
  obligation: ObligationId
): AbstractValue<T> => ({ kind: 'unknown', obligation });

/** Structural equality over the canonical form. */
export const valueEquals = <T>(
  a: AbstractValue<T>,
  b: AbstractValue<T>
): boolean => canonicalJson(a) === canonicalJson(b);

/**
 * A guarded case analysis. Adjacent cases carrying equal values are merged by
 * disjoining their guards (the partition is a presentation detail, the value
 * is the fact), and a single unconditional case is just that value. Merging is
 * restricted to *adjacent* cases so that case order — which engines use to
 * encode precedence — is never reshuffled.
 */
export const piecewise = <T>(
  cases: readonly PiecewiseCase<T>[]
): AbstractValue<T> => {
  if (cases.length === 0) {
    throw new TypeError(
      'piecewise: at least one case is required — an empty case analysis ' +
        'states nothing and would silently stand in for an unknown'
    );
  }

  const merged: PiecewiseCase<T>[] = [];
  for (const next of cases) {
    const previous =
      merged.length === 0 ? undefined : merged[merged.length - 1];
    if (previous !== undefined && valueEquals(previous.value, next.value)) {
      merged[merged.length - 1] = {
        guard: or(previous.guard, next.guard),
        value: previous.value,
      };
      continue;
    }
    merged.push(next);
  }

  const only = merged[0];
  if (merged.length === 1 && only.guard.kind === 'true') return only.value;
  return { kind: 'piecewise', cases: merged };
};

/**
 * A leaf that is already text is its own description; everything else is
 * described by its canonical form. Boxed strings are deliberately excluded —
 * `canonicalJson` refuses them, and a description must never be the only place
 * an unencodable value slips through as if it were text.
 */
const isTextLeaf = <T>(value: T): value is T & string => {
  if (Object(value) === value) return false;
  try {
    String.prototype.valueOf.call(value);
    return true;
  } catch {
    return false;
  }
};

const describeLeaf = <T>(value: T): string =>
  isTextLeaf(value) ? value : canonicalJson(value);

export const describeValue = <T>(v: AbstractValue<T>): string => {
  switch (v.kind) {
    case 'exact':
      return describeLeaf(v.value);
    case 'finite-set':
      return `one of {${v.values.map(describeLeaf).join(', ')}}`;
    case 'interval':
      return `[${v.min}, ${v.max}]${v.unit ?? ''}`;
    case 'symbolic':
      return v.refs.length === 0
        ? v.expression
        : `${v.expression} (refs: ${v.refs.join(', ')})`;
    case 'piecewise':
      return v.cases
        .map(
          (branch) =>
            `when ${describePredicate(branch.guard)}: ${describeValue(
              branch.value
            )}`
        )
        .join(' | ');
    case 'unknown':
      return `unknown(${v.obligation})`;
  }
};

/**
 * How *precise* a value is — nothing more. Precision is orthogonal to
 * authority (DESIGN §3): a proven interval can be a stronger claim than an
 * exact measured point, so this rank exists for display and tie-breaking in
 * presentation only. Nothing in the substrate may collapse two facts, drop the
 * less precise one, or derive confidence from this number.
 */
export const precisionRank = <T>(v: AbstractValue<T>): number => {
  switch (v.kind) {
    case 'exact':
      return 5;
    case 'finite-set':
      return 4;
    case 'interval':
      return 3;
    case 'symbolic':
      return 2;
    case 'piecewise':
      return v.cases.length === 0
        ? 0
        : v.cases.reduce(
            (weakest, branch) => Math.min(weakest, precisionRank(branch.value)),
            5
          );
    case 'unknown':
      return 0;
  }
};
