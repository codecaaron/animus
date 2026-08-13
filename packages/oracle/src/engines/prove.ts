/**
 * `prove` — does this invariant hold across a declared domain.
 *
 * Quantification is exhaustive over the *cells* of the scenario domain, which
 * is a proof rather than a sample only under the cell invariant of
 * `core/scenario`: every threshold a candidate rule tests has to be a cut, so
 * the thresholds are harvested out of the rules themselves before enumeration
 * (`harvestCuts`).
 *
 * Three refusals are deliberate (DESIGN §8):
 * - past the cell budget the answer is INCONCLUSIVE with the count, never a
 *   subset check reported as a proof;
 * - an invariant that holds while an obligation or an unbound guard touches the
 *   property is CONDITIONAL, never PROVED;
 * - a violation is reported with a minimized witness — the failing cell with
 *   the fewest non-default coordinates — and the boundary it sits against.
 */

import { canonicalJson } from '../core/identity';
import { TRUE } from '../core/predicate';
import { describeValue, exact } from '../core/value';
import {
  analyzeCascade,
  pointGuard,
  resolveDeclarationValue,
  styleTargetSubject,
  subjectsForProperty,
} from './cascade';
import {
  cellCount,
  cellsOf,
  harvestCuts,
  pinDomain,
  scopedDomain,
} from './cells';
import { describeCell, describePoint, listOf, plural } from './format';
import { dedupeOperations, dischargeOperations } from './result';

import type { RenderFact, RenderSubject } from '../core/fact';
import type { UnknownObligation } from '../core/obligation';
import type {
  CounterexampleWitness,
  ProbeBudget,
  ProbeResult,
  ProbeVerdict,
  SuggestedOperation,
} from '../core/probe';
import type {
  ScenarioCell,
  ScenarioDomain,
  ScenarioPoint,
} from '../core/scenario';
import type { AbstractValue } from '../core/value';
import type { RenderWorld } from '../core/world';
import type { TargetResolution } from '../providers/identity';
import type {
  CascadeAnalysis,
  CascadeContext,
  DeclarationCandidate,
} from './cascade';
import type { OracleRuntime } from './runtime';

export type OracleAssertion =
  | {
      kind: 'effective-value';
      target: string;
      property: string;
      expected: string;
    }
  | {
      kind: 'effective-value-in';
      target: string;
      property: string;
      allowed: readonly string[];
    }
  | {
      kind: 'winner-origin-token';
      target: string;
      property: string;
      token: string;
    }
  | { kind: 'mode-invariant'; target: string; property: string }
  | { kind: 'no-important'; target: string };

export interface ProveRequest {
  assertions: readonly OracleAssertion[];
  domain?: ScenarioDomain;
  world?: RenderWorld;
  budget?: ProbeBudget;
}

const ASSERTION_KINDS = [
  'effective-value',
  'effective-value-in',
  'winner-origin-token',
  'mode-invariant',
  'no-important',
];

const MODE = 'mode';

const validate = (assertion: OracleAssertion): void => {
  if (!ASSERTION_KINDS.includes(assertion.kind)) {
    throw new TypeError(
      `prove: unknown assertion kind '${String(
        assertion.kind
      )}' — supported: ${ASSERTION_KINDS.join(', ')}`
    );
  }
  if (typeof assertion.target !== 'string' || assertion.target.length === 0) {
    throw new TypeError(
      `prove: assertion '${assertion.kind}' requires a target selector`
    );
  }
  if (assertion.kind !== 'no-important') {
    if (
      typeof assertion.property !== 'string' ||
      assertion.property.length === 0
    ) {
      throw new TypeError(
        `prove: assertion '${assertion.kind}' requires a property name`
      );
    }
  }
  if (
    assertion.kind === 'effective-value' &&
    typeof assertion.expected !== 'string'
  ) {
    throw new TypeError(
      "prove: assertion 'effective-value' requires expected (a string)"
    );
  }
  if (assertion.kind === 'effective-value-in') {
    if (
      !Array.isArray(assertion.allowed) ||
      assertion.allowed.length === 0 ||
      assertion.allowed.some((value) => typeof value !== 'string')
    ) {
      throw new TypeError(
        "prove: assertion 'effective-value-in' requires a non-empty allowed " +
          'array of strings'
      );
    }
  }
  if (
    assertion.kind === 'winner-origin-token' &&
    (typeof assertion.token !== 'string' || !assertion.token.startsWith('--'))
  ) {
    throw new TypeError(
      "prove: assertion 'winner-origin-token' requires a custom-property " +
        "name such as '--color-text'"
    );
  }
};

