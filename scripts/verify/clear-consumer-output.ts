import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

// What a consumer build writes beside its sources. All of it is ignored, so
// it survives `git clean -fd`, and a build over a stale copy can fail, or
// pass, on state the current source no longer produces.
const BUILD_OUTPUT_NAMES = [
  '.animus',
  '.next',
  'build',
  'dist',
  'tsconfig.tsbuildinfo',
] as const;

function trackedFiles(buildRoot: string, paths: readonly string[]): string[] {
  const result = spawnSync(
    'git',
    ['--literal-pathspecs', 'ls-files', '-z', '--', ...paths],
    { cwd: buildRoot, encoding: 'utf8' }
  );
  if (result.status !== 0) {
    const reason = result.error?.message ?? result.stderr.trim();
    throw new Error(`cannot list tracked files in ${buildRoot}: ${reason}`);
  }
  return result.stdout.split('\0').filter(Boolean);
}

/**
 * Removes the build output directly under `buildRoot`, and returns what it
 * removed. Throws, removing nothing, when git tracks any file inside it.
 */
function clearStaleBuildOutput(buildRoot: string): string[] {
  const stale = BUILD_OUTPUT_NAMES.filter((name) =>
    existsSync(join(buildRoot, name))
  );
  // An empty pathspec would list every tracked file.
  if (stale.length === 0) return [];

  const tracked = trackedFiles(buildRoot, stale);
  if (tracked.length > 0) {
    throw new Error(
      `git tracks files inside build output of ${buildRoot}, so none was cleared: ${tracked.join(', ')}`
    );
  }

  for (const name of stale) {
    rmSync(join(buildRoot, name), { recursive: true, force: true });
  }
  return stale;
}

function main(args: readonly string[]): number {
  const [buildRoot] = args;
  if (!buildRoot || args.length !== 1) {
    console.error('ERROR: usage: clear-consumer-output.ts <build root>');
    return 2;
  }

  try {
    for (const name of clearStaleBuildOutput(resolve(buildRoot))) {
      console.log(`cleared ${join(buildRoot, name)}`);
    }
    return 0;
  } catch (error) {
    // SAFETY: every throw reachable here is an Error — the explicit throw
    // above plus `node:fs` failures.
    console.error(`ERROR: ${(error as Error).message}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
