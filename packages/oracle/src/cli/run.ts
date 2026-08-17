/**
 * `animus-oracle` — the six operations as a command line.
 *
 * Stream discipline (the animus CLI's design D5, kept identical here): stdout
 * carries machine output ONLY — the `--json` envelope — and every
 * human-readable line goes to stderr. The exit code is the verdict, not a
 * success flag: 0 for a settled answer, 1 for DISPROVED, 4 for an answer that
 * completed without settling (CONDITIONAL / INCONCLUSIVE / OUTSIDE_MODEL). A
 * supervisor can therefore branch on the oracle's epistemic state without
 * parsing anything.
 *
 * `runCli` takes its streams as arguments so the whole surface is testable in
 * process: no subprocess, no global capture, no `process.exit`.
 */

import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { originEdge } from '../core/fact';
import { asRuleId } from '../core/identity';
import { SYMPTOM_KINDS } from '../engines/explain';
import { createOracle } from '../engines/oracle';
import { createAnimusHost } from '../host/animus/host';
import { loadAnimusArtifacts } from '../host/animus/loader';
import { checkSnapshot } from '../places/check';
import { loadSnapshot } from '../places/snapshot';
import {
  parseAssertion,
  parseForce,
  parsePoint,
  parsePositiveInteger,
  parsePropertyReplacement,
  parseRuleRemoval,
  parseTokenReplacement,
  UsageError,
} from './args';
import { renderJson } from './json';
import { renderEquivalence, renderProbe } from './render';
import { runSession } from './session';
import { USAGE } from './usage';

import type { RuleId } from '../core/identity';
import type { ProbeResult, ProbeVerdict } from '../core/probe';
import type { ScenarioPoint } from '../core/scenario';
import type { WorldDelta } from '../core/world';
import type { OracleSymptom } from '../engines/explain';
import type { Oracle } from '../engines/oracle';
import type { AnimusHost } from '../host/animus/host';
import type { SnapshotOptions } from '../places/snapshot';
import type { TargetResolution } from '../providers/identity';
import type { RenderContext } from './render';

/**
 * A sink the CLI writes text to. `void` is the whole contract — nothing here
 * reads what a write returned — and it is the spelling `SessionStreams` already
 * uses for the same three streams, so a real `process.stdout` (which returns a
 * backpressure flag) and a capturing test double satisfy one type.
 */
export interface CliStream {
  write(text: string): void;
}

export interface CliStreams {
  stdout: CliStream;
  stderr: CliStream;
  /** Required only by `session`, which reads JSONL requests from it. */
  stdin?: AsyncIterable<string | Uint8Array>;
}

export const EXIT_OK = 0;
export const EXIT_DISPROVED = 1;
export const EXIT_USAGE = 2;
export const EXIT_ENVIRONMENT = 3;
export const EXIT_UNSETTLED = 4;

export const DEFAULT_ARTIFACT_DIR = '.animus';

const COMMANDS = [
  'inspect',
  'explain',
  'simulate',
  'diff',
  'prove',
  'refine',
  'classes',
  'check',
  'session',
];

/**
 * The verdict *is* the exit status (DESIGN §5). FIXPOINT joins the settled
 * codes deliberately: repeating a question is not an error, it is the answer
 * "you already know this", and a supervisor loop should treat it as a reason
 * to change the question rather than to fail.
 */
export const exitCodeForVerdict = (verdict: ProbeVerdict): number => {
  switch (verdict) {
    case 'PROVED':
    case 'ESTABLISHED':
    case 'FIXPOINT':
      return EXIT_OK;
    case 'DISPROVED':
      return EXIT_DISPROVED;
    default:
      return EXIT_UNSETTLED;
  }
};

/**
 * The error taxonomy. A malformed request (ours or an engine's `TypeError`
 * over a bad request) is the caller's to fix; anything else — a missing
 * artifact directory, an unreadable manifest, an unmodeled construct the
 * adapter refuses — is the environment's, and is deliberately *not* reported
 * as a verdict. Universally quantified over what was thrown for the same
 * reason `failureLine` below is — a `catch` binding is — and decided by real
 * `instanceof` guards rather than by anything assumed about the value.
 */
