// verify:bench's decision protocol, as adopted: per row, scored
// baseline/candidate pairs, each scored against the row's budget, and a
// verdict from order statistics of the scores. A row's noise beyond its
// limits makes it inconclusive whatever the scores say.

export interface Budget {
  /** The candidate may be this fraction slower… */
  relative: number;
  /** …or this many ms, whichever is greater. */
  absolute: number;
  /** MAD/median limit of the baseline samples. */
  baselineNoise: number;
  /** MAD/median limit of the paired candidate/baseline ratios. */
  pairedNoise: number;
}

export const NATIVE_LOADER: Budget = {
  relative: 0.05,
  absolute: 50,
  baselineNoise: 0.05,
  pairedNoise: 0.03,
};
export const NATIVE_ANALYSIS: Budget = {
  relative: 0.05,
  absolute: 20,
  baselineNoise: 0.05,
  pairedNoise: 0.03,
};
export const FULL_BUILD: Budget = {
  relative: 0.1,
  absolute: 100,
  baselineNoise: 0.1,
  pairedNoise: 0.05,
};

export const BLOCK = 9;

export interface Pair {
  baseline: number;
  candidate: number;
}

export type Verdict = 'pass' | 'fail' | 'inconclusive';

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Median absolute deviation over the median. */
export function relativeMad(values: readonly number[]): number {
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center))) / center;
}

/** Over 1 when the candidate exceeds both the relative and the absolute
 *  allowance over its paired baseline. */
export function score(pair: Pair, budget: Budget): number {
  return (
    (pair.candidate - pair.baseline) /
    Math.max(budget.relative * pair.baseline, budget.absolute)
  );
}

export interface Noise {
  baseline: number;
  paired: number;
  /** Reported only: candidate-only instability. */
  candidate: number;
  exceeded: boolean;
}

export function noise(pairs: readonly Pair[], budget: Budget): Noise {
  const baseline = relativeMad(pairs.map((pair) => pair.baseline));
  const paired = relativeMad(
    pairs.map((pair) => pair.candidate / pair.baseline)
  );
  return {
    baseline,
    paired,
    candidate: relativeMad(pairs.map((pair) => pair.candidate)),
    exceeded: baseline > budget.baselineNoise || paired > budget.pairedNoise,
  };
}

/** The verdict of one block (9 pairs) or two (18): pass when the 8th (14th)
 *  sorted score is at most 1, fail when the 2nd (5th) exceeds 1. */
export function decide(pairs: readonly Pair[], budget: Budget): Verdict {
  if (pairs.length !== BLOCK && pairs.length !== 2 * BLOCK) {
    throw new Error(`a verdict reads ${BLOCK} or ${2 * BLOCK} pairs`);
  }
  if (noise(pairs, budget).exceeded) return 'inconclusive';
  const scores = pairs.map((pair) => score(pair, budget)).sort((a, b) => a - b);
  const [failAt, passAt] = pairs.length === BLOCK ? [1, 7] : [4, 13];
  if (scores[failAt] > 1) return 'fail';
  if (scores[passAt] <= 1) return 'pass';
  return 'inconclusive';
}

/** The first three scored pairs each over twice the baseline and over a
 *  second slower: a clear regression, so the row stops there. */
export function clearRegression(pairs: readonly Pair[]): boolean {
  return (
    pairs.length === 3 &&
    pairs.every(
      (pair) =>
        pair.candidate > 2 * pair.baseline &&
        pair.candidate - pair.baseline > 1000
    )
  );
}
