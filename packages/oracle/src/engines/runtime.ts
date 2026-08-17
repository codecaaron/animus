/**
 * The session the six operations share: one probe ledger, one obligation
 * registry, one evidence ledger, one fact graph per world.
 *
 * Sharing is what makes the operations projections of a single substrate rather
 * than six independent tools (DESIGN §6): an obligation raised while
 * explaining is the same one `prove` refuses to be PROVED alongside, and a fact
 * derived by `inspect` is already in the world's graph when `simulate` counts
 * what it learned.
 */

import { EvidenceLedger } from '../core/evidence';
import { FactGraph, subjectKey } from '../core/fact';
import { ObligationRegistry } from '../core/obligation';
import { emptyKnowledgeDelta, ProbeLedger, probeStateId } from '../core/probe';
import { MODEL_VERSION, worldId } from '../core/world';
import { speculate } from './speculate';

import type { RenderSubject } from '../core/fact';
import type { ObligationId, ProbeStateId, WorldId } from '../core/identity';
import type { UnknownObligation } from '../core/obligation';
import type {
  CoverageReport,
  KnowledgeDelta,
  ProbeBudget,
  ProbeResult,
  RenderProbe,
} from '../core/probe';
import type { ScenarioPoint } from '../core/scenario';
import type { EnvironmentProfile, RenderWorld } from '../core/world';
import type { OracleHost } from '../providers/host';
import type { TargetResolution } from '../providers/identity';
import type { CascadeContext } from './cascade';
import type { SpeculationView } from './speculate';

export interface OracleOptions {
  environment?: EnvironmentProfile;
  budget?: ProbeBudget;
}

export const DEFAULT_ENVIRONMENT: EnvironmentProfile = Object.freeze({
  name: 'animus-default',
  assumptions: {},
});

/**
 * The default quantification budget. It is a *refusal* threshold, not a
 * sampling threshold: past it, `prove` answers INCONCLUSIVE with the cell count
 * instead of silently checking a subset (DESIGN §8).
 */
export const DEFAULT_MAX_CELLS = 512;

/**
 * The two ways a caller can name a context: a literal point, or the name of a
 * scenario the host declared. Only the literal one is a reference value, which
 * is the whole discrimination — a boxed string is not a name.
 */
const isPointLiteral = (at: ScenarioPoint | string): at is ScenarioPoint =>
  Object(at) === at;

export interface OracleRuntime {
  host: OracleHost;
  environment: EnvironmentProfile;
  budget: ProbeBudget;
  ledger: ProbeLedger;
  obligations: ObligationRegistry;
  evidence: EvidenceLedger;
  baselineWorld(): RenderWorld;
  worldOf(world?: RenderWorld): RenderWorld;
  viewFor(world: RenderWorld): SpeculationView;
  contextFor(world: RenderWorld): CascadeContext;
  graphFor(world: RenderWorld): FactGraph;
  factCount(world: RenderWorld): number;
  resolveTarget(selector: string): TargetResolution;
  resolvePoint(at?: ScenarioPoint | string): ScenarioPoint;
  maxCells(budget?: ProbeBudget): number;
  coverage(scenarioCells: number, cellsEvaluated: number): CoverageReport;
  unknownsFor(
    subjects: readonly RenderSubject[],
    raised: readonly UnknownObligation[]
  ): readonly UnknownObligation[];
  obligationCount(): number;
  delta(partial: Partial<KnowledgeDelta>): KnowledgeDelta;
  run(
    probe: RenderProbe,
    build: (stateId: ProbeStateId, world: RenderWorld) => ProbeResult
  ): ProbeResult;
}