export const exitCodeForError = <Thrown>(thrown: Thrown): number =>
  thrown instanceof UsageError || thrown instanceof TypeError
    ? EXIT_USAGE
    : EXIT_ENVIRONMENT;

const parse = (argv: readonly string[]) =>
  parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      dir: { type: 'string' },
      'source-root': { type: 'string' },
      json: { type: 'boolean' },
      help: { type: 'boolean' },
      target: { type: 'string' },
      at: { type: 'string' },
      symptom: { type: 'string' },
      property: { type: 'string' },
      expected: { type: 'string' },
      assert: { type: 'string', multiple: true },
      'max-cells': { type: 'string' },
      obligation: { type: 'string' },
      remove: { type: 'string', multiple: true },
      replace: { type: 'string', multiple: true },
      'remove-rule': { type: 'string', multiple: true },
      'replace-token': { type: 'string', multiple: true },
      force: { type: 'string', multiple: true },
    },
  });

type CliValues = ReturnType<typeof parse>['values'];

const requiredFlag = (
  value: string | undefined,
  flag: string,
  command: string
): string => {
  if (value === undefined || value.length === 0) {
    throw new UsageError(`${command}: ${flag} is required`);
  }
  return value;
};

const resolveTarget = (
  host: AnimusHost,
  selector: string
): TargetResolution => {
  const resolution = host.identity.resolveTarget(selector);
  if (resolution !== undefined) return resolution;
  throw new UsageError(
    `unknown target '${selector}' — known components: ${host.identity
      .components()
      .map((component) => component.id)
      .sort()
      .join(', ')}`
  );
};

/**
 * The classes are reported only when a point pins them: a domain-scoped
 * question (`prove`, `diff`) has no single class list, and printing the
 * unconstrained one would read like the answer's scope.
 */
const contextFor = (
  command: string,
  resolution: TargetResolution,
  point: ScenarioPoint | undefined
): RenderContext => ({
  command,
  target: String(resolution.target),
  binding: resolution.component.binding,
  classes: point === undefined ? undefined : resolution.classes(point),
  point,
});

/**
 * `--remove padding` means "remove whatever wins padding here", which is a
 * question before it is an intervention: the winner is read off a baseline
 * `inspect` at the same point, and the result is cached so several delta flags
 * cost one probe. A property nothing sets is a usage error listing what *is*
 * set — never a delta against a rule that does not declare it.
 */
const winnerResolver = (
  oracle: Oracle,
  target: string,
  point: ScenarioPoint | undefined
): ((property: string, flag: string) => RuleId) => {
  let baseline: ProbeResult | undefined;

  return (property, flag) => {
    baseline ??= oracle.inspect({ target, at: point });
    const fact = baseline.facts.find(
      (candidate) => candidate.property === property
    );
    if (fact === undefined) {
      throw new UsageError(
        `${flag} '${property}': nothing sets it on ${target} at this point ` +
          `— properties with a winner here: ${baseline.facts
            .map((candidate) => candidate.property)
            .join(', ')}`
      );
    }
    const origin = originEdge(fact);
    if (origin === undefined) {
      throw new UsageError(
        `${flag} '${property}': the winning fact names no origin rule — use ` +
          '--remove-rule <ruleId>:<property> instead'
      );
    }
    return asRuleId(origin.ref);
  };
};

const buildDeltas = (
  values: CliValues,
  winner: (property: string, flag: string) => RuleId
): readonly WorldDelta[] => {
  const deltas: WorldDelta[] = [];

  for (const spec of values.remove ?? []) {
    const property = spec.trim();
    if (property.length === 0) {
      throw new UsageError('--remove: expected a property name');
    }
    deltas.push({
      kind: 'remove-declaration',
      rule: winner(property, '--remove'),
      property,
    });
  }

  for (const spec of values.replace ?? []) {
    const replacement = parsePropertyReplacement(spec);
    deltas.push({
      kind: 'replace-declaration',
      rule: winner(replacement.property, '--replace'),
      property: replacement.property,
      value: replacement.value,
    });
  }

  for (const spec of values['remove-rule'] ?? []) {
    deltas.push(parseRuleRemoval(spec));
  }
  for (const spec of values['replace-token'] ?? []) {
    deltas.push(parseTokenReplacement(spec));
  }
  for (const spec of values.force ?? []) deltas.push(parseForce(spec));

  return deltas;
};

