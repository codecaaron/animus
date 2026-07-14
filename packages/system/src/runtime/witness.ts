/**
 * Dev-mode reachability witness: records every class-resolution outcome into a
 * bounded in-page ring buffer at globalThis.__ANIMUS_WITNESS__. Development
 * only — production builds must retain none of this (the handle name is the
 * greppable exclusion token).
 */

export type WitnessOutcome = 'static' | 'dynamic' | 'drop';

export interface WitnessRecord {
  component: string;
  prop: string;
  value: string;
  outcome: WitnessOutcome;
}

export const WITNESS_CAP = 5000;

export function recordWitness(
  component: string,
  prop: string,
  value: unknown,
  outcome: WitnessOutcome
): void {
  if (
    typeof process === 'undefined' ||
    process.env?.NODE_ENV === 'production'
  ) {
    return;
  }
  const g = globalThis as { __ANIMUS_WITNESS__?: WitnessRecord[] };
  const buf = (g.__ANIMUS_WITNESS__ ??= []);
  buf.push({ component, prop, value: String(value), outcome });
  if (buf.length > WITNESS_CAP) {
    buf.splice(0, buf.length - WITNESS_CAP);
  }
}
