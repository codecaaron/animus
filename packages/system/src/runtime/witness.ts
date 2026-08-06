/**
 * Dev-mode reachability witness: records every class-resolution outcome into a
 * bounded in-page ring buffer at globalThis.__ANIMUS_WITNESS__. Development
 * only — a production build records nothing and never creates the handle
 * (IS_DEV is false); the gated code itself is retained in the bundle rather
 * than eliminated, see is-dev.ts for why that trade is deliberate. The handle
 * name is the greppable exclusion token.
 */

import { IS_DEV } from './is-dev';

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
  if (!IS_DEV) {
    return;
  }
  const g = globalThis as { __ANIMUS_WITNESS__?: WitnessRecord[] };
  const buf = (g.__ANIMUS_WITNESS__ ??= []);
  buf.push({ component, prop, value: String(value), outcome });
  if (buf.length > WITNESS_CAP) {
    buf.splice(0, buf.length - WITNESS_CAP);
  }
}
