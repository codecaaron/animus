/** The supported consumer surface is the `animus` binary; the programmatic
 *  exports may change without semver ceremony. */

import { AnimusConfigError } from '@animus-ui/extract/pipeline';
import { parseArgs } from 'node:util';

import { EnvironmentFailure, err, runBuild, UsageFailure } from './build';
import {
  inferredRootNotice,
  projectResolvedConfig,
  resolveCliConfig,
} from './config';
import { runWatch } from './watch';

export const EXIT_OK = 0;
export const EXIT_EXTRACTION = 1;
export const EXIT_USAGE = 2;
export const EXIT_ENVIRONMENT = 3;
/** Nothing in this module returns it: `bin/animus.mjs` decides the install
 *  failure class, since this module is the one that did not load. */
export const EXIT_INSTALL = 4;

const USAGE = `animus — standalone Animus extraction

Usage:
  animus build [options]      One-shot extraction to the artifact directory
  animus watch [options]      Long-lived watch: republish on change; ready,
                              per-cycle failures, and degradation on stderr
  animus print-config [opts]  Print the fully resolved configuration (JSON)

Options:
  --system <path>     SystemInstance module (required unless configured)
  --root <path>       Root every relative input resolves against
  --config <path>     Explicit config file (default: animus.config.* in root)
  --out-dir <path>    Artifact directory (default: <root>/.animus)
  --exclude <glob>    Additional exclusion (repeatable; MERGES with defaults;
                      an explicit exclude: [] in the config file means none)
  --mode <m>          'development' | 'production' (default: production)
  --targets <query>   Browserslist query for CSS lowering
  --strict            Fail on inputs that could not be read or resolved
  --fail-on-degraded  watch only: exit 3 instead of running with unwatched
                      roots (degradation is otherwise reported and tolerated)
  --verbose           Verbose logging (stderr)
  --print-config      Alias of the print-config command
  --help              This text

Exit codes: 0 success · 1 extraction failure · 2 config error · 3 engine
failure · 4 the animus install could not be loaded
Shutdown signals: SIGINT exits 130, SIGTERM 143 (lock released, last-good kept)
`;

type ErrorMessageValue =
  | object
  | string
  | number
  | bigint
  | boolean
  | symbol
  | null
  | undefined;

interface ErrorMessageHolder {
  message?: ErrorMessageValue;
}

function readThrownMessage<Thrown>(error: Thrown): ErrorMessageValue {
  // SAFETY: exposes only the optional `message` property these catch paths
  // already read; the runtime value is untouched, so its behavior stands.
  return (error as Thrown & ErrorMessageHolder).message;
}

/** Unclassified throws share the extraction class: an unknown throw during
 *  a build is a failed extraction to a supervisor. */
export function exitCodeFor<Thrown>(error: Thrown): number {
  if (error instanceof UsageFailure || error instanceof AnimusConfigError) {
    return EXIT_USAGE;
  }
  if (error instanceof EnvironmentFailure) return EXIT_ENVIRONMENT;
  return EXIT_EXTRACTION;
}

function reportUsageError(reason: string): void {
  console.error(`[animus] ${reason}`);
  console.error(USAGE);
  process.exitCode = EXIT_USAGE;
}

export async function main(
  argv: string[] = process.argv.slice(2)
): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        system: { type: 'string' },
        root: { type: 'string' },
        config: { type: 'string' },
        'out-dir': { type: 'string' },
        exclude: { type: 'string', multiple: true },
        mode: { type: 'string' },
        targets: { type: 'string' },
        strict: { type: 'boolean' },
        verbose: { type: 'boolean' },
        'fail-on-degraded': { type: 'boolean' },
        'print-config': { type: 'boolean' },
        help: { type: 'boolean' },
      },
    });
  } catch (error) {
    reportUsageError(String(readThrownMessage(error)));
    return;
  }

  const { values, positionals } = parsed;
  if (values.help || positionals.length === 0) {
    console.error(USAGE);
    process.exitCode =
      positionals.length === 0 && !values.help ? EXIT_USAGE : EXIT_OK;
    return;
  }

  const command = positionals[0];
  // Command shape is decided from argv alone, before any filesystem work,
  // and the narrowing is what makes the dispatch below total.
  if (positionals.length > 1) {
    reportUsageError(
      `Unexpected argument '${positionals[1]}' — one command per invocation`
    );
    return;
  }
  if (
    command !== 'build' &&
    command !== 'watch' &&
    command !== 'print-config'
  ) {
    reportUsageError(`Unknown command '${command}'`);
    return;
  }

  const flags = {
    system: values.system,
    root: values.root,
    config: values.config,
    outDir: values['out-dir'],
    strict: values.strict,
    verbose: values.verbose,
    mode: values.mode,
    targets: values.targets,
    exclude: values.exclude,
  };

  const cwd = process.cwd();
  try {
    const config = await resolveCliConfig(flags, cwd);
    const rootNotice = inferredRootNotice(config, cwd);
    if (rootNotice !== null) err(rootNotice);

    if (command === 'print-config' || values['print-config']) {
      // The only stdout surface: one complete JSON document.
      console.log(JSON.stringify(projectResolvedConfig(config), null, 2));
      process.exitCode = EXIT_OK;
      return;
    }

    if (command === 'build') {
      await runBuild(config);
      process.exitCode = EXIT_OK;
      return;
    }

    process.exitCode = await runWatch(config, {
      failOnDegraded: values['fail-on-degraded'] === true,
    });
  } catch (error) {
    console.error(`[animus] ${String(readThrownMessage(error) ?? error)}`);
    process.exitCode = exitCodeFor(error);
  }
}