const symptomFor = (
  kind: string,
  property: string,
  expected?: string
): OracleSymptom => {
  if (kind === 'unexpected-value') {
    return { kind, detail: { property, expected } };
  }
  if (kind === 'missing-declaration') {
    return { kind, detail: { property } };
  }
  throw new UsageError(
    `explain: unknown --symptom '${kind}' — supported: ` +
      SYMPTOM_KINDS.join(', ')
  );
};

const emitProbe = (
  io: CliStreams,
  values: CliValues,
  context: RenderContext,
  result: ProbeResult
): number => {
  if (values.json === true) {
    io.stdout.write(
      renderJson({
        command: context.command,
        target: context.target,
        at: context.point,
        result,
      })
    );
  } else {
    io.stderr.write(renderProbe(result, context));
  }
  return exitCodeForVerdict(result.verdict);
};

/** `check` — the correspondence guard as a CI gate (PLACES.md §6). */
const executeCheck = (
  dir: string,
  values: CliValues,
  io: CliStreams
): number => {
  const sourceRoot = values['source-root'];
  const options: SnapshotOptions = {};
  if (sourceRoot !== undefined) {
    options.sourceRoot = resolve(process.cwd(), sourceRoot);
  }
  const snapshot = loadSnapshot(dir, options);
  const report = checkSnapshot(snapshot);

  if (values.json === true) {
    io.stdout.write(renderJson({ command: 'check', result: report }));
  } else {
    const failing = report.files.filter((entry) => !entry.ok);
    io.stderr.write(
      `[animus-oracle] check: ${report.files.length} file(s) against ` +
        `generation ${report.generation ?? report.programHash}\n`
    );
    for (const entry of failing) {
      io.stderr.write(`  ${entry.file}: ${entry.reason} — ${entry.detail}\n`);
      for (const divergence of entry.divergences ?? []) {
        io.stderr.write(`    ${divergence}\n`);
      }
    }
    io.stderr.write(
      failing.length === 0
        ? '  every file still corresponds to this generation\n'
        : `  ${failing.length} file(s) no longer correspond\n`
    );
  }
  return report.ok ? EXIT_OK : EXIT_DISPROVED;
};

