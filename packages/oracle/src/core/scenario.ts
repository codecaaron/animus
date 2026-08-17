/**
 * Scenario dimensions are the axes of the declared world: the finite,
 * enumerable set of contexts a target can be observed in.
 *
 * Dimension-name conventions (the host providers must follow them; engines key
 * off the prefixes):
 *
 * - `'viewport.inline'` — the inline-axis viewport size, an interval domain
 *   cut at the theme's breakpoints.
 * - `'mode'` — the color mode / theme selector (finite).
 * - `'variant:<component>:<prop>'` — one variant prop of one component; the
 *   domain is the declared option set.
 * - `'state:<component>:<name>'` — one declared state flag (usually boolean).
 * - `'prop:<component>:<name>'` — a non-variant prop that participates in
 *   style selection.
 *
 * The `<component>` segment is the component's binding name, so a dimension is
 * attributable to a target without a lookup table.
 */
export type DimensionValue = string | number | boolean;

/** Which of the three primitives a dimension value actually carries. */
export type DimensionValueKind = 'boolean' | 'number' | 'string';

/**
 * `DimensionValue` is an untagged union, so every consumer that has to branch
 * on which primitive it holds asks here instead of re-deriving the split.
 *
 * The guards accept intrinsic primitives only: a provider that hands back a
 * boxed `new Number(…)` has not produced a dimension value, and letting one
 * pass would put an object into a point that `canonicalJson` then refuses.
 */
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

/**
 * The kind tag is load-bearing, not a debug label: `inSet` embeds it in the
 * key it deduplicates and sorts membership by, so these three spellings decide
 * the normal form of every `in` predicate — and therefore every fact id that
 * quotes one.
 */
export const dimensionValueKind = (value: DimensionValue): DimensionValueKind =>
  isNumberDimensionValue(value)
    ? 'number'
    : isStringDimensionValue(value)
      ? 'string'
      : 'boolean';

const SCOPED_DIMENSION = /^(variant|state|prop):([^:]+):(.+)$/;

/** A component-scoped axis, parsed out of its conventional name. */
export interface ScopedDimension {
  kind: 'variant' | 'state' | 'prop';
  owner: string;
  name: string;
}

/**
 * Parse a scoped dimension name, or undefined for a shared axis. The one
 * definition of the naming convention above — providers and engines that
 * re-derive it with their own regexes will disagree on malformed names.
 */
/** The alternation in `SCOPED_DIMENSION`, as a value the parser can narrow by. */
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

/** True for a component-scoped axis; everything else every target shares. */
export const isScopedDimension = (dimension: string): boolean =>
  SCOPED_DIMENSION.test(dimension);

/**
 * State truthiness as the rendering runtime evaluates it
 * (`packages/system/src/runtime/resolveClasses.ts` tests `if (props[state])`),
 * so the string 'false' IS active. Providers must share this predicate or a
 * test double and the real adapter will disagree about which classes a state
 * emits.
 */
export const isActiveState = (value: DimensionValue): boolean =>
  value !== false && value !== 0 && value !== '';

export type DimensionDomain =
  | { kind: 'finite'; values: readonly DimensionValue[] }
  | { kind: 'interval'; min: number; max: number };

export type ScenarioDomain = Readonly<Record<string, DimensionDomain>>;

export type ScenarioPoint = Readonly<Record<string, DimensionValue>>;

/**
 * One equivalence class of the scenario domain: a representative point plus a
 * human-readable description of the range each coordinate stands for.
 */
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

/**
 * The exact partition of one interval dimension.
 *
 * With in-range cuts c1..cn the cells are, in order:
 * `[min, c1)`, `{c1}`, `(c1, c2)`, `{c2}`, …, `{cn}`, `(cn, max]` — every cut
 * is its own singleton and the gaps between cuts are open intervals. A cut
 * landing exactly on `min` or `max` shrinks the flanking interval to nothing,
 * and that empty cell is dropped. With no cuts the single cell is `[min, max]`.
 */
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
  // n singletons + (n - 1) interior gaps + the two (possibly empty) flanks.
  return points.length * 2 - 1 + flankLow + flankHigh;
};

/**
 * Enumerate the cartesian product of the per-dimension partitions.
 *
 * SOUNDNESS INVARIANT — the reason cell sampling is a proof rather than a
 * sample: for any `range` predicate whose thresholds are all present in
 * `cuts`, the predicate is *constant on every cell*. An interval cell never
 * straddles a threshold (each threshold is carved out as its own singleton and
 * the surviving open intervals lie strictly between consecutive thresholds), so
 * evaluating the predicate at one representative decides it for every point of
 * that cell. Consequently a property that holds at every cell representative
 * holds at every point of the domain, and a violating representative is a
 * genuine counterexample. The invariant is conditional: a predicate carrying a
 * threshold that is *not* in `cuts` may vary inside a cell, and any engine
 * quantifying over cells must first fold that predicate's `collectCuts` into
 * the cut set (or report the gap as an assumption).
 *
 * Dimensions are visited in sorted name order and the last dimension varies
 * fastest, so the enumeration order is a pure function of the inputs.
 */
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

/** The size of `enumerateCells(domain, cuts)` without materialising it. */
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
