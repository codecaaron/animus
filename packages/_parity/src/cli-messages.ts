/** The gate ran and failed: a real parity regression. */
export const EXIT_GATE_FAILED = 1;
/** The harness refused to run; nothing was decided about parity. */
export const EXIT_REFUSED = 2;
/** The harness itself broke; nothing was decided about parity. */
export const EXIT_UNEXPECTED = 3;

/** A refusal to run whose message is the whole report: printed as that one
 *  line without a stack, so the output is identical on every machine. */
export class ParityRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParityRefusal';
  }
}

export interface CliFailure {
  exitCode: number;
  stderr: string;
}

/** The one place an exit code and a print shape are chosen: call sites throw
 *  `ParityRefusal` to declare a refusal instead of choosing either. */
export function classifyCliFailure(error: Error): CliFailure {
  return error instanceof ParityRefusal
    ? { exitCode: EXIT_REFUSED, stderr: error.message }
    : { exitCode: EXIT_UNEXPECTED, stderr: error.stack ?? String(error) };
}

export function baselineStaleFailureMessage(): string {
  return [
    'PARITY GATE: FAIL (committed v2 baseline is stale; oracle NOT updated).',
    'If the drift is intentional, record exact register entries and a checked baseline intent, then run:',
    'scripts/verify/refresh-parity-baseline.sh <checked-intent-id>',
  ].join(' ');
}
