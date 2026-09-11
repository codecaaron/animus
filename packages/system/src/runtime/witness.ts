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
