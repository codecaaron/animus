import { canonicalJson } from './identity';
import { enumerateCells } from './scenario';

import type { DimensionValue, ScenarioDomain, ScenarioPoint } from './scenario';

/**
 * Guards over scenario dimensions: the condition language shared by rules,
 * facts, obligations and evidence. It is deliberately decidable and free of
 * arithmetic — every leaf is a membership or a threshold test on one
 * dimension, which is exactly what makes `enumerateCells` a proof procedure.
 */
export type Predicate =
  | { kind: 'true' }
  | { kind: 'false' }
  | { kind: 'eq'; dim: string; value: DimensionValue }
  | { kind: 'in'; dim: string; values: readonly DimensionValue[] }
  | {
      kind: 'range';
      dim: string;
      min?: number;
      minInclusive?: boolean;
      max?: number;
      maxInclusive?: boolean;
    }
  | { kind: 'and'; operands: readonly Predicate[] }
  | { kind: 'or'; operands: readonly Predicate[] }
  | { kind: 'not'; operand: Predicate };

export interface RangeOptions {
  min?: number;
  minInclusive?: boolean;
  max?: number;
  maxInclusive?: boolean;
}

export const TRUE: Predicate = Object.freeze({ kind: 'true' as const });
export const FALSE: Predicate = Object.freeze({ kind: 'false' as const });

const valueKey = (value: DimensionValue): string =>
  `${typeof value}:${canonicalJson(value)}`;

export const eq = (dim: string, value: DimensionValue): Predicate => ({
  kind: 'eq',
  dim,
  value,
});

/**
 * Membership. Values are deduplicated and ordered by their canonical key so
 * that two logically identical predicates hash identically — predicates are
 * part of fact identity, so their normal form has to be canonical.
 */
export const inSet = (
  dim: string,
  values: readonly DimensionValue[]
): Predicate => {
  const byKey = new Map<string, DimensionValue>();
  for (const value of values) byKey.set(valueKey(value), value);
  const keys = Array.from(byKey.keys()).sort();
  const unique = keys.map((key) => byKey.get(key) as DimensionValue);

  if (unique.length === 0) return FALSE;
  if (unique.length === 1) return eq(dim, unique[0]);
  return { kind: 'in', dim, values: unique };
};

/**
 * Threshold test. Inclusivity defaults to inclusive on whichever bound is
 * present and is always written explicitly into the node, so evaluation never
 * depends on a reader remembering the default.
 */
export const range = (dim: string, opts: RangeOptions): Predicate => {
  const node: {
    kind: 'range';
    dim: string;
    min?: number;
    minInclusive?: boolean;
    max?: number;
    maxInclusive?: boolean;
  } = { kind: 'range', dim };

  if (opts.min !== undefined) {
    if (!Number.isFinite(opts.min)) {
      throw new RangeError(`range(${dim}): min must be finite`);
    }
    node.min = opts.min;
    node.minInclusive = opts.minInclusive ?? true;
  }
  if (opts.max !== undefined) {
    if (!Number.isFinite(opts.max)) {
      throw new RangeError(`range(${dim}): max must be finite`);
    }
    node.max = opts.max;
    node.maxInclusive = opts.maxInclusive ?? true;
  }

  if (node.min !== undefined && node.max !== undefined) {
    if (node.min > node.max) return FALSE;
    if (
      node.min === node.max &&
      !(node.minInclusive === true && node.maxInclusive === true)
    ) {
      return FALSE;
    }
  }

  return node;
};

const flatten = (
  kind: 'and' | 'or',
  operands: readonly Predicate[]
): Predicate[] => {
  const flat: Predicate[] = [];
  for (const operand of operands) {
    if (operand.kind === kind) {
      flat.push(...flatten(kind, operand.operands));
    } else {
      flat.push(operand);
    }
  }
  return flat;
};

const dedupe = (operands: readonly Predicate[]): Predicate[] => {
  const seen = new Set<string>();
  const unique: Predicate[] = [];
  for (const operand of operands) {
    const key = canonicalJson(operand);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(operand);
  }
  return unique;
};

export const and = (...ps: readonly Predicate[]): Predicate => {
  const flat = flatten('and', ps);
  if (flat.some((p) => p.kind === 'false')) return FALSE;
  const kept = dedupe(flat.filter((p) => p.kind !== 'true'));
  if (kept.length === 0) return TRUE;
  if (kept.length === 1) return kept[0];
  return { kind: 'and', operands: kept };
};

export const or = (...ps: readonly Predicate[]): Predicate => {
  const flat = flatten('or', ps);
  if (flat.some((p) => p.kind === 'true')) return TRUE;
  const kept = dedupe(flat.filter((p) => p.kind !== 'false'));
  if (kept.length === 0) return FALSE;
  if (kept.length === 1) return kept[0];
  return { kind: 'or', operands: kept };
};

export const not = (p: Predicate): Predicate => {
  if (p.kind === 'true') return FALSE;
  if (p.kind === 'false') return TRUE;
  if (p.kind === 'not') return p.operand;
  return { kind: 'not', operand: p };
};

const inRange = (
  value: number,
  p: Extract<Predicate, { kind: 'range' }>
): boolean => {
  if (p.min !== undefined) {
    const ok = (p.minInclusive ?? true) ? value >= p.min : value > p.min;
    if (!ok) return false;
  }
  if (p.max !== undefined) {
    const ok = (p.maxInclusive ?? true) ? value <= p.max : value < p.max;
    if (!ok) return false;
  }
  return true;
};

