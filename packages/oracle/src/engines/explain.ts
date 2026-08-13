/**
 * `explain` — why this value, or why nothing at all.
 *
 * Traversal of the derivation graph backward from the effective fact: the
 * winner, each declaration it defeated and the reason, the token chain that
 * produced the value, and the authored source span behind each one. Causal
 * language follows DESIGN §7 — the winner is reported as a *model-relative
 * intervention witness*, never as "the bug"; which declaration should change is
 * a repair question that needs assertions and a change-cost policy.
 */

import { describeValue } from '../core/value';
import {
  analyzeCascade,
  buildConditionalFact,
  buildDefeatedFact,
  buildInheritedFact,
  buildWinnerFact,
  describeDefeat,
  describeOrigin,
  failingConjuncts,
  subjectsForProperty,
  winnerOf,
} from './cascade';
import { cellCount, scopedDomain } from './cells';
import { describePoint, listOf, plural } from './format';
import {
  dedupeOperations,
  dischargeOperations,
  forkOperations,
  pointVerdict,
  removalOperation,
  replacementOperation,
} from './result';

import type { RenderFact } from '../core/fact';
import type { UnknownObligation } from '../core/obligation';
import type { CausalFinding, ProbeResult } from '../core/probe';
import type { ScenarioPoint } from '../core/scenario';
import type { RenderWorld } from '../core/world';
import type {
  CascadeAnalysis,
  CascadeContext,
  DeclarationCandidate,
} from './cascade';
import type { OracleRuntime } from './runtime';

export type OracleSymptom =
  | {
      kind: 'unexpected-value';
      detail: { property: string; expected?: string };
    }
  | { kind: 'missing-declaration'; detail: { property: string } };

export interface ExplainRequest {
  target: string;
  symptom: OracleSymptom;
  at?: ScenarioPoint | string;
  world?: RenderWorld;
}

export const SYMPTOM_KINDS = ['unexpected-value', 'missing-declaration'];

const validate = (symptom: OracleSymptom): string => {
  if (!SYMPTOM_KINDS.includes(symptom.kind)) {
    throw new TypeError(
      `explain: unknown symptom kind '${String(symptom.kind)}' — ` +
        `supported: ${SYMPTOM_KINDS.join(', ')}`
    );
  }
  const property = symptom.detail?.property;
  if (typeof property !== 'string' || property.length === 0) {
    throw new TypeError(
      `explain: symptom '${symptom.kind}' requires detail.property (a CSS ` +
        'property name)'
    );
  }
  return property;
};

/** Candidates that declare the property but cannot apply at this point. */
const conditionalFor = (
  analysis: CascadeAnalysis,
  property: string
): readonly DeclarationCandidate[] => {
  const outcome = analysis.outcomes.get(property);
  if (outcome === undefined) return [];
  return outcome.defeated
    .filter(
      (defeated) =>
        defeated.reason === 'condition-false' &&
        defeated.declaration.candidate.conditional
    )
    .map((defeated) => defeated.declaration);
};

const describeBlockedBy = (
  declaration: DeclarationCandidate,
  point: ScenarioPoint
): string => {
  const candidate = declaration.candidate;
  const failing = failingConjuncts(candidate.guard, point);
  const where =
    candidate.unboundInWorld.length > 0
      ? ` (${listOf(candidate.unboundInWorld)} is not declared in this world)`
      : candidate.unboundAtPoint.length > 0
        ? ` (${listOf(candidate.unboundAtPoint)} is unbound at this point)`
        : '';
  return (
    `${candidate.rule.id} would declare ${declaration.declaration.property}: ` +
    `${declaration.declaration.value} under ${listOf(failing)}${where}`
  );
};

interface Explanation {
  summary: string;
  facts: readonly RenderFact[];
  assumptions: readonly string[];
  raised: readonly UnknownObligation[];
  causalFindings: readonly CausalFinding[];
  focus?: DeclarationCandidate;
}

