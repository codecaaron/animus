export type DimensionValue = string | number | boolean;

export type DimensionValueKind = 'boolean' | 'number' | 'string';

const isIntrinsicPrimitive = (value: DimensionValue): boolean =>
  Object(value) !== value;

export const isNumberDimensionValue = (
  value: DimensionValue
): value is number => {
  if (!isIntrinsicPrimitive(value)) return false;
  try {
    Number.prototype.valueOf.call(value);
    return true;
  } catch {
    return false;
  }
};

export const isStringDimensionValue = (
  value: DimensionValue
): value is string => {
  if (!isIntrinsicPrimitive(value)) return false;
  try {
    String.prototype.valueOf.call(value);
    return true;
  } catch {
    return false;
  }
};

export const dimensionValueKind = (
  value: DimensionValue
): DimensionValueKind =>
  isNumberDimensionValue(value)
    ? 'number'
    : isStringDimensionValue(value)
      ? 'string'
      : 'boolean';

const SCOPED_DIMENSION = /^(variant|state|prop):([^:]+):(.+)$/;

export interface ScopedDimension {
  kind: 'variant' | 'state' | 'prop';
  owner: string;
  name: string;
}

const isScopedKind = (value: string): value is ScopedDimension['kind'] =>
  value === 'variant' || value === 'state' || value === 'prop';

export const parseScopedDimension = (
  dimension: string
): ScopedDimension | undefined => {
  const match = SCOPED_DIMENSION.exec(dimension);
  if (match === null) return undefined;
  const kind = match[1];
  if (!isScopedKind(kind)) return undefined;
  return { kind, owner: match[2], name: match[3] };
};

export const isScopedDimension = (dimension: string): boolean =>
  SCOPED_DIMENSION.test(dimension);

/**
 * State truthiness as the runtime evaluates it (`if (props[state])`), so the
 * string 'false' is active. Every provider must share this predicate.
 */
export const isActiveState = (value: DimensionValue): boolean =>
  value !== false && value !== 0 && value !== '';

export type DimensionDomain =
  | { kind: 'finite'; values: readonly DimensionValue[] }
  | { kind: 'interval'; min: number; max: number };

export type ScenarioDomain = Readonly<Record<string, DimensionDomain>>;

export type ScenarioPoint = Readonly<Record<string, DimensionValue>>;

export interface ScenarioCell {
  point: ScenarioPoint;
  description: Readonly<Record<string, string>>;
}

interface DimensionCell {
  value: DimensionValue;
  description: string;
}

const sortedInRangeCuts = (
  cuts: readonly number[] | undefined,
  min: number,
  max: number
): number[] => {
  if (cuts === undefined) return [];
  const kept = cuts.filter(
    (cut) => Number.isFinite(cut) && cut >= min && cut <= max
  );
  const unique = Array.from(new Set(kept));
  unique.sort((a, b) => a - b);
  return unique;
};

const assertInterval = (dimension: string, min: number, max: number): void => {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new RangeError(
      `scenario dimension '${dimension}': interval bounds must be finite ` +
        `(got [${String(min)}, ${String(max)}]) — an unbounded axis cannot be ` +
        'partitioned into sampleable cells'
    );
  }
  if (max < min) {
    throw new RangeError(
      `scenario dimension '${dimension}': empty interval [${min}, ${max}]`
    );
  }
};

const intervalCells = (
  dimension: string,
  min: number,
  max: number,
  cuts: readonly number[] | undefined
): DimensionCell[] => {
  assertInterval(dimension, min, max);

  if (min === max) {
    return [{ value: min, description: `${dimension} = ${min}` }];
  }

  const points = sortedInRangeCuts(cuts, min, max);
  if (points.length === 0) {
    return [
      {
        value: (min + max) / 2,
        description: `${min} ≤ ${dimension} ≤ ${max}`,
      },
    ];
  }

  const cells: DimensionCell[] = [];
  const first = points[0];
  if (min < first) {
    cells.push({
      value: (min + first) / 2,
      description: `${min} ≤ ${dimension} < ${first}`,
    });
  }

  for (let index = 0; index < points.length; index += 1) {
    const cut = points[index];
    cells.push({ value: cut, description: `${dimension} = ${cut}` });

    if (index + 1 < points.length) {
      const next = points[index + 1];
      cells.push({
        value: (cut + next) / 2,
        description: `${cut} < ${dimension} < ${next}`,
      });
    }
  }

  const last = points[points.length - 1];
  if (last < max) {
    cells.push({
      value: (last + max) / 2,
      description: `${last} < ${dimension} ≤ ${max}`,
    });
  }

  return cells;
};

const finiteCells = (
  dimension: string,
  values: readonly DimensionValue[]
): DimensionCell[] =>
  values.map((value) => ({
    value,
    description: `${dimension} = ${String(value)}`,
  }));

const cellsOf = (
  dimension: string,
  domain: DimensionDomain,
  cuts: Readonly<Record<string, readonly number[]>>
): DimensionCell[] =>
  domain.kind === 'finite'
    ? finiteCells(dimension, domain.values)
    : intervalCells(dimension, domain.min, domain.max, cuts[dimension]);

const countOf = (
  dimension: string,
  domain: DimensionDomain,
  cuts: Readonly<Record<string, readonly number[]>>
): number => {
  if (domain.kind === 'finite') return domain.values.length;

  const { min, max } = domain;
  assertInterval(dimension, min, max);
  if (min === max) return 1;

  const points = sortedInRangeCuts(cuts[dimension], min, max);
  if (points.length === 0) return 1;

  const flankLow = min < points[0] ? 1 : 0;
  const flankHigh = points[points.length - 1] < max ? 1 : 0;
  return points.length * 2 - 1 + flankLow + flankHigh;
};

export const enumerateCells = (
  domain: ScenarioDomain,
  cuts: Readonly<Record<string, readonly number[]>>
): ScenarioCell[] => {
  const dimensions = Object.keys(domain).sort();

  let cells: ScenarioCell[] = [{ point: {}, description: {} }];
  for (const dimension of dimensions) {
    const perDimension = cellsOf(dimension, domain[dimension], cuts);
    const next: ScenarioCell[] = [];
    for (const cell of cells) {
      for (const slice of perDimension) {
        next.push({
          point: { ...cell.point, [dimension]: slice.value },
          description: { ...cell.description, [dimension]: slice.description },
        });
      }
    }
    cells = next;
  }

  return cells;
};

export const countCells = (
  domain: ScenarioDomain,
  cuts: Readonly<Record<string, readonly number[]>>
): number => {
  let total = 1;
  for (const dimension of Object.keys(domain).sort()) {
    total *= countOf(dimension, domain[dimension], cuts);
  }
  return total;
};