/**
 * Evaluate a guard at one scenario point.
 *
 * A leaf naming a dimension that the point does not bind evaluates to FALSE:
 * the condition is *not active* in this world. This is the scoping rule from
 * DESIGN §8 — proofs are relative to the declared scenario domain, so a rule
 * conditioned on an axis the world never declared cannot silently apply.
 * The cost is that "unbound" and "bound but non-matching" look alike here, so
 * engines are responsible for surfacing `referencedDimensions` that the world
 * does not declare as explicit assumptions in the probe result rather than
 * letting them vanish into a false.
 */
export const evalPredicate = (p: Predicate, point: ScenarioPoint): boolean => {
  switch (p.kind) {
    case 'true':
      return true;
    case 'false':
      return false;
    case 'eq':
      return Object.hasOwn(point, p.dim) && point[p.dim] === p.value;
    case 'in':
      return (
        Object.hasOwn(point, p.dim) &&
        p.values.some((value) => value === point[p.dim])
      );
    case 'range': {
      const value = point[p.dim];
      return typeof value === 'number' && inRange(value, p);
    }
    case 'and':
      return p.operands.every((operand) => evalPredicate(operand, point));
    case 'or':
      return p.operands.some((operand) => evalPredicate(operand, point));
    case 'not':
      return !evalPredicate(p.operand, point);
  }
};

const walk = (p: Predicate, visit: (leaf: Predicate) => void): void => {
  switch (p.kind) {
    case 'and':
    case 'or':
      for (const operand of p.operands) walk(operand, visit);
      return;
    case 'not':
      walk(p.operand, visit);
      return;
    default:
      visit(p);
  }
};

export const referencedDimensions = (p: Predicate): string[] => {
  const dims = new Set<string>();
  walk(p, (leaf) => {
    if (leaf.kind === 'eq' || leaf.kind === 'in' || leaf.kind === 'range') {
      dims.add(leaf.dim);
    }
  });
  return Array.from(dims).sort();
};

/**
 * The numeric thresholds a guard is sensitive to, per dimension.
 *
 * `range` bounds are thresholds by construction; numeric `eq`/`in` values are
 * collected unconditionally because a numeric literal on an interval dimension
 * is a threshold too (it splits the axis into a singleton). Callers filter out
 * the dimensions that turn out to be finite — over-collecting only ever refines
 * the partition, which is always sound, whereas under-collecting breaks the
 * cell invariant.
 */
export const collectCuts = (p: Predicate): Record<string, number[]> => {
  const collected = new Map<string, Set<number>>();
  const push = (dim: string, value: number): void => {
    if (!Number.isFinite(value)) return;
    const set = collected.get(dim) ?? new Set<number>();
    set.add(value);
    collected.set(dim, set);
  };

  walk(p, (leaf) => {
    if (leaf.kind === 'eq') {
      if (typeof leaf.value === 'number') push(leaf.dim, leaf.value);
      return;
    }
    if (leaf.kind === 'in') {
      for (const value of leaf.values) {
        if (typeof value === 'number') push(leaf.dim, value);
      }
      return;
    }
    if (leaf.kind === 'range') {
      if (leaf.min !== undefined) push(leaf.dim, leaf.min);
      if (leaf.max !== undefined) push(leaf.dim, leaf.max);
    }
  });

  const out: Record<string, number[]> = {};
  for (const dim of Array.from(collected.keys()).sort()) {
    const values = Array.from(collected.get(dim) as Set<number>);
    values.sort((a, b) => a - b);
    out[dim] = values;
  }
  return out;
};

/**
 * Is the guard satisfiable anywhere in the domain?
 *
 * Sound exactly under the cell invariant of `enumerateCells`: if every
 * threshold the guard mentions is in `cuts`, the guard is constant on each
 * cell, so "no representative satisfies it" means "no point satisfies it".
 */
export const satisfiableOverDomain = (
  p: Predicate,
  domain: ScenarioDomain,
  cuts: Readonly<Record<string, readonly number[]>>
): boolean =>
  enumerateCells(domain, cuts).some((cell) => evalPredicate(p, cell.point));

const describeRange = (p: Extract<Predicate, { kind: 'range' }>): string => {
  const lower =
    p.min === undefined
      ? ''
      : `${p.min} ${(p.minInclusive ?? true) ? '≤' : '<'} `;
  const upper =
    p.max === undefined
      ? ''
      : ` ${(p.maxInclusive ?? true) ? '≤' : '<'} ${p.max}`;

  if (p.min !== undefined && p.max !== undefined) {
    return `${lower}${p.dim}${upper}`;
  }
  if (p.min !== undefined) {
    return `${p.dim} ${(p.minInclusive ?? true) ? '≥' : '>'} ${p.min}`;
  }
  if (p.max !== undefined) {
    return `${p.dim} ${(p.maxInclusive ?? true) ? '≤' : '<'} ${p.max}`;
  }
  return `${p.dim} is numeric`;
};

const needsParens = (p: Predicate): boolean =>
  p.kind === 'and' || p.kind === 'or';

export const describePredicate = (p: Predicate): string => {
  switch (p.kind) {
    case 'true':
      return 'always';
    case 'false':
      return 'never';
    case 'eq':
      return `${p.dim} = ${String(p.value)}`;
    case 'in':
      return `${p.dim} ∈ {${p.values.map(String).join(', ')}}`;
    case 'range':
      return describeRange(p);
    case 'and':
      return p.operands
        .map((operand) =>
          operand.kind === 'or'
            ? `(${describePredicate(operand)})`
            : describePredicate(operand)
        )
        .join(' ∧ ');
    case 'or':
      return p.operands.map(describePredicate).join(' ∨ ');
    case 'not':
      return needsParens(p.operand)
        ? `¬(${describePredicate(p.operand)})`
        : `¬${describePredicate(p.operand)}`;
  }
};