const propertyOf = (assertion: OracleAssertion): string | undefined =>
  assertion.kind === 'no-important' ? undefined : assertion.property;

export const assertionLabel = (assertion: OracleAssertion): string => {
  const property = propertyOf(assertion);
  return `assertion:${assertion.kind}${
    property === undefined ? '' : `:${property}`
  }`;
};

interface EffectiveValue {
  declaration: DeclarationCandidate;
  value: string;
  /** The lattice kind behind `value` — `unknown` values decide nothing. */
  kind: AbstractValue<unknown>['kind'];
  tokens: readonly string[];
  raised: readonly UnknownObligation[];
  assumptions: readonly string[];
}

const effectiveAt = (
  ctx: CascadeContext,
  analysis: CascadeAnalysis,
  property: string
): EffectiveValue | undefined => {
  const declaration =
    analysis.outcomes.get(property)?.winner ??
    analysis.inherited.get(property)?.declaration;
  if (declaration === undefined) return undefined;

  const resolved = resolveDeclarationValue(ctx, analysis.point, declaration);
  return {
    declaration,
    value: describeValue(resolved.value),
    kind: resolved.value.kind,
    tokens: resolved.tokenChains.flat(),
    raised: resolved.raised,
    assumptions: resolved.assumptions,
  };
};

interface Failure {
  cell: ScenarioCell;
  violation: string;
}

interface Evaluation {
  assertion: OracleAssertion;
  cells: number;
  evaluated: number;
  failures: readonly Failure[];
  passing: readonly ScenarioCell[];
  /** Cells whose effective value the model could not decide either way. */
  undecided: number;
  exceeded?: { count: number; limit: number };
  /** Set when the evaluation checked nothing — PROVED would be a lie. */
  vacuous?: string;
  concerns: readonly string[];
  unknowns: readonly UnknownObligation[];
  assumptions: readonly string[];
  subjects: readonly RenderSubject[];
  domain: ScenarioDomain;
  cuts: Readonly<Record<string, readonly number[]>>;
  discovered: readonly string[];
  winner?: DeclarationCandidate;
  resolution: TargetResolution;
}

const importantAt = (analysis: CascadeAnalysis): string | undefined => {
  for (const candidate of analysis.candidates) {
    if (!candidate.active) continue;
    for (const declaration of candidate.rule.declarations) {
      if (declaration.important === true) {
        return (
          `${candidate.rule.id} declares ${declaration.property}: ` +
          `${declaration.value} !important`
        );
      }
    }
  }
  return undefined;
};

