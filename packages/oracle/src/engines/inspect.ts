/**
 * `inspect` — what can be established about this target in this context.
 *
 * The cheapest projection of the fact substrate: read the cascade at one point
 * and report the winners with their provenance, the declarations they defeated
 * and the reason each lost, plus everything the model could not decide.
 */

import { describeValue } from '../core/value';
import {
  analyzeCascade,
  buildInheritedFact,
  buildWinnerFact,
  conditionalCandidates,
  styleTargetSubject,
  subjectsOf,
} from './cascade';
import { cellCount, scopedDomain } from './cells';
import { describePoint, listOf, plural } from './format';
import {
  dedupeOperations,
  dischargeOperations,
  forkOperations,
  pointVerdict,
  removalOperation,
} from './result';

import type { RenderFact } from '../core/fact';
import type { UnknownObligation } from '../core/obligation';
import type { Predicate } from '../core/predicate';
import type { ProbeResult } from '../core/probe';
import type { ScenarioPoint } from '../core/scenario';
import type { RenderWorld } from '../core/world';
import type { CascadeAnalysis, DeclarationCandidate } from './cascade';
import type { OracleRuntime } from './runtime';

export interface InspectRequest {
  target: string;
  at?: ScenarioPoint | string;
  world?: RenderWorld;
}

export interface CascadeReading {
  analysis: CascadeAnalysis;
  facts: readonly RenderFact[];
  assumptions: readonly string[];
  raised: readonly UnknownObligation[];
  /** Winner values, already token-resolved, keyed by property. */
  values: ReadonlyMap<string, string>;
}

/**
 * Derive every fact the cascade supports at one point. Shared with `refine`,
 * whose branches are just this reading under a pinned dimension — the branch
 * guard is threaded through as `contextGuard` so a forked fact records the
 * binding it holds under instead of claiming to be unconditional.
 */
export const readCascade = (
  rt: OracleRuntime,
  world: RenderWorld,
  target: string,
  point: ScenarioPoint,
  contextGuard?: Predicate
): CascadeReading => {
  const ctx = rt.contextFor(world);
  const graph = rt.graphFor(world);
  const resolution = rt.resolveTarget(target);
  const analysis = analyzeCascade(ctx, resolution, point);

  const facts: RenderFact[] = [];
  const assumptions = [
    ...rt.viewFor(world).assumptions,
    ...analysis.assumptions,
  ];
  const raised: UnknownObligation[] = [];
  const values = new Map<string, string>();

  for (const property of Array.from(analysis.outcomes.keys()).sort()) {
    const outcome = analysis.outcomes.get(property);
    if (outcome === undefined) continue;
    const built = buildWinnerFact(ctx, graph, analysis, outcome, contextGuard);
    if (built === undefined) continue;
    facts.push(built.fact);
    assumptions.push(...built.resolved.assumptions);
    raised.push(...built.resolved.raised);
    values.set(property, describeValue(built.fact.value));
  }

  for (const property of Array.from(analysis.inherited.keys()).sort()) {
    const inherited = analysis.inherited.get(property);
    if (inherited === undefined) continue;
    const built = buildInheritedFact(
      ctx,
      graph,
      analysis,
      inherited,
      contextGuard
    );
    facts.push(built.fact);
    assumptions.push(...built.resolved.assumptions);
    raised.push(...built.resolved.raised);
    values.set(property, describeValue(built.fact.value));
  }

  return {
    analysis,
    facts,
    assumptions: Array.from(new Set(assumptions)),
    raised,
    values,
  };
};

/** The winner that beat the most declarations — the best probe to try. */
const mostContested = (
  analysis: CascadeAnalysis
): DeclarationCandidate | undefined => {
  let best: DeclarationCandidate | undefined;
  let bestDefeats = -1;
  for (const property of Array.from(analysis.outcomes.keys()).sort()) {
    const outcome = analysis.outcomes.get(property);
    if (outcome?.winner === undefined) continue;
    if (outcome.defeated.length > bestDefeats) {
      best = outcome.winner;
      bestDefeats = outcome.defeated.length;
    }
  }
  return best;
};

export const summarizeCascade = (analysis: CascadeAnalysis): string => {
  const active = analysis.candidates.filter(
    (candidate) => candidate.active
  ).length;
  const resolved = Array.from(analysis.outcomes.values()).filter(
    (outcome) => outcome.winner !== undefined
  ).length;
  const inherited = analysis.inherited.size;
  const conditional = conditionalCandidates(analysis).length;
  const defeated = Array.from(analysis.outcomes.values()).reduce(
    (total, outcome) => total + outcome.defeated.length,
    0
  );

  return (
    `${analysis.resolution.component.binding} at ${describePoint(
      analysis.point
    )} carries ${plural(analysis.classes.length, 'class', 'classes')} ` +
    `(${listOf(analysis.classes)}). ` +
    `${active} of ${plural(
      analysis.candidates.length,
      'candidate rule'
    )} are active across ${plural(
      analysis.layersTouched.length,
      'layer'
    )} (${listOf(analysis.layersTouched)}); ` +
    `${conditional} conditionally-inactive. ` +
    `${plural(resolved, 'property', 'properties')} resolved on the target ` +
    `and ` +
    `${inherited} inherited; ${plural(defeated, 'declaration')} defeated.`
  );
};

export const runInspect = (
  rt: OracleRuntime,
  request: InspectRequest
): ProbeResult => {
  const world = rt.worldOf(request.world);
  const resolution = rt.resolveTarget(request.target);
  const point = rt.resolvePoint(request.at);

  return rt.run(
    {
      operation: 'inspect',
      world,
      target: resolution.target,
      scope: 'callsite',
      scenarioPoint: point,
      objective: {
        kind: 'fact',
        subject: styleTargetSubject(resolution.target),
      },
      budget: rt.budget,
    },
    (stateId, probeWorld) => {
      const factsBefore = rt.factCount(probeWorld);
      const obligationsBefore = rt.obligationCount();

      const reading = readCascade(rt, probeWorld, request.target, point);
      const unknowns = rt.unknownsFor(
        subjectsOf(reading.analysis),
        reading.raised
      );

      const domain = scopedDomain(resolution, probeWorld);
      const winner = mostContested(reading.analysis);

      return {
        probeStateId: stateId,
        worldId: rt.graphFor(probeWorld).worldId,
        verdict: pointVerdict(unknowns),
        summary: summarizeCascade(reading.analysis),
        facts: reading.facts,
        assumptions: reading.assumptions,
        unknowns,
        coverage: rt.coverage(cellCount(domain, rt.host.scenarios.cuts()), 1),
        knowledgeDelta: rt.delta({
          newFacts: rt.factCount(probeWorld) - factsBefore,
          newObligations: rt.obligationCount() - obligationsBefore,
        }),
        nextOperations: dedupeOperations([
          ...(winner === undefined ? [] : [removalOperation(winner)]),
          ...forkOperations(reading.analysis, domain),
          ...dischargeOperations(unknowns),
        ]),
      };
    }
  );
};
