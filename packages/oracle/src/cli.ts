#!/usr/bin/env bun
/**
 * `animus-oracle` — the binary entry point.
 *
 * Everything testable lives in `./cli/run`; this file owns only the two things
 * a process boundary owns: the real streams and the exit code. `process.exit`
 * is deliberately not called — setting `exitCode` lets stdout and stderr flush
 * before the runtime leaves.
 */

import { runCli } from './cli/run';

export {
  DEFAULT_ARTIFACT_DIR,
  EXIT_DISPROVED,
  EXIT_ENVIRONMENT,
  EXIT_OK,
  EXIT_UNSETTLED,
  EXIT_USAGE,
  exitCodeForError,
  exitCodeForVerdict,
  runCli,
} from './cli/run';
export type { CliStream, CliStreams } from './cli/run';

export const main = async (): Promise<void> => {
  process.exitCode = await runCli(process.argv.slice(2), {
    stdout: process.stdout,
    stderr: process.stderr,
    stdin: process.stdin,
  });
};

if (import.meta.main) await main();