const checkCell = (
  ctx: CascadeContext,
  assertion: OracleAssertion,
  analysis: CascadeAnalysis
): { violation?: string; effective?: EffectiveValue; undecided?: boolean } => {
  if (assertion.kind === 'no-important') {
    const found = importantAt(analysis);
    return found === undefined ? {} : { violation: found };
  }

  const effective = effectiveAt(ctx, analysis, assertion.property);
  if (effective === undefined) {
    return {
      violation:
        `nothing sets ${assertion.property} here — the invariant has no ` +
        'effective value to check',
    };
  }

  // An `unknown` value decides nothing: comparing its rendered form would
  // report the obligation id as a counterexample the model never established.
  // The cell is undecided; the raised obligation keeps the verdict honest.
  const undecidable =
    effective.kind === 'unknown' &&
    (assertion.kind === 'effective-value' ||
      assertion.kind === 'effective-value-in');
  if (undecidable) return { effective, undecided: true };

  switch (assertion.kind) {
    case 'effective-value':
      return effective.value === assertion.expected
        ? { effective }
        : {
            effective,
            violation:
              `${assertion.property} = '${effective.value}' (expected ` +
              `'${assertion.expected}') from ` +
              `${effective.declaration.candidate.rule.id}`,
          };
    case 'effective-value-in':
      return assertion.allowed.includes(effective.value)
        ? { effective }
        : {
            effective,
            violation:
              `${assertion.property} = '${effective.value}', outside the ` +
              `allowed set {${assertion.allowed.join(', ')}}`,
          };
    case 'winner-origin-token':
      return effective.tokens.includes(assertion.token)
        ? { effective }
        : {
            effective,
            violation:
              `${assertion.property} = '${effective.value}' does not resolve ` +
              `through ${assertion.token}` +
              (effective.tokens.length === 0
                ? ' (it references no token at all)'
                : ` (it resolves through ${listOf(effective.tokens)})`),
          };
    case 'mode-invariant':
      // Decided across cells, not within one — see `checkModeInvariance`.
      return { effective };
  }
};

/**
 * Mode-invariance is a relation between cells, so it is checked per
 * configuration of the *other* axes: within each group the resolved values must
 * agree, and any cell disagreeing with its group's first value is the witness.
 */
/** One cell's effective value, as observed by the main evaluation loop. */
interface CellObservation {
  cell: ScenarioCell;
  effective?: EffectiveValue;
}

const checkModeInvariance = (
  observations: readonly CellObservation[],
  property: string
): { failures: readonly Failure[]; undecided: number } => {
  const groups = new Map<
    string,
    { cell: ScenarioCell; value: string; decided: boolean; mode: string }[]
  >();

  for (const { cell, effective } of observations) {
    const rest: Record<string, unknown> = { ...cell.point };
    delete rest[MODE];
    const key = canonicalJson(rest);

    const bucket = groups.get(key) ?? [];
    bucket.push({
      cell,
      value: effective?.value ?? '(unset)',
      // Two unknowns render to the same obligation string, which would read
      // as agreement between values the model never resolved.
      decided: effective === undefined || effective.kind !== 'unknown',
      mode: String(cell.point[MODE]),
    });
    groups.set(key, bucket);
  }

  const failures: Failure[] = [];
  let undecided = 0;
  for (const bucket of groups.values()) {
    const decided = bucket.filter((entry) => entry.decided);
    undecided += bucket.length - decided.length;
    const first = decided[0];
    if (first === undefined) continue;
    for (const entry of decided.slice(1)) {
      if (entry.value === first.value) continue;
      failures.push({
        cell: entry.cell,
        violation:
          `${property} = '${entry.value}' under ${MODE} = ${entry.mode} but ` +
          `'${first.value}' under ${MODE} = ${first.mode}`,
      });
    }
  }
  return { failures, undecided };
};

const witnessScore = (
  domain: ScenarioDomain,
  point: ScenarioPoint
): readonly number[] => {
  let nonDefault = 0;
  let numeric = 0;
  for (const dim of Object.keys(domain).sort()) {
    const declared = domain[dim];
    const value = point[dim];
    if (declared.kind === 'finite') {
      if (declared.values.length > 0 && value !== declared.values[0]) {
        nonDefault += 1;
      }
    } else if (typeof value === 'number') {
      numeric += value;
    }
  }
  return [nonDefault, numeric];
};

/** Fewest non-default finite coordinates, then the smallest viewport. */
const minimize = (
  domain: ScenarioDomain,
  failures: readonly Failure[]
): Failure | undefined => {
  let best: Failure | undefined;
  let bestScore: readonly number[] | undefined;
  for (const failure of failures) {
    const score = witnessScore(domain, failure.cell.point);
    const better =
      bestScore === undefined ||
      score[0] < bestScore[0] ||
      (score[0] === bestScore[0] && score[1] < bestScore[1]);
    if (better) {
      best = failure;
      bestScore = score;
    }
  }
  return best;
};

