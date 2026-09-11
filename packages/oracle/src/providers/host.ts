import type { UnknownObligation } from '../core/obligation';
import type { ProgramRevision } from '../core/world';
import type { ComponentContractProvider } from './component-contract';
import type { DependencyProvider } from './dependency';
import type { IdentityProvider } from './identity';
import type { RenderTreeProvider } from './render-tree';
import type { ScenarioProvider } from './scenario';
import type { StyleUniverseProvider } from './style-universe';
import type { TokenProvider } from './tokens';

export type HostObligation = Omit<UnknownObligation, 'id'>;

export interface OracleHost {
  program: ProgramRevision;
  universe: StyleUniverseProvider;
  scenarios: ScenarioProvider;
  identity: IdentityProvider;
  dependencies: DependencyProvider;
  tokens?: TokenProvider;
  obligations?(): readonly HostObligation[];
  trees?: RenderTreeProvider;
  contracts?: ComponentContractProvider;
}
