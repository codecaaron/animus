import type { UnknownObligation } from '../core/obligation';
import type { AbstractValue } from '../core/value';
import type { RenderShape } from './render-shape';

/**
 * Provider 4 (DESIGN §9), Phase 2+: what a component *declares* about itself.
 *
 * A contract is an axiom, not a derivation — facts built on one carry
 * `declared-contract` authority so a wrong declaration is visible as such
 * rather than laundered into a proof. `opaqueObligations` is how a component
 * declares its own unknowns up front (ids are assigned by the registry when
 * they are registered, hence the `Omit`).
 */
export interface ComponentRenderContract {
  component: string;
  shape?: RenderShape;
  intrinsic?: {
    inlineSize?: AbstractValue<number>;
    blockSize?: AbstractValue<number>;
  };
  opaqueObligations?: readonly Omit<UnknownObligation, 'id'>[];
}

export interface ComponentContractProvider {
  contractFor(component: string): ComponentRenderContract | undefined;
}
