import type { ObligationId, TargetId } from '../core/identity';
import type { Predicate } from '../core/predicate';
import type { AbstractValue } from '../core/value';

/**
 * Provider 3 (DESIGN §9), Phase 2+: a symbolic description of the host tree.
 *
 * The tree language is deliberately *symbolic* — conditionals stay as guards
 * and repetition stays as an abstract count, so a tree describes every render
 * of a component rather than one observed render. Nothing derives these yet;
 * the interface is fixed now so geometry questions can already produce
 * addressable obligations instead of fabricated numbers.
 */
export interface HostNode {
  kind: 'host';
  tag: string;
  children: readonly RenderTree[];
  classes?: readonly string[];
  target?: TargetId;
}

export interface TextNode {
  kind: 'text';
  content: AbstractValue<string>;
}

export interface SequenceNode {
  kind: 'sequence';
  items: readonly RenderTree[];
}

export interface ChoiceNode {
  kind: 'choice';
  guard: Predicate;
  consequent: RenderTree;
  alternate?: RenderTree;
}

export interface RepeatNode {
  kind: 'repeat';
  count: AbstractValue<number>;
  item: RenderTree;
}

export interface PortalNode {
  kind: 'portal';
  child: RenderTree;
  hostSelector?: string;
}

/** A subtree the model declines to describe — always paired with a reason. */
export interface OpaqueNode {
  kind: 'opaque';
  reason: string;
  obligation?: ObligationId;
}

export type RenderTree =
  | HostNode
  | TextNode
  | SequenceNode
  | ChoiceNode
  | RepeatNode
  | PortalNode
  | OpaqueNode;

export interface RenderTreeProvider {
  treeFor(component: string): RenderTree | undefined;
}