/**
 * Name the cut a counterexample sits against, when a passing cell differs from
 * it in exactly one interval coordinate. "It fails at 1024 but passes below
 * 768" is a repair-shaped fact; "it fails somewhere" is not.
 */
const boundaryNote = (
  domain: ScenarioDomain,
  cuts: Readonly<Record<string, readonly number[]>>,
  failing: ScenarioPoint,
  passing: readonly ScenarioCell[]
): string | undefined => {
  for (const dim of Object.keys(domain).sort()) {
    if (domain[dim].kind !== 'interval') continue;
    const failingValue = failing[dim];
    if (typeof failingValue !== 'number') continue;

    const thresholds = [...(cuts[dim] ?? [])].sort((a, b) => a - b);
    for (const cell of passing) {
      const passingValue = cell.point[dim];
      if (typeof passingValue !== 'number') continue;
      const differsElsewhere = Object.keys(failing).some(
        (other) => other !== dim && failing[other] !== cell.point[other]
      );
      if (differsElsewhere) continue;

      if (passingValue < failingValue) {
        const cut = thresholds.find(
          (value) => value > passingValue && value <= failingValue
        );
        if (cut !== undefined) return `passes for ${dim} < ${cut}`;
      } else if (passingValue > failingValue) {
        const cut = thresholds.find(
          (value) => value > failingValue && value <= passingValue
        );
        if (cut !== undefined) return `passes for ${dim} ≥ ${cut}`;
      }
    }
  }
  return undefined;
};