export const createRuntime = (
  host: OracleHost,
  options: OracleOptions = {}
): OracleRuntime => {
  const environment = options.environment ?? DEFAULT_ENVIRONMENT;
  const budget: ProbeBudget = {
    maxCells: DEFAULT_MAX_CELLS,
    ...(options.budget ?? {}),
  };

  const ledger = new ProbeLedger();
  const obligations = new ObligationRegistry();
  const evidence = new EvidenceLedger();
  const graphs = new Map<WorldId, FactGraph>();
  const views = new Map<WorldId, SpeculationView>();

  // Host-declared unknowns are registered up front so that every operation
  // sees the same content-addressed ids the host meant, and so an answer can
  // be CONDITIONAL on a gap nobody has queried yet.
  for (const declared of host.obligations?.() ?? []) {
    obligations.register(declared);
  }

  const baselineWorld = (): RenderWorld => ({
    program: host.program,
    modelVersion: MODEL_VERSION,
    scenario: host.scenarios.dimensions(),
    environment,
    interventions: [],
    evidenceRevision: evidence.revision(),
  });

  const viewFor = (world: RenderWorld): SpeculationView => {
    const id = worldId(world);
    const existing = views.get(id);
    if (existing !== undefined) return existing;
    const created = speculate(host, world.interventions);
    views.set(id, created);
    return created;
  };

  const graphFor = (world: RenderWorld): FactGraph => {
    const id = worldId(world);
    const existing = graphs.get(id);
    if (existing !== undefined) return existing;
    const created = new FactGraph(id);
    graphs.set(id, created);
    return created;
  };

  const runtime: OracleRuntime = {
    host,
    environment,
    budget,
    ledger,
    obligations,
    evidence,
    baselineWorld,
    worldOf: (world) => world ?? baselineWorld(),
    viewFor,
    graphFor,
    factCount: (world) => graphFor(world).size,

    contextFor: (world) => {
      const view = viewFor(world);
      return {
        universe: view.universe,
        tokens: view.tokens,
        scenario: world.scenario,
        obligations,
        dependencies: host.dependencies,
      };
    },

    resolveTarget: (selector) => {
      const resolved = host.identity.resolveTarget(selector);
      if (resolved !== undefined) return resolved;
      throw new TypeError(
        `unknown target '${selector}' — known components: ${host.identity
          .components()
          .map((component) => component.id)
          .sort()
          .join(', ')}`
      );
    },

    resolvePoint: (at) => {
      if (at === undefined) return {};
      if (isPointLiteral(at)) return at;
      const named = host.scenarios.namedScenarios();
      const found = named[at];
      if (found !== undefined) return found;
      const names = Object.keys(named).sort();
      throw new TypeError(
        `unknown named scenario '${at}' — available: ${
          names.length === 0 ? '(none declared)' : names.join(', ')
        }`
      );
    },

    maxCells: (override) =>
      override?.maxCells ?? budget.maxCells ?? DEFAULT_MAX_CELLS,

    coverage: (scenarioCells, cellsEvaluated) => ({
      scenarioCells,
      cellsEvaluated,
      outsideModel: host.universe.universe().exclusions,
    }),

    unknownsFor: (subjects, raised) => {
      const keys = new Set(subjects.map(subjectKey));
      const collected = new Map<ObligationId, UnknownObligation>();
      for (const obligation of obligations.all()) {
        const touches = obligation.influenceScope.some((scope) =>
          keys.has(subjectKey(scope))
        );
        if (touches) collected.set(obligation.id, obligation);
      }
      for (const obligation of raised) {
        collected.set(obligation.id, obligation);
      }
      return Array.from(collected.values()).sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0
      );
    },

    obligationCount: () => obligations.all().length,

    delta: (partial) => ({ ...emptyKnowledgeDelta(), ...partial }),

    /**
     * Fixpoint enforcement (DESIGN §5). A repeated probe never re-runs and
     * never overwrites its own prior record — recording the FIXPOINT answer
     * would make the *next* repetition a fixpoint of a fixpoint and lose the
     * original result the caller is being pointed back at.
     */
    run: (probe, build) => {
      const stateId = probeStateId(probe);
      const prior = ledger.seen(stateId);
      if (prior !== undefined) {
        return ledger.fixpoint(prior, prior.nextOperations);
      }

      const result = build(stateId, probe.world);
      ledger.record(result);
      return result;
    },
  };

  return runtime;
};
