import type { UnknownObligation } from '../core/obligation';
import type { ProgramRevision } from '../core/world';
import type { ComponentContractProvider } from './component-contract';
import type { DependencyProvider } from './dependency';
import type { IdentityProvider } from './identity';
import type { RenderTreeProvider } from './render-tree';
import type { ScenarioProvider } from './scenario';
import type { StyleUniverseProvider } from './style-universe';
import type { TokenProvider } from './tokens';

/**
 * The whole host boundary (DESIGN §9). The quality of each provider bounds how
 * *strong* derivable facts can be; it never bounds their soundness — a thin
 * provider yields obligations and `OUTSIDE_MODEL` residuals, not guesses. The
 * two Phase 2+ providers are optional for exactly that reason.
 */
/**
 * An obligation as a host declares it — the facade registers it and owns the
 * content-addressed id.
 */
export type HostObligation = Omit<UnknownObligation, 'id'>;

export interface OracleHost {
  program: ProgramRevision;
  universe: StyleUniverseProvider;
  scenarios: ScenarioProvider;
  identity: IdentityProvider;
  dependencies: DependencyProvider;
  tokens?: TokenProvider;
  /** Unknowns the host already knows about (dynamic values, unmodeled
   * selector structure, geometry-coupled conditions). */
  obligations?(): readonly HostObligation[];
  trees?: RenderTreeProvider;
  contracts?: ComponentContractProvider;
}
