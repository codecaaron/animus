import type { ScenarioDomain, ScenarioPoint } from '../core/scenario';

/**
 * Provider 5 (DESIGN §9): the declared scenario axes.
 *
 * `cuts()` returns the numeric thresholds that must partition each interval
 * dimension — the theme's breakpoints, typically. Every threshold any modeled
 * rule condition can test has to appear here, otherwise the cell invariant of
 * `enumerateCells` no longer covers those conditions and cell-sampling stops
 * being a proof.
 */
export interface ScenarioProvider {
  dimensions(): ScenarioDomain;
  cuts(): Readonly<Record<string, readonly number[]>>;
  namedScenarios(): Readonly<Record<string, ScenarioPoint>>;
}
