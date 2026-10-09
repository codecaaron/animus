import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// The build output cleared before a consumer build, and nothing else: other
// ignored state, such as .svelte-kit, .react-router, .wrangler or out, stays.
// Ignored output survives `git clean -fd`, and a build over a stale copy can
// fail, or pass, on state the current source no longer produces.
const BUILD_OUTPUT_NAMES = [
  '.animus',
  '.next',
  'build',
  'dist',
  'tsconfig.tsbuildinfo',
] as const;

const USAGE =
  'clear-consumer-output.ts takes exactly one build root. Run: bun scripts/verify/clear-consumer-output.ts <build root>';

function gitListFiles(
  buildRoot: string,
  selection: readonly string[],
  paths: readonly string[]
): string[] {
  const result = spawnSync(
    'git',
    ['--literal-pathspecs', 'ls-files', '-z', ...selection, '--', ...paths],
    { cwd: buildRoot, encoding: 'utf8' }
  );
  if (result.status !== 0) {
    const reason = result.error?.message ?? result.stderr.trim();
    throw new Error(
      `git is needed to tell tracked and unignored files from build output in ${buildRoot}, and git ls-files failed (${reason}). Run: git -C ${buildRoot} status`
    );
  }
  return result.stdout.split('\0').filter(Boolean);
}

/**
 * Removes the build output directly under `buildRoot`, and returns what it
 * removed. Throws, removing nothing, unless git ignores every file in it.
 */
function clearStaleBuildOutput(buildRoot: string): string[] {
  if (!statSync(buildRoot, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(
      `build root ${buildRoot} missing. Run: bun scripts/verify/clear-consumer-output.ts <existing build root>`
    );
  }

  // Exact names from the directory itself: a case-insensitive lookup of
  // `build` would also find a tracked `Build/`.
  const entries = new Set(readdirSync(buildRoot));
  const stale = BUILD_OUTPUT_NAMES.filter((name) => entries.has(name));
  // An empty pathspec would list every file in the repository.
  if (stale.length === 0) return [];

  const tracked = gitListFiles(buildRoot, ['--cached'], stale);
  if (tracked.length > 0) {
    throw new Error(
      `git tracks files inside build output in ${buildRoot}, so nothing was cleared: ${tracked.join(', ')}. Run: git -C ${buildRoot} rm -r --cached -- ${tracked.join(' ')}, or move them out of the build output`
    );
  }

  const unignored = gitListFiles(
    buildRoot,
    ['--others', '--exclude-standard'],
    stale
  );
  if (unignored.length > 0) {
    throw new Error(
      `git does not ignore files inside build output in ${buildRoot}, so nothing was cleared: ${unignored.join(', ')}. Run: add the output directory to ${join(buildRoot, '.gitignore')}, or move those files out of it`
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
    console.error(`ERROR: ${USAGE}`);
    return 2;
  }

  try {
    for (const name of clearStaleBuildOutput(resolve(buildRoot))) {
      console.log(`cleared ${join(buildRoot, name)}`);
    }
    return 0;
  } catch (error) {
    // SAFETY: every throw reachable here is an Error — the explicit throws
    // above plus `node:fs` failures.
    console.error(`ERROR: ${(error as Error).message}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
