/**
 * `@animus-ui/oracle` engines — the six operations of DESIGN §6 as
 * projections of one cascade-level fact substrate, plus the machinery they
 * are built from (cascade semantics, speculation views, the semantic-diff
 * comparator and render-equivalence partitioning).
 *
 * The package root wires `createOracle` into the public surface; everything
 * else here is exported because the CLI, the protocol layer and the host
 * adapters legitimately need the same primitives the engines use.
 */

export { createOracle } from './oracle';
export type { EquivalenceRequest, Oracle } from './oracle';

export {
  createRuntime,
  DEFAULT_ENVIRONMENT,
  DEFAULT_MAX_CELLS,
} from './runtime';
export type { OracleOptions, OracleRuntime } from './runtime';

export {
  activeCandidates,
  activeRuleIds,
  analyzeCascade,
  buildConditionalFact,
  buildDefeatedFact,
  buildInheritedFact,
  buildWinnerFact,
  conditionalCandidates,
  declarationSubject,
  defeatReasonFor,
  describeDefeat,
  describeOrigin,
  effectiveGuard,
  failingConjuncts,
  GLOBAL_LAYER,
  INHERITABLE_PROPERTIES,
  isCandidateSelector,
  pointGuard,
  provenanceOf,
  pseudoElementOf,
  resolveDeclarationValue,
  simplifyAtPoint,
  specificityOf,
  styleTargetSubject,
  subjectsForProperty,
  subjectsOf,
  variableReferences,
  winnerOf,
} from './cascade';
export type {
  BuiltFact,
  CascadeAnalysis,
  CascadeCandidate,
  CascadeContext,
  DeclarationCandidate,
  DefeatedDeclaration,
  DefeatReason,
  InheritedOutcome,
  PropertyOutcome,
  ResolvedValue,
  Specificity,
} from './cascade';

export { speculate } from './speculate';
export type { SpeculationView } from './speculate';

export {
  cellCount,
  cellsOf,
  harvestCuts,
  mergeCuts,
  scopedDomain,
  sharedDomain,
} from './cells';
export type { Cuts, HarvestedCuts } from './cells';

export {
  activeRuleFingerprint,
  partitionCells,
  renderEquivalenceClasses,
} from './equivalence';
export type { RenderEquivalence, RenderEquivalenceClass } from './equivalence';

export {
  addedInterventions,
  affectedRulesOf,
  compareAtCell,
  focalFacts,
  ownsRule,
  runDiff,
  subjectsOfDeltas,
  summarizeDiff,
  sweepWorlds,
  toSemanticDiff,
} from './diff';
export type {
  ComparisonSide,
  DiffRequest,
  SemanticDiff,
  SemanticDiffEntry,
  SemanticDiffKind,
  SweepRequest,
  SweepResult,
} from './diff';

export { readCascade, runInspect, summarizeCascade } from './inspect';
export type { CascadeReading, InspectRequest } from './inspect';

export { runExplain } from './explain';
export type { ExplainRequest, OracleSymptom } from './explain';

export { runSimulate } from './simulate';
export type { SimulateRequest } from './simulate';

export { assertionLabel, runProve } from './prove';
export type { OracleAssertion, ProveRequest } from './prove';

export { runRefine } from './refine';
export type { RefinePolicy, RefineRequest } from './refine';

export {
  byCost,
  dedupeOperations,
  dischargeOperations,
  forkOperations,
  removalOperation,
  replacementOperation,
  zeroDelta,
} from './result';

export { describeCell, describePoint, listOf, plural } from './format';
