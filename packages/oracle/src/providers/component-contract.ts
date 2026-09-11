import type { UnknownObligation } from '../core/obligation';
import type { AbstractValue } from '../core/value';
import type { RenderTree } from './render-tree';

export interface ComponentRenderContract {
  component: string;
  tree?: RenderTree;
  intrinsic?: {
    inlineSize?: AbstractValue<number>;
    blockSize?: AbstractValue<number>;
  };
  opaqueObligations?: readonly Omit<UnknownObligation, 'id'>[];
}

export interface ComponentContractProvider {
  contractFor(component: string): ComponentRenderContract | undefined;
}
