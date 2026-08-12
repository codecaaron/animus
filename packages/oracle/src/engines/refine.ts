/**
 * `refine` — discharge one unknown as cheaply and narrowly as possible.
 *
 * An unknown is never a dead end (DESIGN §4). When the obligation's guard
 * turns on a finite axis this world declares, the branch split is executed
 * here and now: the world is forked per value, the influenced targets are
 * re-read under each pinned binding, and the per-branch facts carry that
 * binding in their guard — a partition of the domain, which is a *stronger*
 * answer than any single point measurement.
 *
 * Otherwise the answer is honest about being CONDITIONAL: it names the cheapest
 * sound procedure and why this phase cannot run it (context capsules are
 * declared, not implemented), and lists the discharge options in cost order so
 * the next operation is a decision rather than a search.
 */

import { asObligationId } from '../core/identity';
import { eq, referencedDimensions } from '../core/predicate';
import { applyDeltas, worldId } from '../core/world';
import { ownsRule } from './diff';
import { listOf, plural } from './format';
import { readCascade } from './inspect';
import { byCost, dedupeOperations } from './result';

import type { RenderFact } from '../core/fact';
import type { RuleId } from '../core/identity';
import type { UnknownObligation } from '../core/obligation';
import type { ProbeResult, SuggestedOperation } from '../core/probe';
import type { DimensionValue } from '../core/scenario';
import type { RenderWorld } from '../core/world';
import type { OracleRuntime } from './runtime';

export interface RefinePolicy {
  /** Refuse the automated fork even when it is available. */
  allowBranchSplit?: boolean;
  maxBranches?: number;
}

export interface RefineRequest {
  obligation: string;
  policy?: RefinePolicy;
  world?: RenderWorld;
}

interface Forkable {
  dimension: string;
  values: readonly DimensionValue[];
}

/**
 * The axis to split on: a dimension the obligation's guard tests that this
 * world declares as a finite set. An axis the world never declared cannot be
 * forked — no fork can invent values — and an interval axis is not a finite
 * case analysis, so both fall through to the CONDITIONAL answer.
 */
const forkableAxis = (
  obligation: UnknownObligation,
  world: RenderWorld,
  maxBranches: number
): Forkable | undefined => {
  for (const dimension of referencedDimensions(obligation.guard)) {
    const declared = world.scenario[dimension];
    if (declared === undefined || declared.kind !== 'finite') continue;
    if (declared.values.length === 0) continue;
    if (declared.values.length > maxBranches) continue;
    return { dimension, values: declared.values };
  }
  return undefined;
};

/**
 * Which targets a branch split would actually re-read.
 *
 * An influence scope naming only a rule or a declaration still points at
 * components — the ones carrying that rule's classes — so a
 * property-precise obligation is forkable without the host restating the
 * target. That
 * matters because engine-raised obligations are deliberately scoped to the
 * declaration (see `cascade.raiseDynamicValue`).
 */
const influencedTargets = (
  rt: OracleRuntime,
  obligation: UnknownObligation
): readonly string[] => {
  const targets = new Set<string>();
  const rules = new Set<RuleId>();

  for (const subject of obligation.influenceScope) {
    if (subject.kind === 'style-target') targets.add(String(subject.target));
    else if (subject.kind === 'component') targets.add(subject.component);
    else if (subject.kind === 'rule' || subject.kind === 'declaration') {
      rules.add(subject.rule);
    }
  }

  if (rules.size > 0) {
    const universe = rt.host.universe.universe();
    for (const id of rules) {
      const rule = universe.ruleById(id);
      for (const component of rt.host.identity.components()) {
        if (ownsRule(component, rule)) targets.add(component.id);
      }
    }
  }

  return Array.from(targets).sort();
};

