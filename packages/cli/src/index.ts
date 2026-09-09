/**
 * `animus` — the standalone extraction CLI (openspec:
 * standalone-extraction-cli).
 *
 * Contract (design D5): stdout carries machine output ONLY (today: the
 * `--print-config` JSON projection); every human-facing line goes to
 * stderr. Exit taxonomy: 0 success · 1 extraction/strict failure · 2
 * config/usage error · 3 engine/environment failure · 4 the CLI install
 * itself could not be loaded (decided by bin/animus.mjs, never by `main`).
 *
 * UNSTABLE MODULE SURFACE: the package's programmatic exports (`main`,
 * `exitCodeFor`, the EXIT_* constants) exist for the repo's own lanes and
 * tests; the supported consumer surface is the `animus` binary. The module
 * API may change without semver ceremony until a consumer contract ships
 * (standalone-extraction-cli inc 07).
 */

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
/**
 * The CLI package itself could not be loaded — a broken or partial install.
 * `main()` never returns it: only `bin/animus.mjs` runs when this module is
 * unloadable, and it carries the literal 4 with this constant as its
 * authority. A class of its own because the remedy is reinstalling the CLI,
 * not fixing a project's config (2), sources (1), or environment (3).
 */
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
  // SAFETY: This exposes only the optional property that these catch paths
  // historically read directly. The runtime value stays untouched, so the
  // read retains its primitive receiver, getter order, and native nullish
  // TypeError behavior.
  return (error as Thrown & ErrorMessageHolder).message;
}

/** Classify an error into the documented exit taxonomy. ExtractionFailure
 *  and unclassified errors deliberately share the extraction exit class —
 *  an unknown throw during a build IS a failed extraction to a supervisor.
 *
 *  `AnimusLockConflictError` (writer.ts) is a SUBCLASS of
 *  `AnimusConfigError` and is caught by the branch below on purpose: a busy
 *  output directory keeps exit 2 as it always had. The subclass exists so
 *  callers can tell "another writer owns the tree" from "your config is
 *  wrong" without the exit code being the only distinguisher; moving it to
 *  EXIT_ENVIRONMENT is an open owner decision, not an accident of typing. */
export function exitCodeFor<Thrown>(error: Thrown): number {
  if (error instanceof UsageFailure || error instanceof AnimusConfigError) {
    return EXIT_USAGE;
  }
  if (error instanceof EnvironmentFailure) return EXIT_ENVIRONMENT;
  return EXIT_EXTRACTION;
}

/** The one way a malformed invocation is reported: the reason, the usage
 *  text, and the config/usage exit class, in that order. */
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
  // Command shape is decided from argv ALONE, before any filesystem work, so
  // a malformed invocation is not reported as whatever config resolution
  // failed on first. Narrowing here is also what makes the dispatch below
  // total — its last branch is provably `watch`.
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
    // Reported once, for every command; nothing else tells the user that the
    // root every relative input resolves against has moved.
    const rootNotice = inferredRootNotice(config, cwd);
    if (rootNotice !== null) err(rootNotice);

    if (command === 'print-config' || values['print-config']) {
      // The ONLY stdout surface: a complete JSON document.
      console.log(JSON.stringify(projectResolvedConfig(config), null, 2));
      process.exitCode = EXIT_OK;
      return;
    }

    if (command === 'build') {
      await runBuild(config);
      process.exitCode = EXIT_OK;
      return;
    }

    // Long-lived: resolves only at shutdown, carrying the exit code
    // (130 SIGINT / 143 SIGTERM / 3 fail-on-degraded). Startup failures
    // throw into the shared taxonomy catch below.
    process.exitCode = await runWatch(config, {
      failOnDegraded: values['fail-on-degraded'] === true,
    });
  } catch (error) {
    console.error(`[animus] ${String(readThrownMessage(error) ?? error)}`);
    process.exitCode = exitCodeFor(error);
  }
}