const explainMissingDeclaration = (
  ctx: CascadeContext,
  rt: OracleRuntime,
  world: RenderWorld,
  analysis: CascadeAnalysis,
  property: string
): Explanation => {
  const graph = rt.graphFor(world);
  const outcome = analysis.outcomes.get(property);
  const inherited = analysis.inherited.get(property);
  const facts: RenderFact[] = [];
  const assumptions: string[] = [];
  const raised: UnknownObligation[] = [];

  const sentences: string[] = [];

  if (outcome === undefined) {
    sentences.push(
      `No candidate rule declares ${property} for ` +
        `${analysis.resolution.component.binding} at ${describePoint(
          analysis.point
        )}: ${plural(
          analysis.candidates.length,
          'rule'
        )} match the target's classes and none of them sets it.`
    );
  } else {
    const blocked = outcome.defeated.map((defeated) => defeated.declaration);
    const nearest = winnerOf(blocked);
    sentences.push(
      `${plural(
        blocked.length,
        'declaration'
      )} of ${property} exist for this target, but none is active at ` +
        `${describePoint(analysis.point)}.`
    );
    if (nearest !== undefined) {
      sentences.push(
        `The highest-precedence one is ${describeBlockedBy(
          nearest,
          analysis.point
        )}.`
      );
    }
    for (const declaration of blocked) {
      facts.push(buildConditionalFact(ctx, graph, analysis, declaration));
    }
  }

  if (inherited !== undefined) {
    const built = buildInheritedFact(ctx, graph, analysis, inherited);
    facts.push(built.fact);
    assumptions.push(...built.resolved.assumptions);
    raised.push(...built.resolved.raised);
    sentences.push(
      `${property} is inherited instead: ${describeValue(
        built.fact.value
      )} from '${inherited.declaration.candidate.rule.selector.raw}' in ` +
        `layer ${inherited.declaration.candidate.rule.layer}.`
    );
  } else {
    sentences.push(
      `${property} is not set in the modeled universe for this target — ` +
        'no element-selector rule supplies it either, so the residual ' +
        `candidates are outside the model: ` +
        `${listOf(ctx.universe.exclusions)}.`
    );
  }

  return {
    summary: sentences.join(' '),
    facts,
    assumptions,
    raised,
    causalFindings: [],
  };
};

const explainUnexpectedValue = (
  ctx: CascadeContext,
  rt: OracleRuntime,
  world: RenderWorld,
  analysis: CascadeAnalysis,
  property: string,
  expected: string | undefined
): Explanation => {
  const graph = rt.graphFor(world);
  const outcome = analysis.outcomes.get(property);
  const winner = outcome?.winner;

  if (outcome === undefined || winner === undefined) {
    // Falling through to the missing-declaration narrative is the honest
    // answer: an "unexpected value" for a property nothing sets is really the
    // question of why nothing sets it.
    return explainMissingDeclaration(ctx, rt, world, analysis, property);
  }

  const built = buildWinnerFact(ctx, graph, analysis, outcome);
  const facts: RenderFact[] = [];
  const assumptions: string[] = [];
  const raised: UnknownObligation[] = [];

  if (built !== undefined) {
    facts.push(built.fact);
    assumptions.push(...built.resolved.assumptions);
    raised.push(...built.resolved.raised);
  }

  for (const defeated of outcome.defeated) {
    facts.push(buildDefeatedFact(ctx, graph, analysis, winner, defeated));
  }

  const value =
    built === undefined ? 'unresolved' : describeValue(built.fact.value);
  const chains = built?.resolved.tokenChains ?? [];
  const source = winner.candidate.rule.source;
  const conditional = conditionalFor(analysis, property);

  const sentences = [
    `${property} = ${value} at ${describePoint(analysis.point)} is set by ` +
      `${winner.candidate.rule.id} (${describeOrigin(winner.candidate.rule)})${
        source === undefined
          ? ''
          : `, authored in ${source.file}${
              source.span === undefined
                ? ''
                : `:${source.span[0]}-${source.span[1]}`
            }`
      }.`,
    outcome.defeated.length === 0
      ? 'No other declaration competed for it.'
      : `It defeated ${plural(
          outcome.defeated.length,
          'declaration'
        )}: ${outcome.defeated.map(describeDefeat).join('; ')}.`,
  ];

  if (chains.length > 0) {
    sentences.push(
      `The value resolves through ${chains
        .map((chain) => chain.join(' → '))
        .join(', ')}.`
    );
  }
  if (expected !== undefined) {
    sentences.push(
      value === expected
        ? `The effective value already equals the expected '${expected}' in ` +
            'this world — the symptom must come from a context outside it.'
        : `The expected value was '${expected}'; the model says '${value}'.`
    );
  }
  if (conditional.length > 0) {
    sentences.push(
      `${plural(
        conditional.length,
        'further declaration'
      )} could take over under another binding: ${conditional
        .map((declaration) => describeBlockedBy(declaration, analysis.point))
        .join('; ')}.`
    );
  }

  for (const declaration of conditional) {
    facts.push(buildConditionalFact(ctx, graph, analysis, declaration));
    assumptions.push(
      `conditional influence — ${describeBlockedBy(
        declaration,
        analysis.point
      )}`
    );
  }

  return {
    summary: sentences.join(' '),
    facts,
    assumptions,
    raised,
    causalFindings: [
      {
        subject: `${winner.candidate.rule.id}#${property}`,
        status: 'MODEL_RELATIVE_INTERVENTION_WITNESS',
        note:
          'removing or replacing this declaration changes the outcome at ' +
          'this point under the modeled cascade — verify with simulate ' +
          'before treating it as the repair site',
      },
    ],
    focus: winner,
  };
};

