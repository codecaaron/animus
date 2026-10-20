/** The supported consumer surface is the `animus` binary; the programmatic
 *  exports may change without semver ceremony. */

import {
  AnimusConfigError,
  REPLACEABLE_DEFAULT_EXCLUDE,
  STRUCTURAL_EXCLUDE,
} from '@animus-ui/extract/pipeline';
import { ANIMUS_ARTIFACT_DIR } from '@animus-ui/extract/session';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { EnvironmentFailure, err, runBuild, UsageFailure } from './build';
import {
  inferredRootNotice,
  projectResolvedConfig,
  resolveCliConfig,
} from './config';
import { formatCssAudit, runCssAudit } from './css-audit';
import { runWatch } from './watch';
import { MANIFEST_FILE } from './writer';

export { renderFontPreloads } from '@animus-ui/extract/pipeline';
export type { FontPreload } from '@animus-ui/extract/pipeline';

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
  animus prop-order [opts]    Write only .animus/prop-order.json, which the
                              animus/prop-order lint rule reads, without a
                              dev server
  animus css audit [opts]     Report what would shrink the shipped CSS,
                              ranked by measured Brotli savings; reads a
                              full manifest and the built output, writes
                              nothing

Options:
  --system <path>     SystemInstance module (required unless configured)
  --root <path>       Root every relative input resolves against
  --config <path>     Explicit config file (default: animus.config.* in root)
  --out-dir <path>    Artifact directory (default: <root>/.animus)
  --exclude <glob>    Exclusion (repeatable). With the config file's exclude,
                      REPLACES the defaults (${REPLACEABLE_DEFAULT_EXCLUDE.join(', ')});
                      exclude: [] in the config file means none.
                      ${STRUCTURAL_EXCLUDE.join(', ')} are always excluded
  --mode <m>          'development' | 'production' (default: production)
  --targets <query>   Browserslist query for CSS lowering
  --strict            Fail on inputs that could not be read or resolved,
                      and on classified unsupported Animus declarations
  --kit               build only: also write the kit descriptor, animus.json,
                      at the root, for the kit to export as ./animus.json
  --fail-on-degraded  watch only: exit 3 instead of running with unwatched
                      roots (degradation is otherwise reported and tolerated)
  --verbose           Verbose logging (stderr): phase checkpoints,
                      summaries and timing
  --trace             The trace tier (config: verbose: 'trace'); the CLI
                      has no per-item lines yet, so it logs what --verbose
                      logs
  --print-config      Alias of the print-config command
  --manifest <path>   css audit: the full manifest \`animus build --verbose\`
                      writes, or one a host captured (default:
                      manifest.json in --out-dir)
  --dist <path>       css audit: the built output (default: <root>/dist)
  --json              css audit: print the report as one JSON document on
                      stdout instead of text on stderr
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
        trace: { type: 'boolean' },
        kit: { type: 'boolean' },
        'fail-on-degraded': { type: 'boolean' },
        'print-config': { type: 'boolean' },
        manifest: { type: 'string' },
        dist: { type: 'string' },
        json: { type: 'boolean' },
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
  // Each command reads only its own flags: one it does not read is a
  // mistake, never silently ignored.
  const foreign = Object.keys(values).filter((flag) =>
    command === 'css' ? !CSS_AUDIT_FLAGS.has(flag) : AUDIT_ONLY_FLAGS.has(flag)
  );
  if (foreign.length > 0) {
    reportUsageError(
      `--${foreign[0]} is not an option of '${command === 'css' ? 'css audit' : command}'`
    );
    return;
  }
  if (command === 'css') {
    await runCssAuditCommand(positionals.slice(1), values);
    return;
  }
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
    command !== 'print-config' &&
    command !== 'prop-order'
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
    verbose: values.trace ? ('trace' as const) : values.verbose,
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
      await runBuild(config, { kit: values.kit === true });
      process.exitCode = EXIT_OK;
      return;
    }

    if (command === 'prop-order') {
      await runBuild(config, { propOrderOnly: true });
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

/** `animus css audit`: reads, measures and reports; it never writes the
 *  project, and exits 0 unless its input is unreadable. */
/** The flags `css audit` reads; the build commands read none of the
 *  audit's own. */
const CSS_AUDIT_FLAGS = new Set([
  'root',
  'out-dir',
  'manifest',
  'dist',
  'json',
]);
const AUDIT_ONLY_FLAGS = new Set(['manifest', 'dist', 'json']);

async function runCssAuditCommand(
  subcommand: string[],
  values: {
    root?: string;
    'out-dir'?: string;
    manifest?: string;
    dist?: string;
    json?: boolean;
  }
): Promise<void> {
  if (subcommand.length !== 1 || subcommand[0] !== 'audit') {
    reportUsageError(
      subcommand.length === 0
        ? "'css' needs a subcommand: audit"
        : `Unknown css subcommand '${subcommand.join(' ')}'`
    );
    return;
  }
  const root = resolve(values.root ?? process.cwd());
  try {
    const outDir = resolve(root, values['out-dir'] ?? ANIMUS_ARTIFACT_DIR);
    const report = await runCssAudit({
      manifest: resolve(root, values.manifest ?? join(outDir, MANIFEST_FILE)),
      dist: resolve(root, values.dist ?? 'dist'),
    });
    if (values.json) console.log(JSON.stringify(report, null, 2));
    else process.stderr.write(formatCssAudit(report));
    process.exitCode = EXIT_OK;
  } catch (error) {
    console.error(`[animus] ${String(readThrownMessage(error) ?? error)}`);
    process.exitCode = exitCodeFor(error);
  }
}
