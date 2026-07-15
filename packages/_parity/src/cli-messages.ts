export function baselineStaleFailureMessage(): string {
  return [
    'PARITY GATE: FAIL (committed v2 baseline is stale; oracle NOT updated).',
    'If the drift is intentional, record exact register entries and a checked baseline intent, then run:',
    'scripts/verify/refresh-parity-baseline.sh <checked-intent-id>',
  ].join(' ');
}
