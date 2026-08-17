/**
 * `@animus-ui/oracle` — the canonical substrate (DESIGN.md §10).
 *
 * Everything here is host-independent: values and authorities, guards and
 * scenario partitions, worlds and deltas, the fact graph, obligations, the
 * probe envelope with its fixpoint ledger, the evidence ledger, and the six
 * provider interfaces a host implements. Engines and adapters build on this
 * surface; nothing in it reads a clock, a filesystem, or a random source.
 */

export {
  asDependencyId,
  asEvidenceId,
  asFactId,
  asObligationId,
  asProbeStateId,
  asRuleId,
  asTargetId,
  asWorldId,
  canonicalJson,
  stableHash,
} from './core/identity';
export type {
  DependencyId,
  EvidenceId,
  FactId,
  ObligationId,
  ProbeStateId,
  RuleId,
  TargetId,
  WorldId,
} from './core/identity';

export { countCells, enumerateCells } from './core/scenario';
export type {
  DimensionDomain,
  DimensionValue,
  ScenarioCell,
  ScenarioDomain,
  ScenarioPoint,
} from './core/scenario';

export {
  and,
  collectCuts,
  describePredicate,
  eq,
  evalPredicate,
  FALSE,
  inSet,
  not,
  or,
  range,
  referencedDimensions,
  satisfiableOverDomain,
  TRUE,
} from './core/predicate';
export type { Predicate, RangeOptions } from './core/predicate';

export {
  describeValue,
  exact,
  finiteSet,
  piecewise,
  precisionRank,
  unknownValue,
  valueEquals,
} from './core/value';
export type { AbstractValue, PiecewiseCase } from './core/value';

export { authorityStrength } from './core/authority';
export type { FactAuthority } from './core/authority';

export { FactGraph, subjectKey } from './core/fact';
export type {
  DerivationEdge,
  RenderFact,
  RenderSubject,
  SourceRef,
} from './core/fact';

export { ObligationRegistry } from './core/obligation';
export type {
  DischargeProcedure,
  ObligationEffectClass,
  UnknownObligation,
} from './core/obligation';

export {
  applyDeltas,
  describeDelta,
  MODEL_VERSION,
  worldId,
} from './core/world';
export type {
  EnvironmentProfile,
  ProgramRevision,
  RenderWorld,
  WorldDelta,
} from './core/world';

export { ProbeLedger, probeStateId } from './core/probe';
export type {
  AssertionSpec,
  CausalFinding,
  CounterexampleWitness,
  CoverageReport,
  KnowledgeDelta,
  ProbeBudget,
  ProbeObjective,
  ProbeResult,
  ProbeScope,
  ProbeVerdict,
  RenderProbe,
  SuggestedOperation,
  SymptomSpec,
} from './core/probe';

export { EvidenceLedger } from './core/evidence';
export type { RenderEvidence } from './core/evidence';

export { ANIMUS_LAYER_ORDER } from './providers/style-universe';
export type {
  DeclarationRecord,
  RuleOrigin,
  SelectorModel,
  StyleRuleRecord,
  StyleUniverse,
  StyleUniverseProvider,
} from './providers/style-universe';

export type { ScenarioProvider } from './providers/scenario';

export type {
  ComponentRecord,
  IdentityProvider,
  TargetResolution,
} from './providers/identity';

export type { DependencyProvider } from './providers/dependency';

export type {
  ChoiceNode,
  HostNode,
  OpaqueNode,
  PortalNode,
  RenderTree,
  RenderTreeProvider,
  RepeatNode,
  SequenceNode,
  TextNode,
} from './providers/render-tree';

export type {
  ComponentContractProvider,
  ComponentRenderContract,
} from './providers/component-contract';

export type { HostObligation, OracleHost } from './providers/host';

export type {
  TokenDefinition,
  TokenProvider,
  TokenResolution,
} from './providers/tokens';

export { createInMemoryHost } from './providers/in-memory';
export type { InMemoryHostConfig } from './providers/in-memory';

export * from './engines';
export * from './host/animus';
export * from './places';
