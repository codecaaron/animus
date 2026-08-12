import type { ProgramRevision } from '../core/world';
import type { ComponentContractProvider } from './component-contract';
import type { DependencyProvider } from './dependency';
import type { IdentityProvider } from './identity';
import type { RenderShapeProvider } from './render-shape';
import type { ScenarioProvider } from './scenario';
import type { StyleUniverseProvider } from './style-universe';
import type { TokenProvider } from './tokens';

/**
 * The whole host boundary (DESIGN §9). The quality of each provider bounds how
 * *strong* derivable facts can be; it never bounds their soundness — a thin
 * provider yields obligations and `OUTSIDE_MODEL` residuals, not guesses. The
 * two Phase 2+ providers are optional for exactly that reason.
 */
export interface OracleHost {
  program: ProgramRevision;
  universe: StyleUniverseProvider;
  scenarios: ScenarioProvider;
  identity: IdentityProvider;
  dependencies: DependencyProvider;
  tokens?: TokenProvider;
  shape?: RenderShapeProvider;
  contracts?: ComponentContractProvider;
}
