import { asProbeStateId, stableHash } from './identity';
import { MODEL_VERSION, worldId } from './world';

import type { RenderFact, RenderSubject } from './fact';
import type { ObligationId, ProbeStateId, TargetId, WorldId } from './identity';
import type { UnknownObligation } from './obligation';
import type { ScenarioPoint } from './scenario';
import type { RenderWorld } from './world';

export type ProbeScope =
  | 'callsite'
  | 'all-invocations'
  | 'equivalence-class'
  | 'definition';

export type ProbeOperation =
  | 'inspect'
  | 'explain'
  | 'simulate'
  | 'diff'
  | 'prove'
  | 'refine';

export type SymptomDetail = {
  property: string;
  expected?: string;
};

export type SymptomSpec = {
  kind: string;
  target: TargetId;
  detail?: SymptomDetail;
};

export type AssertionParam = string | readonly string[] | undefined;

export type AssertionSpec = {
  kind: string;
  target: TargetId;
  params?: Readonly<Record<string, AssertionParam>>;
};

export type ProbeObjective =
  | { kind: 'fact'; subject: RenderSubject; properties?: readonly string[] }
  | { kind: 'symptom'; symptom: SymptomSpec }
  | { kind: 'diff'; against: WorldId }
  | { kind: 'assertion'; assertions: readonly AssertionSpec[] }
  | { kind: 'discharge'; obligation: ObligationId };

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
   *  `simulate`). */
  semanticDiff?: SemanticDiff;
  assumptions: readonly string[];
  unknowns: readonly UnknownObligation[];
  coverage: CoverageReport;
  knowledgeDelta: KnowledgeDelta;
  nextOperations: readonly SuggestedOperation[];
  previous?: ProbeStateId;
}

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
