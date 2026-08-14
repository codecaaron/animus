import type { ScenarioDomain, ScenarioPoint } from '../core/scenario';
import type { ComponentRecord } from '../providers/identity';

/**
 * The many-place model (PLACES.md §2): invocations found in real source,
 * places built from their structural context, and ancestor axes bound per
 * place. Bindings decided by an observation (PLACES.md §5) carry `evidence`
 * so observation authority stays visible wherever the answer flows.
 */

export interface InvocationRef {
  file: string;
  ordinal: number;
  span: readonly [number, number];
  component: ComponentRecord;
}

export type OpenReason =
  | 'opaque-component'
  | 'dynamic-attribute'
  | 'spread-attributes'
  | 'stateful-pseudo'
  | 'unmodeled-relation';

/** Where an observation came from — recorded with every discharge. */
export type ObservationSource = 'dom' | 'ssr' | 'classes';

export interface AxisBinding {
  axis: string;
  state: 'established' | 'refuted' | 'open';
  reason?: OpenReason;
  /** The ancestor that establishes the axis or opens the question. */
  witness?: { file: string; ordinal: number; tag: string };
  /** Present when an observation, not static structure, decided the state. */
  evidence?: { source: ObservationSource; note?: string };
}

/**
 * A component-like tag the analysis cannot attribute to one component —
 * surfaced instead of silently dropped (seam S4's honesty boundary).
 */
export interface UnresolvedInvocation {
  file: string;
  ordinal: number;
  span: readonly [number, number];
  tag: string;
  reason: 'ambiguous-binding';
  /** The component ids the binding could refer to. */
  candidates: readonly string[];
  /** The import specifier that could not decide, when one exists. */
  specifier?: string;
}

export interface Place {
  invocation: InvocationRef;
  bindings: readonly AxisBinding[];
  /** What a refutation is scoped to — never silently assumed. */
  assumptions: readonly string[];
  /** The scenario override pinning every decided axis. */
  pinned: ScenarioDomain;
  point: ScenarioPoint;
}
