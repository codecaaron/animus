/** The supported consumer surface is the `animus` binary; the programmatic
 *  exports may change without semver ceremony. */

import {
  AnimusConfigError,
  REPLACEABLE_DEFAULT_EXCLUDE,
  STRUCTURAL_EXCLUDE,
} from '@animus-ui/extract/pipeline';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { EnvironmentFailure, err, runBuild, UsageFailure } from './build';
import {
  inferredRootNotice,
  locateProject,
  projectResolvedConfig,
  resolveCliConfig,
} from './config';
import { formatCssAudit, runCssAudit } from './css-audit';
import {
  formatTypesAliasReport,
  PromotionIncompleteError,
  runTypesAlias,
} from './types-packet';
import { runWatch } from './watch';
import { MANIFEST_FILE } from './writer';

import type { TypesAliasReport } from './types-packet';

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
  animus types alias <declDir> --out <dir> --probes <dir> [opts]
                              Turn compiler declaration output into a
                              validated packet with shared registry aliases,
                              promoted to --out only when every check passes

Options:
  --system <path>     SystemInstance module (required unless configured)
  --root <path>       Root every relative input resolves against
  --config <path>     Explicit config file (default: animus.config.* in root)
  --out-dir <path>    Artifact directory (default: <root>/.animus)
  --exclude <glob>    Exclusion (repeatable). With the config file's exclude,
                      REPLACES the defaults (${REPLACEABLE_DEFAULT_EXCLUDE.join(', ')});
                      exclude: [] in the config file means none.
                      ${STRUCTURAL_EXCLUDE.join(', ')} are always excluded
  --condition <name>  Export condition the app's bundler resolves packages
                      with (repeatable, in its order; config: cli.conditions),
                      as Vite's resolve.conditions, so the build reads the
                      files the bundler does
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
  --json              css audit, types alias: print the report as one JSON
                      document on stdout instead of text on stderr
  --out <dir>         types alias: the packet directory (required); replaced
                      only when it is a packet this command wrote
  --project <path>    types alias: the producer tsconfig the checks inherit
                      options from (default: tsconfig.json)
  --probes <dir>      types alias: consumer probe files (required), checked
                      against the ordinary declarations and the packet
  --anchor <m>#<x>    types alias: a system declaration outside the packet,
                      as module specifier and export (repeatable)
  --tsc <path>        types alias: the tsc entry (default: the project's
                      typescript)
  --version           Print the @animus-ui/cli version
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

const CLI_OPTIONS = {
  system: { type: 'string' },
  root: { type: 'string' },
  config: { type: 'string' },
  'out-dir': { type: 'string' },
  exclude: { type: 'string', multiple: true },
  condition: { type: 'string', multiple: true },
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
  out: { type: 'string' },
  project: { type: 'string' },
  probes: { type: 'string' },
  anchor: { type: 'string', multiple: true },
  tsc: { type: 'string' },
  help: { type: 'boolean' },
  version: { type: 'boolean' },
} as const;

/** The command `argv` names, read past each string option's value, for
 *  arguments that did not parse. */
function commandOf(argv: readonly string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') return argv[index + 1];
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      const takesValue = Object.entries(CLI_OPTIONS).some(
        ([option, config]) => option === name && config.type === 'string'
      );
      if (takesValue) index += 1;
      continue;
    }
    if (!arg.startsWith('-')) return arg;
  }
  return undefined;
}

/** `version` is the installed package's, which `bin/animus.mjs` reads from
 *  its package.json and passes in. */
