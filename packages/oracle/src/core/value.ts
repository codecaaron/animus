import { canonicalJson } from './identity';
import { describePredicate, or } from './predicate';

import type { ObligationId } from './identity';
import type { Predicate } from './predicate';

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

export const valueEquals = <T>(
  a: AbstractValue<T>,
  b: AbstractValue<T>
): boolean => canonicalJson(a) === canonicalJson(b);

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