const execute = async (
  command: string,
  values: CliValues,
  io: CliStreams
): Promise<number> => {
  const dir = resolve(process.cwd(), values.dir ?? DEFAULT_ARTIFACT_DIR);

  if (command === 'check') return executeCheck(dir, values, io);
  if (command === 'session') {
    if (io.stdin === undefined) {
      throw new UsageError('session: stdin is required for the JSONL loop');
    }
    const sourceRoot = values['source-root'];
    return runSession(
      dir,
      sourceRoot === undefined
        ? {}
        : { sourceRoot: resolve(process.cwd(), sourceRoot) },
      { stdin: io.stdin, stdout: io.stdout, stderr: io.stderr }
    );
  }

  const host = createAnimusHost(loadAnimusArtifacts(dir));
  const oracle = createOracle(host);
  const point =
    values.at === undefined
      ? undefined
      : parsePoint(values.at, host.scenarios.namedScenarios());

  if (command === 'refine') {
    const obligation = requiredFlag(values.obligation, '--obligation', command);
    return emitProbe(io, values, { command }, oracle.refine({ obligation }));
  }

  const target = requiredFlag(values.target, '--target', command);
  const resolution = resolveTarget(host, target);
  const context = contextFor(command, resolution, point);

  switch (command) {
    case 'inspect':
      return emitProbe(
        io,
        values,
        context,
        oracle.inspect({ target, at: point })
      );

    case 'explain': {
      const symptom = symptomFor(
        requiredFlag(values.symptom, '--symptom', command),
        requiredFlag(values.property, '--property', command),
        values.expected
      );
      return emitProbe(
        io,
        values,
        context,
        oracle.explain({ target, at: point, symptom })
      );
    }

    case 'simulate': {
      const deltas = buildDeltas(values, winnerResolver(oracle, target, point));
      if (deltas.length === 0) {
        throw new UsageError(
          'simulate: at least one delta is required — a hypothetical world ' +
            'with no interventions is the baseline, and reporting "no change" ' +
            'would look like a test that ran'
        );
      }
      return emitProbe(
        io,
        values,
        context,
        oracle.simulate({ target, at: point, deltas })
      );
    }

    case 'diff': {
      const deltas = buildDeltas(values, winnerResolver(oracle, target, point));
      if (deltas.length === 0) {
        throw new UsageError(
          'diff: at least one delta is required — the candidate world is ' +
            'built from them'
        );
      }
      return emitProbe(
        io,
        values,
        context,
        oracle.diff({ target, candidate: { deltas } })
      );
    }

    case 'prove': {
      const specs = values.assert ?? [];
      if (specs.length === 0) {
        throw new UsageError(
          'prove: at least one --assert is required — an empty invariant set ' +
            'would report PROVED while checking nothing'
        );
      }
      const maxCells = values['max-cells'];
      return emitProbe(
        io,
        values,
        context,
        oracle.prove({
          assertions: specs.map((spec) => parseAssertion(spec, target)),
          budget:
            maxCells === undefined
              ? undefined
              : { maxCells: parsePositiveInteger(maxCells, '--max-cells') },
        })
      );
    }

    case 'classes': {
      // The one command whose answer is not a `ProbeResult`: a partition of
      // the domain, so there is no verdict to map and the exit is always 0.
      const equivalence = oracle.equivalenceClasses({ target });
      if (values.json === true) {
        io.stdout.write(
          renderJson({
            command,
            target: context.target,
            at: context.point,
            result: equivalence,
          })
        );
      } else {
        io.stderr.write(renderEquivalence(equivalence, context));
      }
      return EXIT_OK;
    }

    default:
      throw new UsageError(
        `command '${command}' is listed but not implemented — this is a bug`
      );
  }
};

/**
 * The one line a failure prints. Universally quantified over what was thrown
 * because a `catch` binding is: `parseArgs` and every oracle layer reject with
 * an `Error` subclass (`UsageError`, `TypeError`, `AnimusAdapterError`), whose
 * message is the failure; anything else describes itself rather than printing
 * the `undefined` an absent `.message` would render.
 */
const failureLine = <Thrown>(thrown: Thrown): string =>
  thrown instanceof Error ? thrown.message : String(thrown);

export const runCli = async (
  argv: string[],
  io: CliStreams
): Promise<number> => {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    io.stderr.write(`[animus-oracle] ${failureLine(error)}\n`);
    io.stderr.write(USAGE);
    return EXIT_USAGE;
  }

  const { values, positionals } = parsed;
  if (values.help === true) {
    io.stderr.write(USAGE);
    return EXIT_OK;
  }
  if (positionals.length === 0) {
    io.stderr.write('[animus-oracle] no command given\n');
    io.stderr.write(USAGE);
    return EXIT_USAGE;
  }

  const command = positionals[0];
  if (!COMMANDS.includes(command)) {
    io.stderr.write(
      `[animus-oracle] unknown command '${command}' — supported: ` +
        `${COMMANDS.join(', ')}\n`
    );
    io.stderr.write(USAGE);
    return EXIT_USAGE;
  }

  try {
    return await execute(command, values, io);
  } catch (error) {
    io.stderr.write(`[animus-oracle] ${failureLine(error)}\n`);
    const code = exitCodeForError(error);
    if (code === EXIT_USAGE) {
      io.stderr.write(
        '[animus-oracle] run `animus-oracle --help` for the full grammar\n'
      );
    }
    return code;
  }
};
