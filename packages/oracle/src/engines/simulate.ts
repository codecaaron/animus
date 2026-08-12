/**
 * `simulate` — what changes in a hypothetical world.
 *
 * The interventions are evaluated as a view over the closed universe, never
 * written anywhere, and the answer is deliberately two-sided: the focal effect
 * at the probed context *and* the collateral sweep over every other component
 * and context class. DESIGN §7 governs the wording of the causal half —
 * "sufficient under domain D" is claimable only when the outcome moved in every
 * evaluated cell; a single witness cell earns only "model-relative intervention
 * witness".
 */

import { applyDeltas, describeDelta, worldId } from '../core/world';
import { cellCount, cellsOf, harvestCuts, scopedDomain } from './cells';
import {
  addedInterventions,
  affectedRulesOf,
  focalFacts,
  subjectsOfDeltas,
  summarizeDiff,
  sweepWorlds,
  toSemanticDiff,
} from './diff';
import { describePoint, listOf, plural } from './format';
import { dedupeOperations, dischargeOperations, zeroDelta } from './result';

import type { CausalFinding, ProbeResult } from '../core/probe';
import type {
  ScenarioCell,
  ScenarioDomain,
  ScenarioPoint,
} from '../core/scenario';
import type { RenderWorld, WorldDelta } from '../core/world';
import type { ComparisonSide } from './diff';
import type { OracleRuntime } from './runtime';

export interface SimulateRequest {
  deltas: readonly WorldDelta[];
  target?: string;
  at?: ScenarioPoint | string;
  world?: RenderWorld;
  domain?: ScenarioDomain;
}

const causalFindingsFor = (
  deltas: readonly WorldDelta[],
  changedProperties: readonly string[],
  cellsChanged: number,
  cellsEvaluated: number
): readonly CausalFinding[] => {
  if (changedProperties.length === 0 || cellsEvaluated === 0) return [];

  // "Sufficient under domain D" is a claim about a *domain*. A simulation
  // pinned to one point has no domain to generalise over, so it earns the
  // witness status however completely it changed that single cell.
  const sufficient = cellsEvaluated > 1 && cellsChanged === cellsEvaluated;
  return [
    {
      subject: deltas.map(describeDelta).join(' + '),
      status: sufficient
        ? 'SUFFICIENT_UNDER_DOMAIN'
        : 'MODEL_RELATIVE_INTERVENTION_WITNESS',
      note: sufficient
        ? `the intervention moved ${listOf(changedProperties)} in all ${plural(
            cellsEvaluated,
            'evaluated cell'
          )} of the focal domain — sufficient under this domain, this ` +
          'program revision and this model version, and nothing stronger'
        : `the intervention moved ${listOf(changedProperties)} in ` +
          `${cellsChanged} of ${plural(
            cellsEvaluated,
            'evaluated cell'
          )} — a model-relative intervention witness, not a claim that it ` +
          'is the rule to change',
    },
  ];
};

