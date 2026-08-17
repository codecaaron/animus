import { asProbeStateId, stableHash } from './identity';
import { MODEL_VERSION, worldId } from './world';

import type { RenderFact, RenderSubject } from './fact';
import type { ObligationId, ProbeStateId, TargetId, WorldId } from './identity';
import type { UnknownObligation } from './obligation';
import type { ScenarioPoint } from './scenario';
import type { RenderWorld } from './world';

/**
 * How widely an answer is meant to hold: one callsite, every invocation of a
 * component, a declared equivalence class of contexts, or the definition
 * itself. Scope is part of the probe's identity because the same question at
 * two scopes is two different questions.
 */
export type ProbeScope =
  | 'callsite'
  | 'all-invocations'
  | 'equivalence-class'
  | 'definition';

/**
 * Which of the six operations is asking. Part of the probe's identity: two
 * operations can build byte-identical descriptors (diff and simulate over the
 * same target and deltas) yet produce different answers — diff makes no causal
 * claims, simulate does — so without this field the second one is handed the
 * first one's answer as a FIXPOINT.
 */
export type ProbeOperation =
  | 'inspect'
  | 'explain'
  | 'simulate'
  | 'diff'
  | 'prove'
  | 'refine';

export type SymptomSpec = {
  kind: string;
  target: TargetId;
  detail?: Readonly<Record<string, unknown>>;
};

export type AssertionSpec = {
  kind: string;
  target: TargetId;
  params?: Readonly<Record<string, unknown>>;
};

export type ProbeObjective =
  | { kind: 'fact'; subject: RenderSubject; properties?: readonly string[] }
  | { kind: 'symptom'; symptom: SymptomSpec }
  | { kind: 'diff'; against: WorldId }
  | { kind: 'assertion'; assertions: readonly AssertionSpec[] }
  | { kind: 'discharge'; obligation: ObligationId };

/**
 * How hard a probe may try. Engines hash the *resolved* budget into the probe
 * identity (a strategy knob changes the answer, so it is part of the
 * question) — resolved, not raw, so `{}` and an explicit default remain the
 * same probe.
 */
export interface ProbeBudget {
  maxCells?: number;
  maxBranchForks?: number;
  allowBranchSplit?: boolean;
  allowBrowserEvidence?: boolean;
}

export interface RenderProbe {
  operation: ProbeOperation;
  world: RenderWorld;
  target?: TargetId;
  scope: ProbeScope;
  scenarioPoint?: ScenarioPoint;
  objective: ProbeObjective;
  budget?: ProbeBudget;
}

export type ProbeVerdict =
  | 'ESTABLISHED'
  | 'PROVED'
  | 'DISPROVED'
  | 'CONDITIONAL'
  | 'INCONCLUSIVE'
  | 'FIXPOINT'
  | 'OUTSIDE_MODEL';

export interface KnowledgeDelta {
  newFacts: number;
  precisionImprovements: number;
  candidatesEliminated: number;
  newObligations: number;
}

/** The one spelling of "nothing was learned" — owned by the type's module. */
export const emptyKnowledgeDelta = (): KnowledgeDelta => ({
  newFacts: 0,
  precisionImprovements: 0,
  candidatesEliminated: 0,
  newObligations: 0,
});

export interface SuggestedOperation {
  kind: string;
  description: string;
  expectedInformationGain: 'HIGH' | 'MEDIUM' | 'LOW';
}

/**
 * Causal language discipline (DESIGN §7): a finding states what was shown
 * under the tested domain, never "this is the bug". Repair choice needs
 * assertions and a change-cost policy, which live above this layer.
 */
export interface CausalFinding {
  subject: string;
  status:
    | 'SUFFICIENT_UNDER_DOMAIN'
    | 'NECESSARY_UNDER_DOMAIN'
    | 'MODEL_RELATIVE_INTERVENTION_WITNESS'
    | 'EXONERATED_UNDER_TESTED_ALTERNATIVES'
    | 'ONE_OF_MULTIPLE_MINIMAL_SETS';
  note: string;
}

