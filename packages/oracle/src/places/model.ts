import type { ScenarioDomain, ScenarioPoint } from '../core/scenario';
import type { ComponentRecord } from '../providers/identity';

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

export type ObservationSource = 'dom' | 'ssr' | 'classes';

export interface AxisBinding {
  axis: string;
  state: 'established' | 'refuted' | 'open';
  reason?: OpenReason;
  witness?: { file: string; ordinal: number; tag: string };
  evidence?: { source: ObservationSource; note?: string };
}

export interface UnresolvedInvocation {
  file: string;
  ordinal: number;
  span: readonly [number, number];
  tag: string;
  reason: 'ambiguous-binding';
  candidates: readonly string[];
  specifier?: string;
}

export interface Place {
  invocation: InvocationRef;
  bindings: readonly AxisBinding[];
  assumptions: readonly string[];
  pinned: ScenarioDomain;
  point: ScenarioPoint;
}
