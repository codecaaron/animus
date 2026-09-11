import type { ObligationId, TargetId } from '../core/identity';
import type { Predicate } from '../core/predicate';
import type { AbstractValue } from '../core/value';

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