export async function main(
  argv: string[] = process.argv.slice(2),
  version?: string
): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: CLI_OPTIONS,
    });
  } catch (error) {
    const reason = String(readThrownMessage(error));
    reportUsageError(reason);
    // The arguments did not parse: `types` and `--json` are read from them.
    if (commandOf(argv) === 'types' && argv.includes('--json')) {
      printTypesAliasOutcome(EXIT_USAGE, [reason]);
    }
    return;
  }

  const { values, positionals } = parsed;
  const typesJson = positionals[0] === 'types' && values.json === true;
  if (values.version) {
    if (typesJson) printTypesAliasInfo('version', version ?? 'unknown');
    else console.log(version ?? 'unknown');
    process.exitCode = EXIT_OK;
    return;
  }
  if (values.help || positionals.length === 0) {
    console.error(USAGE);
    process.exitCode =
      positionals.length === 0 && !values.help ? EXIT_USAGE : EXIT_OK;
    if (typesJson) printTypesAliasInfo('help');
    return;
  }

  const command = positionals[0];
  // `css audit` and `types alias` read only their own flags, and the build
  // commands none of theirs: such a flag is a mistake, never silently
  // ignored.
  const subcommand = SUBCOMMANDS.get(command);
  const ownFlags = subcommand?.flags ?? BUILD_FLAGS;
  const foreign = Object.keys(values).filter((flag) => !ownFlags.has(flag));
  if (foreign.length > 0) {
    const reason = `--${foreign[0]} is not an option of '${subcommand?.label ?? command}'`;
    reportUsageError(reason);
    if (command === 'types' && values.json) {
      printTypesAliasOutcome(EXIT_USAGE, [reason]);
    }
    return;
  }
  if (command === 'css') {
    await runCssAuditCommand(positionals.slice(1), values);
    return;
  }
  if (command === 'types') {
    await runTypesAliasCommand(positionals.slice(1), values);
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
    conditions: values.condition,
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

/** The flags `css audit` reads; the build commands read none of the
 *  audit's own. */
const CSS_AUDIT_FLAGS = new Set([
  'root',
  'config',
  'out-dir',
  'manifest',
  'dist',
  'json',
]);
const TYPES_ALIAS_FLAGS = new Set([
  'out',
  'project',
  'probes',
  'anchor',
  'tsc',
  'json',
]);
/** The flags the build commands read. */
const BUILD_FLAGS = new Set([
  'system',
  'root',
  'config',
  'out-dir',
  'exclude',
  'condition',
  'mode',
  'targets',
  'strict',
  'verbose',
  'trace',
  'kit',
  'fail-on-degraded',
  'print-config',
  'help',
]);
const SUBCOMMANDS = new Map([
  ['css', { label: 'css audit', flags: CSS_AUDIT_FLAGS }],
  ['types', { label: 'types alias', flags: TYPES_ALIAS_FLAGS }],
]);

/** `animus css audit`: reads, measures and reports; it never writes the
 *  project, and exits 0 unless its input is unreadable. Its paths resolve
 *  as `animus build`'s do: the manifest is in the artifact directory. */
async function runCssAuditCommand(
  subcommand: string[],
  values: {
    root?: string;
    config?: string;
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
  try {
    const { root, outDir } = await locateProject(
      { root: values.root, config: values.config, outDir: values['out-dir'] },
      process.cwd()
    );
    const report = await runCssAudit({
      manifest: resolve(root, values.manifest ?? join(outDir, MANIFEST_FILE)),
      dist: resolve(root, values.dist ?? 'dist'),
      root,
    });
    if (values.json) console.log(JSON.stringify(report, null, 2));
    else process.stderr.write(formatCssAudit(report));
    process.exitCode = EXIT_OK;
  } catch (error) {
    console.error(`[animus] ${String(readThrownMessage(error) ?? error)}`);
    process.exitCode = exitCodeFor(error);
  }
}

/** What `types alias --json` reports of an exit: promoted, a refused
 *  usage, no TypeScript, or else a failed check or unreadable
 *  declarations. */
function typesAliasOutcome(exitCode: number): string {
  switch (exitCode) {
    case EXIT_OK:
      return 'promoted';
    case EXIT_USAGE:
      return 'refused';
    case EXIT_ENVIRONMENT:
      return 'no-typescript';
    default:
      return 'failed';
  }
}

/** The one JSON document `types alias --json` prints on stdout at an exit:
 *  its outcome, exit code and reasons, and on promotion the report. */
function printTypesAliasOutcome(
  exitCode: number,
  reasons: string[],
  report?: TypesAliasReport
): void {
  const outcome = typesAliasOutcome(exitCode);
  console.log(
    JSON.stringify({ outcome, exitCode, reasons, ...report }, null, 2)
  );
}

/** The document `types --json` prints for `--help` or `--version`. */
interface TypesAliasInfo {
  outcome: 'help' | 'version';
  exitCode: number;
  reasons: string[];
  version?: string;
}

/** `--help` or `--version` beside `types --json`: a document saying so, with
 *  the version, on stdout; the usage text stays on stderr. */
function printTypesAliasInfo(
  outcome: TypesAliasInfo['outcome'],
  version?: string
): void {
  const document: TypesAliasInfo = { outcome, exitCode: EXIT_OK, reasons: [] };
  if (version !== undefined) document.version = version;
  console.log(JSON.stringify(document, null, 2));
}

/** `animus types alias <declDir>`: paths resolve against the working
 *  directory, as a package build script passes them. With `--json`, every
 *  exit prints one JSON document on stdout: its outcome, exit code and
 *  reasons, the lines the text mode prints, and on promotion the report;
 *  the text still goes to stderr. */
async function runTypesAliasCommand(
  subcommand: string[],
  values: {
    out?: string;
    project?: string;
    probes?: string;
    anchor?: string[];
    tsc?: string;
    json?: boolean;
  }
): Promise<void> {
  const exit = (
    exitCode: number,
    reasons: string[],
    report?: TypesAliasReport
  ): void => {
    process.exitCode = exitCode;
    if (values.json) printTypesAliasOutcome(exitCode, reasons, report);
  };
  const refuse = (reason: string): void => {
    reportUsageError(reason);
    exit(EXIT_USAGE, [reason]);
  };
  if (subcommand[0] !== 'alias' || subcommand.length !== 2) {
    refuse(
      subcommand[0] === 'alias'
        ? "'types alias' takes one declaration directory"
        : "'types' needs a subcommand: alias <declDir>"
    );
    return;
  }
  if (values.out === undefined || values.probes === undefined) {
    refuse("'types alias' needs --out <dir> and --probes <dir>");
    return;
  }
  const cwd = process.cwd();
  const outDir = resolve(cwd, values.out);
  try {
    const report = await runTypesAlias({
      declDir: resolve(cwd, subcommand[1]),
      outDir,
      project: resolve(cwd, values.project ?? 'tsconfig.json'),
      probesDir: resolve(cwd, values.probes),
      anchors: values.anchor ?? [],
      tsc: values.tsc === undefined ? undefined : resolve(cwd, values.tsc),
    });
    if (!values.json) {
      process.stderr.write(formatTypesAliasReport(report, outDir));
    }
    exit(EXIT_OK, [], report);
  } catch (error) {
    const message = String(readThrownMessage(error) ?? error);
    console.error(`[animus] ${message}`);
    const reasons = message.split('\n');
    if (!(error instanceof PromotionIncompleteError)) {
      console.error(`[animus] ${outDir} was not changed.`);
      reasons.push(`${outDir} was not changed.`);
    }
    exit(exitCodeFor(error), reasons);
  }
}
