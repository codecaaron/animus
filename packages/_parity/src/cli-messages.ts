/**
 * What the parity harness CLI prints when it stops, and the exit code that
 * goes with each kind of stop. Both the CLI and its tests read the contract
 * from here so neither can drift from the other.
 */

/** The gate ran and failed: a real parity regression. */
export const EXIT_GATE_FAILED = 1;
/** The harness refused to run; nothing was decided about parity. */
export const EXIT_REFUSED = 2;
/** The harness itself broke; nothing was decided about parity. */
export const EXIT_UNEXPECTED = 3;

/**
 * A refusal to run whose message is the whole report: caller input or
 * repository state is wrong and the message says which. Printed as that one
 * line, without a stack, so the output is identical on every machine.
 */
export class ParityRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParityRefusal';
  }
}

/** One stop: the text to write to stderr and the code to exit with. */
export interface CliFailure {
  exitCode: number;
  stderr: string;
}

/**
 * The harness's single failure-classification point, called from `cli.ts`
 * `main().catch`. Call sites throw a `ParityRefusal` to declare a refusal and
 * never choose an exit code or a print shape themselves. Takes an `Error`:
 * every throw in this package is one, and `engine-run.ts` normalizes the
 * NAPI's non-`Error` rejection before it reaches here.
 */
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