const evaluateAssertion = (
  rt: OracleRuntime,
  world: RenderWorld,
  override: ScenarioDomain | undefined,
  budget: ProbeBudget,
  assertion: OracleAssertion
): Evaluation => {
  const ctx = rt.contextFor(world);
  const resolution = rt.resolveTarget(assertion.target);
  const domain = scopedDomain(resolution, world, override);
  const limit = rt.maxCells(budget);
  const harvested = harvestCuts(
    ctx,
    resolution,
    domain,
    rt.host.scenarios.cuts(),
    limit
  );
  const total = cellCount(domain, harvested.cuts);
  const property = propertyOf(assertion);

  const unevaluated: Evaluation = {
    assertion,
    domain,
    cuts: harvested.cuts,
    discovered: harvested.discovered,
    resolution,
    cells: total,
    evaluated: 0,
    failures: [],
    passing: [],
    undecided: 0,
    concerns: [],
    unknowns: [],
    assumptions: [],
    subjects: [],
  };

  if (total > limit || harvested.truncated) {
    return { ...unevaluated, exceeded: { count: total, limit } };
  }

  const cells = cellsOf(domain, harvested.cuts);

  // Zero cells means zero checks: every universally quantified claim would
  // hold vacuously, so the evaluation refuses to stand in for a proof.
  if (cells.length === 0) {
    return {
      ...unevaluated,
      vacuous: 'the scoped domain contains no cells — nothing was evaluated',
    };
  }

  const failures: Failure[] = [];
  const passing: ScenarioCell[] = [];
  const raised: UnknownObligation[] = [];
  const assumptions = new Set<string>();
  const subjects: RenderSubject[] = [styleTargetSubject(resolution.target)];
  const seenSubjects = new Set<string>();
  const concerns = new Set<string>();
  let winner: DeclarationCandidate | undefined;
  let undecided = 0;
  let vacuous: string | undefined;
  const observations: CellObservation[] = [];

  for (const cell of cells) {
    const analysis = analyzeCascade(ctx, resolution, cell.point);
    for (const assumption of analysis.assumptions) assumptions.add(assumption);

    if (property !== undefined) {
      for (const subject of subjectsForProperty(analysis, property)) {
        const key = canonicalJson(subject);
        if (seenSubjects.has(key)) continue;
        seenSubjects.add(key);
        subjects.push(subject);
      }
      for (const candidate of analysis.candidates) {
        const declares = candidate.rule.declarations.some(
          (declaration) => declaration.property === property
        );
        if (declares && candidate.unboundInWorld.length > 0) {
          concerns.add(
            `${candidate.rule.id} declares ${property} under ` +
              `${listOf(candidate.unboundInWorld)}, which this world does ` +
              'not declare — the invariant is untested under that axis'
          );
        }
      }
    } else {
      // Only `no-important` has no property. With nothing to scope by, every
      // important declaration matters: one guarded by an axis this world
      // never declared is inactive in every swept cell, and only a concern
      // keeps that from reading as PROVED.
      for (const candidate of analysis.candidates) {
        if (candidate.active || candidate.unboundInWorld.length === 0) {
          continue;
        }
        for (const declaration of candidate.rule.declarations) {
          if (declaration.important !== true) continue;
          concerns.add(
            `${candidate.rule.id} declares ${declaration.property}: ` +
              `${declaration.value} !important under ` +
              `${listOf(candidate.unboundInWorld)}, which this world does ` +
              'not declare — the invariant is untested under that axis'
          );
        }
      }
    }

    const checked = checkCell(ctx, assertion, analysis);
    if (checked.effective !== undefined) {
      raised.push(...checked.effective.raised);
      for (const assumption of checked.effective.assumptions) {
        assumptions.add(assumption);
      }
      winner = winner ?? checked.effective.declaration;
    }
    observations.push({ cell, effective: checked.effective });
    if (checked.undecided === true) undecided += 1;
    else if (checked.violation === undefined) passing.push(cell);
    else failures.push({ cell, violation: checked.violation });
  }

  if (assertion.kind === 'mode-invariant') {
    if (domain[MODE] === undefined) {
      vacuous =
        `${MODE} is not a declared axis of this domain — mode-invariance ` +
        'holds vacuously and proves nothing about color modes';
      assumptions.add(vacuous);
    } else {
      const invariance = checkModeInvariance(observations, assertion.property);
      failures.push(...invariance.failures);
      undecided += invariance.undecided;
    }
  }

  return {
    ...unevaluated,
    evaluated: cells.length,
    failures,
    passing,
    undecided,
    ...(vacuous === undefined ? {} : { vacuous }),
    concerns: Array.from(concerns),
    unknowns: rt.unknownsFor(subjects, raised),
    assumptions: Array.from(assumptions),
    subjects,
    ...(winner === undefined ? {} : { winner }),
  };
};

const verdictOf = (evaluations: readonly Evaluation[]): ProbeVerdict => {
  if (evaluations.some((evaluation) => evaluation.exceeded !== undefined)) {
    return 'INCONCLUSIVE';
  }
  // A real counterexample outranks another assertion's vacuity: DISPROVED is
  // sound on one witness, while PROVED would need every check to be real.
  if (evaluations.some((evaluation) => evaluation.failures.length > 0)) {
    return 'DISPROVED';
  }
  if (evaluations.some((evaluation) => evaluation.vacuous !== undefined)) {
    return 'INCONCLUSIVE';
  }
  const conditional = evaluations.some(
    (evaluation) =>
      evaluation.unknowns.length > 0 ||
      evaluation.concerns.length > 0 ||
      evaluation.undecided > 0
  );
  return conditional ? 'CONDITIONAL' : 'PROVED';
};

const witnessesOf = (
  evaluations: readonly Evaluation[]
): readonly CounterexampleWitness[] => {
  const witnesses: CounterexampleWitness[] = [];
  for (const evaluation of evaluations) {
    const failure = minimize(evaluation.domain, evaluation.failures);
    if (failure === undefined) continue;

    const boundary = boundaryNote(
      evaluation.domain,
      evaluation.cuts,
      failure.cell.point,
      evaluation.passing
    );
    witnesses.push({
      point: failure.cell.point,
      violation: `${assertionLabel(evaluation.assertion)}: ${
        failure.violation
      } at ${describeCell(failure.cell)}`,
      ...(boundary === undefined ? {} : { boundary }),
    });
  }
  return witnesses;
};

