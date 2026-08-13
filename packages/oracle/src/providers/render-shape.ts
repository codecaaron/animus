import type { ObligationId, TargetId } from '../core/identity';
import type { Predicate } from '../core/predicate';
import type { AbstractValue } from '../core/value';

/**
 * Provider 3 (DESIGN §9), Phase 2+: a symbolic description of the host tree.
 *
 * The shape language is deliberately *symbolic* — conditionals stay as guards
 * and repetition stays as an abstract count, so a shape describes every render
 * of a component rather than one observed render. Nothing derives these yet;
 * the interface is fixed now so geometry questions can already produce
 * addressable obligations instead of fabricated numbers.
 */
export interface HostNode {
  kind: 'host';
  tag: string;
  children: readonly RenderShape[];
  classes?: readonly string[];
  target?: TargetId;
}

export interface TextNode {
  kind: 'text';
  content: AbstractValue<string>;
}

export interface SequenceShape {
  kind: 'sequence';
  items: readonly RenderShape[];
}

export interface ChoiceShape {
  kind: 'choice';
  guard: Predicate;
  consequent: RenderShape;
  alternate?: RenderShape;
}

export interface RepeatShape {
  kind: 'repeat';
  count: AbstractValue<number>;
  item: RenderShape;
}

export interface PortalShape {
  kind: 'portal';
  child: RenderShape;
  hostSelector?: string;
}

/** A subtree the model declines to describe — always paired with a reason. */
export interface OpaqueNode {
  kind: 'opaque';
  reason: string;
  obligation?: ObligationId;
}

export type RenderShape =
  | HostNode
  | TextNode
  | SequenceShape
  | ChoiceShape
  | RepeatShape
  | PortalShape
  | OpaqueNode;

export interface RenderShapeProvider {
  shapeFor(component: string): RenderShape | undefined;
}
