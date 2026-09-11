#!/usr/bin/env bun
/**
 * `process.exit` truncates stdout and stderr; setting `exitCode` lets both
 * flush before the runtime leaves.
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