const summarize = (
  evaluations: readonly Evaluation[],
  verdict: ProbeVerdict
): string => {
  const totalCells = evaluations.reduce(
    (sum, evaluation) => sum + evaluation.evaluated,
    0
  );
  const failing = evaluations.reduce(
    (sum, evaluation) => sum + evaluation.failures.length,
    0
  );
  const discovered = Array.from(
    new Set(evaluations.flatMap((evaluation) => evaluation.discovered))
  );

  const head =
    `Checked ${plural(evaluations.length, 'assertion')} over ` +
    `${plural(totalCells, 'scenario cell')}` +
    (discovered.length === 0
      ? '.'
      : ` (cuts harvested from rule guards: ${listOf(discovered)}).`);

  switch (verdict) {
    case 'PROVED':
      return (
        `${head} PROVED under this program revision, scenario domain, ` +
        'environment profile and model version — not beyond them.'
      );
    case 'DISPROVED':
      return (
        `${head} DISPROVED: ${plural(failing, 'cell')} violate the ` +
        `assertions — ${listOf(
          evaluations
            .filter((evaluation) => evaluation.failures.length > 0)
            .map(
              (evaluation) =>
                `${assertionLabel(evaluation.assertion)} fails in ` +
                `${evaluation.failures.length} of ${evaluation.evaluated}`
            )
        )}.`
      );
    case 'CONDITIONAL': {
      const undecidedTotal = evaluations.reduce(
        (sum, evaluation) => sum + evaluation.undecided,
        0
      );
      return (
        `${head} ${
          undecidedTotal === 0
            ? 'The assertions hold in every evaluated cell'
            : `The assertions hold in every decided cell ` +
              `(${plural(undecidedTotal, 'cell')} undecided)`
        }, but unresolved ` +
        `obligations touch them: ${listOf(
          evaluations.flatMap((evaluation) => [
            ...evaluation.unknowns.map(
              (unknown) => `${unknown.id} (${unknown.effectClass})`
            ),
            ...evaluation.concerns,
          ])
        )}. CONDITIONAL, not PROVED.`
      );
    }
    default: {
      const reasons = evaluations.flatMap((evaluation) => [
        ...(evaluation.exceeded === undefined
          ? []
          : [
              `${assertionLabel(evaluation.assertion)} spans ` +
                `${evaluation.exceeded.count} cells, over the budget ` +
                `of ${evaluation.exceeded.limit}`,
            ]),
        ...(evaluation.vacuous === undefined
          ? []
          : [`${assertionLabel(evaluation.assertion)}: ${evaluation.vacuous}`]),
      ]);
      const guidance = evaluations.some(
        (evaluation) => evaluation.exceeded !== undefined
      )
        ? ' — narrow the domain or raise the budget rather than trusting a ' +
          'partial check.'
        : ' — nothing was actually checked, so no verdict is supportable.';
      return `${head} INCONCLUSIVE: ${listOf(reasons)}${guidance}`;
    }
  }
};