export const runSimulate = (
  rt: OracleRuntime,
  request: SimulateRequest
): ProbeResult => {
  const baselineWorld = rt.worldOf(request.world);
  const candidateWorld = applyDeltas(baselineWorld, request.deltas);

  // Eager: a delta naming an unknown rule or property must throw before any
  // verdict exists, so the caller cannot read "no change" as "tested".
  rt.viewFor(candidateWorld);

  const resolution =
    request.target === undefined ? undefined : rt.resolveTarget(request.target);
  const point =
    request.at === undefined ? undefined : rt.resolvePoint(request.at);

  return rt.run(
    {
      world: candidateWorld,
      ...(resolution === undefined ? {} : { target: resolution.target }),
      scope: point === undefined ? 'equivalence-class' : 'callsite',
      ...(point === undefined ? {} : { scenarioPoint: point }),
      objective: { kind: 'diff', against: worldId(baselineWorld) },
      budget: rt.budget,
    },
    (stateId, probeWorld) => {
      const factsBefore = rt.factCount(probeWorld);
      const obligationsBefore = rt.obligationCount();

      const baseline: ComparisonSide = {
        world: baselineWorld,
        ctx: rt.contextFor(baselineWorld),
      };
      const candidate: ComparisonSide = {
        world: probeWorld,
        ctx: rt.contextFor(probeWorld),
      };
      const added = addedInterventions(baselineWorld, probeWorld);

      let focalCells: readonly ScenarioCell[] | undefined;
      let scenarioCells = 0;
      if (resolution !== undefined) {
        // The baseline domain, deliberately: a `force-dimension` delta must
        // still be compared against the values it displaced.
        const domain = scopedDomain(resolution, baselineWorld, request.domain);
        const harvested = harvestCuts(
          candidate.ctx,
          resolution,
          domain,
          rt.host.scenarios.cuts(),
          rt.maxCells()
        );
        scenarioCells = cellCount(domain, harvested.cuts);
        focalCells =
          point === undefined
            ? cellsOf(domain, harvested.cuts)
            : [{ point, description: {} }];
      }

      const sweep = sweepWorlds({
        rt,
        baseline,
        candidate,
        affectedRules: affectedRulesOf(added),
        maxCells: rt.maxCells(),
        ...(resolution === undefined ? {} : { focal: resolution }),
        ...(focalCells === undefined ? {} : { focalCells }),
      });

      const facts = focalFacts(
        rt,
        candidate,
        probeWorld,
        resolution,
        point ?? focalCells?.[0]?.point ?? {},
        sweep.changedProperties
      );

      const unknowns = rt.unknownsFor(
        [...sweep.subjects, ...subjectsOfDeltas(added)],
        []
      );

      const where =
        point === undefined
          ? 'across the focal domain'
          : `at ${describePoint(point)}`;

      return {
        probeStateId: stateId,
        worldId: worldId(probeWorld),
        verdict: unknowns.length === 0 ? 'ESTABLISHED' : 'CONDITIONAL',
        summary:
          `${summarizeDiff(
            sweep,
            `Simulating ${listOf(request.deltas.map(describeDelta))} ${where}`
          )} ` +
          (sweep.changedProperties.length === 0
            ? 'No property changed anywhere in the modeled universe.'
            : `Properties moved: ${listOf(sweep.changedProperties)}.`),
        facts,
        semanticDiff: toSemanticDiff(sweep),
        causalFindings: causalFindingsFor(
          request.deltas,
          sweep.changedProperties,
          sweep.focalCellsChanged,
          sweep.focalCellsEvaluated
        ),
        assumptions: Array.from(
          new Set([
            ...rt.viewFor(baselineWorld).assumptions,
            ...rt.viewFor(probeWorld).assumptions,
            ...(sweep.truncated
              ? [
                  `the collateral sweep stopped after ${plural(
                    sweep.cellsEvaluated,
                    'cell'
                  )} (budget) — components after that point were not checked`,
                ]
              : []),
          ])
        ),
        unknowns,
        coverage: rt.coverage(
          scenarioCells === 0 ? sweep.cellsEvaluated : scenarioCells,
          sweep.cellsEvaluated
        ),
        knowledgeDelta: {
          ...zeroDelta(),
          newFacts: rt.factCount(probeWorld) - factsBefore,
          newObligations: rt.obligationCount() - obligationsBefore,
        },
        nextOperations: dedupeOperations([
          ...(sweep.entries.length === 0
            ? []
            : [
                {
                  kind: 'diff',
                  description:
                    'diff this hypothetical world against the baseline to ' +
                    'classify the collateral changes by context class',
                  expectedInformationGain: 'MEDIUM' as const,
                },
              ]),
          ...(sweep.changedProperties.length === 0
            ? []
            : [
                {
                  kind: 'prove',
                  description: `prove the intended value of ${listOf(
                    sweep.changedProperties
                  )} over the whole domain in this hypothetical world`,
                  expectedInformationGain: 'HIGH' as const,
                },
              ]),
          ...dischargeOperations(unknowns),
        ]),
      };
    }
  );
};
