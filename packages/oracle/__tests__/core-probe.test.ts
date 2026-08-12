import { describe, expect, it } from 'vitest';

import { asTargetId, asWorldId } from '../src/core/identity';
import { ProbeLedger, probeStateId } from '../src/core/probe';
import { MODEL_VERSION, applyDeltas, worldId } from '../src/core/world';

import type { ProbeResult, RenderProbe } from '../src/core/probe';
import type { RenderWorld } from '../src/core/world';

const world: RenderWorld = {
  program: { kind: 'synthetic', hash: 'p1' },
  modelVersion: MODEL_VERSION,
  scenario: { mode: { kind: 'finite', values: ['light', 'dark'] } },
  environment: { name: 'chromium-stable', assumptions: {} },
  interventions: [],
  evidenceRevision: 'e0',
};

const target = asTargetId('src/Alert.tsx::Alert');

const probe: RenderProbe = {
  world,
  target,
  scope: 'callsite',
  scenarioPoint: { mode: 'dark' },
  objective: {
    kind: 'fact',
    subject: { kind: 'style-target', target },
    properties: ['padding'],
  },
  budget: { maxCells: 64 },
};

describe('probeStateId', () => {
  it('is identical for identical probes, whatever the key order', () => {
    const twin: RenderProbe = {
      budget: { maxCells: 64 },
      objective: {
        properties: ['padding'],
        subject: { target, kind: 'style-target' },
        kind: 'fact',
      },
      scenarioPoint: { mode: 'dark' },
      scope: 'callsite',
      target,
      world: { ...world },
    };
    expect(probeStateId(twin)).toBe(probeStateId(probe));
  });

  it('moves when the evidence revision moves', () => {
    expect(
      probeStateId({ ...probe, world: { ...world, evidenceRevision: 'e1' } })
    ).not.toBe(probeStateId(probe));
  });

  it('moves when the world, scope, point, objective or budget moves', () => {
    expect(
      probeStateId({
        ...probe,
        world: applyDeltas(world, [
          { kind: 'force-dimension', dimension: 'mode', value: 'dark' },
        ]),
      })
    ).not.toBe(probeStateId(probe));
    expect(probeStateId({ ...probe, scope: 'definition' })).not.toBe(
      probeStateId(probe)
    );
    expect(
      probeStateId({ ...probe, scenarioPoint: { mode: 'light' } })
    ).not.toBe(probeStateId(probe));
    expect(
      probeStateId({
        ...probe,
        objective: { kind: 'diff', against: asWorldId('w2') },
      })
    ).not.toBe(probeStateId(probe));
    expect(probeStateId({ ...probe, budget: { maxCells: 128 } })).not.toBe(
      probeStateId(probe)
    );
  });

  it('ignores absent optional inputs consistently', () => {
    const lean: RenderProbe = {
      world,
      scope: 'definition',
      objective: { kind: 'fact', subject: { kind: 'world' } },
    };
    expect(probeStateId(lean)).toBe(
      probeStateId({
        ...lean,
        target: undefined,
        scenarioPoint: undefined,
        budget: undefined,
      })
    );
  });
});

describe('ProbeLedger', () => {
  const result: ProbeResult = {
    probeStateId: probeStateId(probe),
    worldId: worldId(world),
    verdict: 'ESTABLISHED',
    summary: 'padding = 12px under mode = dark',
    facts: [],
    assumptions: ['no runtime style writes'],
    unknowns: [],
    coverage: { scenarioCells: 2, cellsEvaluated: 2, outsideModel: [] },
    knowledgeDelta: {
      newFacts: 3,
      precisionImprovements: 1,
      candidatesEliminated: 2,
      newObligations: 1,
    },
    nextOperations: [
      {
        kind: 'prove',
        description: 'quantify over modes',
        expectedInformationGain: 'HIGH',
      },
    ],
  };

  it('records and replays by state id', () => {
    const ledger = new ProbeLedger();
    expect(ledger.seen(result.probeStateId)).toBeUndefined();
    ledger.record(result);
    expect(ledger.seen(result.probeStateId)).toBe(result);
  });

  it('builds a FIXPOINT result that cannot be mistaken for progress', () => {
    const ledger = new ProbeLedger();
    ledger.record(result);
    const untried = [
      {
        kind: 'refine',
        description: 'discharge the intrinsic size obligation',
        expectedInformationGain: 'MEDIUM' as const,
      },
    ];
    const fixpoint = ledger.fixpoint(result, untried);

    expect(fixpoint.verdict).toBe('FIXPOINT');
    expect(fixpoint.previous).toBe(result.probeStateId);
    expect(fixpoint.probeStateId).toBe(result.probeStateId);
    expect(fixpoint.knowledgeDelta).toEqual({
      newFacts: 0,
      precisionImprovements: 0,
      candidatesEliminated: 0,
      newObligations: 0,
    });
    expect(fixpoint.summary).toContain(result.summary);
    expect(fixpoint.nextOperations).toEqual(untried);
    expect(result.verdict).toBe('ESTABLISHED');
  });
});
