import type { ScenarioDomain, ScenarioPoint } from '../core/scenario';

/**
 * `cuts()` must list every numeric threshold a modeled rule condition can
 * test; a missing one makes cell enumeration stop being a proof.
 */
export interface ScenarioProvider {
  dimensions(): ScenarioDomain;
  cuts(): Readonly<Record<string, readonly number[]>>;
  namedScenarios(): Readonly<Record<string, ScenarioPoint>>;
}
