/**
 * Envelope assembly: coverage, knowledge deltas and the `nextOperations` list.
 *
 * DESIGN §5 requires every answer to expose what it learned and what would
 * produce *new* information — the anti-loop half of the contract. These
 * helpers keep those fields concrete (named rules, named dimensions, named
 * obligations) rather than generic advice, because a suggestion an agent
 * cannot execute verbatim is the same as no suggestion.
 */

import { plural } from './format';

import type { DischargeProcedure, UnknownObligation } from '../core/obligation';
import type { KnowledgeDelta, SuggestedOperation } from '../core/probe';
import type { ScenarioDomain } from '../core/scenario';
import type { CascadeAnalysis, DeclarationCandidate } from './cascade';

/** Cheapest sound procedure first — `refine` reports options in order. */
const DISCHARGE_COST: Readonly<Record<DischargeProcedure['kind'], number>> = {
  'partial-evaluation': 0,
  'branch-split': 1,
  'fixture-lookup': 2,
  'contract-application': 3,
  'manual-declaration': 4,
  'context-capsule-measurement': 5,
};

const dischargeCost = (procedure: DischargeProcedure): number =>
  DISCHARGE_COST[procedure.kind];

export const byCost = (
  options: readonly DischargeProcedure[]
): readonly DischargeProcedure[] =>
  [...options].sort((a, b) => dischargeCost(a) - dischargeCost(b));

export const dedupeOperations = (
  operations: readonly SuggestedOperation[]
): readonly SuggestedOperation[] => {
  const seen = new Map<string, SuggestedOperation>();
  for (const operation of operations) {
    const key = `${operation.kind}|${operation.description}`;
    if (seen.has(key)) continue;
    seen.set(key, operation);
  }
  return Array.from(seen.values());
};

export const removalOperation = (
  declaration: DeclarationCandidate
): SuggestedOperation => ({
  kind: 'simulate-removal',
  description:
    `simulate removing ${declaration.candidate.rule.id}#` +
    `${declaration.declaration.property} — the winning declaration`,
  expectedInformationGain: 'HIGH',
});

export const replacementOperation = (
  declaration: DeclarationCandidate,
  value: string
): SuggestedOperation => ({
  kind: 'simulate-replacement',
  description:
    `simulate replacing ${declaration.candidate.rule.id}#` +
    `${declaration.declaration.property} with '${value}' — ` +
    'the expected value',
  expectedInformationGain: 'HIGH',
});

/**
 * One suggestion per axis a candidate rule tests but this point leaves free.
 * An axis the world never declared is the stronger signal — no fork can
 * decide it, the scenario provider has to grow first — so it is reported
 * separately.
 */
export const forkOperations = (
  analysis: CascadeAnalysis,
  domain: ScenarioDomain
): readonly SuggestedOperation[] => {
  const atPoint = new Map<string, number>();
  const inWorld = new Map<string, number>();

  for (const candidate of analysis.candidates) {
    for (const dim of candidate.unboundAtPoint) {
      atPoint.set(dim, (atPoint.get(dim) ?? 0) + 1);
    }
    for (const dim of candidate.unboundInWorld) {
      inWorld.set(dim, (inWorld.get(dim) ?? 0) + 1);
    }
  }

  const operations: SuggestedOperation[] = [];

  for (const dim of Array.from(atPoint.keys()).sort()) {
    const declared = domain[dim];
    if (declared === undefined || declared.kind !== 'finite') continue;
    operations.push({
      kind: 'fork-dimension',
      description:
        `fork on ${dim} ∈ {${declared.values
          .map(String)
          .join(', ')}} — unbound at this point and tested by ` +
        `${plural(atPoint.get(dim) as number, 'candidate rule')}`,
      expectedInformationGain: 'MEDIUM',
    });
  }

  for (const dim of Array.from(inWorld.keys()).sort()) {
    operations.push({
      kind: 'declare-dimension',
      description:
        `declare ${dim} in the scenario domain — ` +
        `${plural(
          inWorld.get(dim) as number,
          'candidate rule'
        )} is guarded by it and this world cannot decide them`,
      expectedInformationGain: 'HIGH',
    });
  }

  return operations;
};

export const dischargeOperations = (
  unknowns: readonly UnknownObligation[]
): readonly SuggestedOperation[] =>
  unknowns.map((unknown) => {
    const cheapest = byCost(unknown.dischargeOptions)[0];
    return {
      kind: 'refine',
      description:
        `refine ${unknown.id} (${unknown.effectClass}) — ${unknown.reason}` +
        (cheapest === undefined
          ? ''
          : ` · cheapest procedure: ${cheapest.kind}`),
      expectedInformationGain: cheapest?.automated === true ? 'HIGH' : 'MEDIUM',
    };
  });

export const zeroDelta = (): KnowledgeDelta => ({
  newFacts: 0,
  precisionImprovements: 0,
  candidatesEliminated: 0,
  newObligations: 0,
});