export const runRefine = (
  rt: OracleRuntime,
  request: RefineRequest
): ProbeResult => {
  const obligation = rt.obligations.get(asObligationId(request.obligation));
  if (obligation === undefined) {
    throw new TypeError(
      `refine: unknown obligation '${request.obligation}' — ` +
        `registered ids: ${rt.obligations
          .all()
          .map((known) => known.id)
          .sort()
          .join(', ')}`
    );
  }

  const world = rt.worldOf(request.world);
  const policy = request.policy ?? {};
  const maxBranches = policy.maxBranches ?? rt.budget.maxBranchForks ?? 8;
  const branchSplit = obligation.dischargeOptions.some(
    (option) => option.kind === 'branch-split'
  );
  const axis =
    branchSplit && policy.allowBranchSplit !== false
      ? forkableAxis(obligation, world, maxBranches)
      : undefined;
  const targets = influencedTargets(rt, obligation);

  return rt.run(
    {
      world,
      scope: 'definition',
      objective: { kind: 'discharge', obligation: obligation.id },
      budget: rt.budget,
    },
    (stateId, probeWorld) => {
      const obligationsBefore = rt.obligationCount();
      const facts: RenderFact[] = [];
      const assumptions = new Set<string>();
      const operations: SuggestedOperation[] = [];
      let newFacts = 0;

      if (axis !== undefined && targets.length > 0) {
        for (const value of axis.values) {
          const branchWorld = applyDeltas(probeWorld, [
            {
              kind: 'pin-dimension-domain',
              dimension: axis.dimension,
              domain: { kind: 'finite', values: [value] },
            },
          ]);
          const before = rt.factCount(branchWorld);

          for (const target of targets) {
            const reading = readCascade(
              rt,
              branchWorld,
              target,
              { [axis.dimension]: value },
              eq(axis.dimension, value)
            );
            facts.push(...reading.facts);
            for (const assumption of reading.assumptions) {
              assumptions.add(assumption);
            }
          }
          newFacts += rt.factCount(branchWorld) - before;
        }

        operations.push({
          kind: 'inspect',
          description:
            `inspect the influenced targets (${listOf(targets)}) under each ` +
            `${axis.dimension} branch to read the per-branch winners in full`,
          expectedInformationGain: 'MEDIUM',
        });

        return {
          probeStateId: stateId,
          worldId: worldId(probeWorld),
          verdict: 'ESTABLISHED',
          summary:
            `Discharged ${obligation.id} (${obligation.effectClass}) by ` +
            `branch split on ${axis.dimension} ∈ {${axis.values
              .map(String)
              .join(', ')}}: ${plural(axis.values.length, 'branch')} × ${plural(
              targets.length,
              'influenced target'
            )} produced ${plural(facts.length, 'guarded fact')}. ` +
            'The unknown is replaced by a case analysis over the declared ' +
            'domain, not by a measurement — each fact carries the binding ' +
            'it holds under in its guard.',
          facts,
          assumptions: Array.from(assumptions),
          unknowns: [],
          coverage: rt.coverage(axis.values.length, axis.values.length),
          knowledgeDelta: rt.delta({
            newFacts,
            precisionImprovements: facts.length,
            newObligations: rt.obligationCount() - obligationsBefore,
          }),
          nextOperations: dedupeOperations(operations),
        };
      }

      const options = byCost(obligation.dischargeOptions);
      const cheapest = options[0];
      for (const option of options) {
        operations.push({
          kind: `discharge:${option.kind}`,
          description: `${option.description}${
            option.automated ? ' (automated)' : ' (manual in this phase)'
          }`,
          expectedInformationGain: option.automated ? 'HIGH' : 'MEDIUM',
        });
      }

      const why =
        branchSplit && axis === undefined
          ? "no finite axis of this world's domain appears in the " +
            `obligation's guard (guard dimensions: ${listOf(
              referencedDimensions(obligation.guard)
            )}), so there is nothing to split on`
          : cheapest === undefined
            ? 'the obligation declares no discharge procedure at all'
            : `the cheapest sound procedure is '${cheapest.kind}': ` +
              `${cheapest.description}` +
              (cheapest.automated
                ? ''
                : ' — not automatable here (browser context capsules are ' +
                  'declared but not implemented in this phase)');

      return {
        probeStateId: stateId,
        worldId: worldId(probeWorld),
        verdict: 'CONDITIONAL',
        summary:
          `${obligation.id} (${obligation.effectClass}) remains open: ` +
          `${obligation.reason}. It was not discharged because ${why}. ` +
          `${plural(
            options.length,
            'discharge option'
          )} are listed in cost order; the influence scope is ` +
          `${listOf(targets.length === 0 ? ['(no style targets)'] : targets)}.`,
        facts,
        assumptions: Array.from(assumptions),
        unknowns: [obligation],
        coverage: rt.coverage(0, 0),
        knowledgeDelta: rt.delta({
          newObligations: rt.obligationCount() - obligationsBefore,
        }),
        nextOperations: dedupeOperations(operations),
      };
    }
  );
};
