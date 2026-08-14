/**
 * `animus` — the standalone extraction CLI (openspec:
 * standalone-extraction-cli).
 *
 * Contract (design D5): stdout carries machine output ONLY (today: the
 * `--print-config` JSON projection); every human-facing line goes to
 * stderr. Exit taxonomy: 0 success · 1 extraction/strict failure · 2
 * config/usage error · 3 engine/environment failure.
 *
 * UNSTABLE MODULE SURFACE: the package's programmatic exports (`main`,
 * `exitCodeFor`, the EXIT_* constants) exist for the repo's own lanes and
 * tests; the supported consumer surface is the `animus` binary. The module
 * API may change without semver ceremony until a consumer contract ships
 * (standalone-extraction-cli inc 07).
 */

import { AnimusConfigError } from '@animus-ui/extract/pipeline';
import { parseArgs } from 'node:util';

import { EnvironmentFailure, runBuild, UsageFailure } from './build';
import { projectResolvedConfig, resolveCliConfig } from './config';
import { runWatch } from './watch';

export const EXIT_OK = 0;
export const EXIT_EXTRACTION = 1;
export const EXIT_USAGE = 2;
export const EXIT_ENVIRONMENT = 3;

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
  --exclude <glob>    Additional exclusion (repeatable; MERGES with defaults)
  --mode <m>          'development' | 'production' (default: production)
  --targets <query>   Browserslist query for CSS lowering
  --strict            Escalate extraction warnings to failures
  --fail-on-degraded  watch only: exit 3 instead of running with unwatched
                      roots (degradation is otherwise reported and tolerated)
  --verbose           Verbose logging (stderr)
  --print-config      Alias of the print-config command
  --help              This text

Exit codes: 0 success · 1 extraction failure · 2 config error · 3 engine failure
Watch shutdown: SIGINT exits 130, SIGTERM 143 (lock released, last-good kept)
`;

/** Classify an error into the documented exit taxonomy. ExtractionFailure
 *  and unclassified errors deliberately share the extraction exit class —
 *  an unknown throw during a build IS a failed extraction to a supervisor. */
export function exitCodeFor(error: unknown): number {
  if (error instanceof UsageFailure || error instanceof AnimusConfigError) {
    return EXIT_USAGE;
  }
  if (error instanceof EnvironmentFailure) return EXIT_ENVIRONMENT;
  return EXIT_EXTRACTION;
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
    console.error(`[animus] ${String((error as Error).message)}`);
    console.error(USAGE);
    process.exitCode = EXIT_USAGE;
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

  try {
    const config = await resolveCliConfig(flags, process.cwd());

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

    if (command === 'watch') {
      // Long-lived: resolves only at shutdown, carrying the exit code
      // (130 SIGINT / 143 SIGTERM / 3 fail-on-degraded). Startup failures
      // throw into the shared taxonomy catch below.
      process.exitCode = await runWatch(config, {
        failOnDegraded: values['fail-on-degraded'] === true,
      });
      return;
    }

    console.error(`[animus] Unknown command '${command}'`);
    console.error(USAGE);
    process.exitCode = EXIT_USAGE;
  } catch (error) {
    console.error(`[animus] ${String((error as Error).message ?? error)}`);
    process.exitCode = exitCodeFor(error);
  }
}
