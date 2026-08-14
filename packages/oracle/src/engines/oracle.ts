/**
 * The facade: six operations over one substrate.
 *
 * `createOracle` owns the session — probe ledger, obligation registry,
 * evidence ledger and one fact graph per world — so the operations compose
 * the way
 * DESIGN §6 promises: an obligation raised while explaining is the same one
 * `prove` refuses to be PROVED alongside, and repeating any question against an
 * unchanged state returns FIXPOINT instead of a second copy of the answer.
 */

import { runDiff } from './diff';
import { renderEquivalenceClasses } from './equivalence';
import { runExplain } from './explain';
import { runInspect } from './inspect';
import { runProve } from './prove';
import { runRefine } from './refine';
import { createRuntime } from './runtime';
import { runSimulate } from './simulate';

import type { UnknownObligation } from '../core/obligation';
import type { ProbeResult } from '../core/probe';
import type { RenderWorld } from '../core/world';
import type { OracleHost } from '../providers/host';
import type { DiffRequest } from './diff';
import type { RenderEquivalence } from './equivalence';
import type { ExplainRequest } from './explain';
import type { InspectRequest } from './inspect';
import type { ProveRequest } from './prove';
import type { RefineRequest } from './refine';
import type { OracleOptions } from './runtime';
import type { SimulateRequest } from './simulate';

export interface EquivalenceRequest {
  target: string;
  world?: RenderWorld;
}

export interface Oracle {
  /** The world every operation defaults to: host program, declared domain. */
  baselineWorld(): RenderWorld;
  inspect(request: InspectRequest): ProbeResult;
  explain(request: ExplainRequest): ProbeResult;
  simulate(request: SimulateRequest): ProbeResult;
  diff(request: DiffRequest): ProbeResult;
  prove(request: ProveRequest): ProbeResult;
  refine(request: RefineRequest): ProbeResult;
  equivalenceClasses(request: EquivalenceRequest): RenderEquivalence;
  /** Every obligation registered so far — host-declared and engine-raised. */
  obligations(): readonly UnknownObligation[];
}

export const createOracle = (
  host: OracleHost,
  options: OracleOptions = {}
): Oracle => {
  const rt = createRuntime(host, options);

  return {
    baselineWorld: () => rt.baselineWorld(),
    inspect: (request) => runInspect(rt, request),
    explain: (request) => runExplain(rt, request),
    simulate: (request) => runSimulate(rt, request),
    diff: (request) => runDiff(rt, request),
    prove: (request) => runProve(rt, request),
    refine: (request) => runRefine(rt, request),
    equivalenceClasses: (request) =>
      renderEquivalenceClasses(rt, request.target, request.world),
    obligations: () => rt.obligations.all(),
  };
};