export interface CoverageReport {
  scenarioCells: number;
  cellsEvaluated: number;
  outsideModel: readonly string[];
}

export interface CounterexampleWitness {
  point: ScenarioPoint;
  violation: string;
  boundary?: string;
}

/**
 * How a cascade decision moved between two worlds. `engines/diff.ts` is the
 * only producer and re-exports these names, but the declaration lives here,
 * beside the `ProbeResult` field it types: the shape is expressible in `core/`
 * vocabulary alone (`RenderSubject` plus primitives), so nothing about it
 * obliged the field to be `unknown`.
 */
export type SemanticDiffKind =
  | 'value-changed'
  | 'winner-changed'
  | 'rule-activated'
  | 'rule-deactivated'
  | 'token-changed'
  | 'declaration-added'
  | 'declaration-removed';

export interface SemanticDiffEntry {
  subject: RenderSubject;
  property: string;
  kind: SemanticDiffKind;
  context: string;
  before?: string;
  after?: string;
}

export interface SemanticDiff {
  entries: readonly SemanticDiffEntry[];
  affectedContextClasses: number;
  unaffectedContextClasses: number;
}

export interface ProbeResult {
  probeStateId: ProbeStateId;
  worldId: WorldId;
  verdict: ProbeVerdict;
  summary: string;
  facts: readonly RenderFact[];
  witnesses?: readonly CounterexampleWitness[];
  causalFindings?: readonly CausalFinding[];
  /** Present exactly when the operation compared two worlds (`diff`,
   *  `simulate`); both fill it with `toSemanticDiff(sweep)`. */
  semanticDiff?: SemanticDiff;
  assumptions: readonly string[];
  unknowns: readonly UnknownObligation[];
  coverage: CoverageReport;
  knowledgeDelta: KnowledgeDelta;
  nextOperations: readonly SuggestedOperation[];
  previous?: ProbeStateId;
}

/**
 * The anti-loop identity (DESIGN §5).
 *
 * Everything that could make the same question produce a different answer is
 * hashed in: the asking operation, the world (itself a hash over program
 * revision, scenario domain, environment and interventions), the target, the
 * scope, the pinned scenario point, the objective, the budget, the model
 * version, and the evidence revision. Two probes sharing a state id therefore *cannot* yield new
 * information, which is what lets `ProbeLedger` answer FIXPOINT instead of
 * letting an agent mistake repetition for progress. Any future input that can
 * change an answer must be added here, or the fixpoint guarantee is void.
 */
export const probeStateId = (probe: RenderProbe): ProbeStateId =>
  asProbeStateId(
    stableHash({
      operation: probe.operation,
      world: worldId(probe.world),
      target: probe.target,
      scope: probe.scope,
      scenarioPoint: probe.scenarioPoint,
      objective: probe.objective,
      budget: probe.budget,
      modelVersion: MODEL_VERSION,
      evidenceRevision: probe.world.evidenceRevision,
    })
  );

export class ProbeLedger {
  #results = new Map<ProbeStateId, ProbeResult>();

  record(result: ProbeResult): void {
    this.#results.set(result.probeStateId, result);
  }

  seen(stateId: ProbeStateId): ProbeResult | undefined {
    return this.#results.get(stateId);
  }

  /**
   * The no-progress answer: same state, no new knowledge. It keeps the prior
   * facts and unknowns (they are still the strongest supported answer) but
   * zeroes the knowledge delta and hands back the untried operations, so the
   * only way forward is an operation that changes the state.
   */
  fixpoint(
    prior: ProbeResult,
    untried: readonly SuggestedOperation[]
  ): ProbeResult {
    return {
      ...prior,
      verdict: 'FIXPOINT',
      summary:
        'FIXPOINT: no new information since the prior probe of this state — ' +
        prior.summary,
      knowledgeDelta: emptyKnowledgeDelta(),
      nextOperations: untried,
      previous: prior.probeStateId,
    };
  }
}