export const runExplain = (
  rt: OracleRuntime,
  request: ExplainRequest
): ProbeResult => {
  const property = validate(request.symptom);
  const world = rt.worldOf(request.world);
  const resolution = rt.resolveTarget(request.target);
  const point = rt.resolvePoint(request.at);

  return rt.run(
    {
      operation: 'explain',
      world,
      target: resolution.target,
      scope: 'callsite',
      scenarioPoint: point,
      objective: {
        kind: 'symptom',
        symptom: {
          kind: request.symptom.kind,
          target: resolution.target,
          detail: request.symptom.detail,
        },
      },
      budget: rt.budget,
    },
    (stateId, probeWorld) => {
      const ctx = rt.contextFor(probeWorld);
      const factsBefore = rt.factCount(probeWorld);
      const obligationsBefore = rt.obligationCount();
      const analysis = analyzeCascade(ctx, resolution, point);
      const expected =
        request.symptom.kind === 'unexpected-value'
          ? request.symptom.detail.expected
          : undefined;

      // One entry point for both symptoms: `explainUnexpectedValue` already
      // answers a set property with the winner narrative and falls through to
      // the missing-declaration narrative when nothing wins — which is also
      // the honest answer when a missing-declaration premise turns out false.
      const explanation = explainUnexpectedValue(
        ctx,
        rt,
        probeWorld,
        analysis,
        property,
        expected
      );

      const unknowns = rt.unknownsFor(
        subjectsForProperty(analysis, property),
        explanation.raised
      );
      const domain = scopedDomain(resolution, probeWorld);

      return {
        probeStateId: stateId,
        worldId: rt.graphFor(probeWorld).worldId,
        verdict: pointVerdict(unknowns),
        summary: explanation.summary,
        facts: explanation.facts,
        causalFindings: explanation.causalFindings,
        assumptions: Array.from(
          new Set([
            ...rt.viewFor(probeWorld).assumptions,
            ...analysis.assumptions,
            ...explanation.assumptions,
          ])
        ),
        unknowns,
        coverage: rt.coverage(cellCount(domain, rt.host.scenarios.cuts()), 1),
        knowledgeDelta: rt.delta({
          newFacts: rt.factCount(probeWorld) - factsBefore,
          newObligations: rt.obligationCount() - obligationsBefore,
          candidatesEliminated:
            analysis.outcomes.get(property)?.defeated.length ?? 0,
        }),
        nextOperations: dedupeOperations([
          ...(explanation.focus === undefined
            ? []
            : [removalOperation(explanation.focus)]),
          ...(explanation.focus === undefined || expected === undefined
            ? []
            : [replacementOperation(explanation.focus, expected)]),
          ...forkOperations(analysis, domain),
          ...dischargeOperations(unknowns),
        ]),
      };
    }
  );
};