export const runProve = (
  rt: OracleRuntime,
  request: ProveRequest
): ProbeResult => {
  if (request.assertions.length === 0) {
    throw new TypeError(
      'prove: at least one assertion is required — an empty invariant set ' +
        'would report PROVED while checking nothing'
    );
  }
  for (const assertion of request.assertions) validate(assertion);

  const world = pinDomain(rt.worldOf(request.world), request.domain);
  const budget: ProbeBudget = {
    ...rt.budget,
    ...(request.budget ?? {}),
  };

  return rt.run(
    {
      operation: 'prove',
      world,
      scope: 'equivalence-class',
      objective: {
        kind: 'assertion',
        assertions: request.assertions.map((assertion) => ({
          kind: assertion.kind,
          target: rt.resolveTarget(assertion.target).target,
          params: {
            ...assertion,
            target: undefined,
          } as Readonly<Record<string, unknown>>,
        })),
      },
      budget,
    },
    (stateId, probeWorld) => {
      const factsBefore = rt.factCount(probeWorld);
      const obligationsBefore = rt.obligationCount();
      const graph = rt.graphFor(probeWorld);

      const evaluations = request.assertions.map((assertion) =>
        evaluateAssertion(rt, probeWorld, request.domain, budget, assertion)
      );
      const verdict = verdictOf(evaluations);

      const facts: RenderFact[] = evaluations.map((evaluation) => {
        const failure = minimize(evaluation.domain, evaluation.failures);
        return graph.add({
          subject: styleTargetSubject(evaluation.resolution.target),
          property: assertionLabel(evaluation.assertion),
          value: exact(failure === undefined ? 'holds' : 'violated'),
          guard: failure === undefined ? TRUE : pointGuard(failure.cell.point),
          authority:
            failure === undefined && evaluation.exceeded === undefined
              ? { kind: 'static-proof' }
              : { kind: 'abstract-bound' },
          derivation: evaluation.subjects
            .filter((subject) => subject.kind === 'rule')
            .map((subject) => ({
              kind: 'derived-from' as const,
              ref: subject.kind === 'rule' ? subject.rule : '',
              note: 'candidate for the asserted property',
            })),
          dependencies: [],
          provenance: [],
        });
      });

      const unknowns = rt.unknownsFor(
        evaluations.flatMap((evaluation) => [...evaluation.subjects]),
        evaluations.flatMap((evaluation) => [...evaluation.unknowns])
      );

      const operations: SuggestedOperation[] = [];
      for (const evaluation of evaluations) {
        const failure = minimize(evaluation.domain, evaluation.failures);
        if (failure !== undefined) {
          operations.push({
            kind: 'explain',
            description: `explain ${assertionLabel(
              evaluation.assertion
            )} at ${describePoint(
              failure.cell.point
            )} — the minimized counterexample`,
            expectedInformationGain: 'HIGH',
          });
          if (evaluation.winner !== undefined) {
            operations.push({
              kind: 'simulate-removal',
              description:
                `simulate removing ${evaluation.winner.candidate.rule.id}#` +
                `${evaluation.winner.declaration.property} — the winning ` +
                'declaration in the failing cell',
              expectedInformationGain: 'HIGH',
            });
          }
        }
        if (evaluation.exceeded !== undefined) {
          operations.push({
            kind: 'narrow-domain',
            description:
              `pin a dimension of ${evaluation.resolution.component.binding}` +
              `'s domain (${listOf(
                Object.keys(evaluation.domain)
              )}) or raise budget.maxCells above ` +
              `${evaluation.exceeded.count}`,
            expectedInformationGain: 'HIGH',
          });
        }
      }
      operations.push(...dischargeOperations(unknowns));

      // Declared domain size, not cells walked — `summarize` reports the
      // walked count under a similar name; keep the two distinguishable.
      const declaredCells = evaluations.reduce(
        (sum, evaluation) => sum + evaluation.cells,
        0
      );
      const evaluated = evaluations.reduce(
        (sum, evaluation) => sum + evaluation.evaluated,
        0
      );

      return {
        probeStateId: stateId,
        worldId: graph.worldId,
        verdict,
        summary: summarize(evaluations, verdict),
        facts,
        witnesses: witnessesOf(evaluations),
        assumptions: Array.from(
          new Set([
            ...rt.viewFor(probeWorld).assumptions,
            ...evaluations.flatMap((evaluation) => [
              ...evaluation.assumptions,
              ...evaluation.concerns,
            ]),
          ])
        ),
        unknowns,
        coverage: rt.coverage(declaredCells, evaluated),
        knowledgeDelta: rt.delta({
          newFacts: rt.factCount(probeWorld) - factsBefore,
          newObligations: rt.obligationCount() - obligationsBefore,
        }),
        nextOperations: dedupeOperations(operations),
      };
    }
  );
};
