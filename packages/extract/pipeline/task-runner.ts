import { createRequire } from 'module';

const declared = new Set<string>();

/** Tells Vite+'s task runner `directory` is a tool's own cache, neither an
 *  input nor an output of the task, as its cooperative-tracking client
 *  (@voidzero-dev/vite-task-client) does: the runner names a module in
 *  VP_RUN_NODE_CLIENT_PATH whose `load()` takes the report. Without it the
 *  runner fingerprints the folder, and a change another build made there
 *  misses the task. No runner, no report; once per folder per process. */
export function declareToolCache(directory: string): void {
  const client = process.env.VP_RUN_NODE_CLIENT_PATH;
  if (!client || declared.has(directory)) return;
  declared.add(directory);
  try {
    // SAFETY: the runner's client module exports `load()`, which answers
    // the reporting methods this calls, or null outside a runner.
    const runner = createRequire(client)(client).load() as {
      ignoreInput(path: string): void;
      ignoreOutput(path: string): void;
    } | null;
    runner?.ignoreInput(directory);
    runner?.ignoreOutput(directory);
  } catch {
    // A runner that takes no report caches as it would.
  }
}
