/**
 * Render-equivalence classes: the partition of a scenario domain into contexts
 * that are indistinguishable *for the question being asked*.
 *
 * At cascade level the answer is determined by which rules are active, so two
 * cells with the same active-rule set are one context class. The partition is
 * therefore query-relative by construction — it is cascade-equivalence, not
 * visual equivalence, and it is what lets `diff` report "3 of 12 context
 * classes affected" instead of a cell count nobody can act on.
 */

import { stableHash } from '../core/identity';
import { ObligationRegistry } from '../core/obligation';
import { activeRuleIds, analyzeCascade } from './cascade';
import { cellsOf, harvestCuts, scopedDomain } from './cells';
import { describeCell } from './format';
import { speculate } from './speculate';

import type { ScenarioCell, ScenarioPoint } from '../core/scenario';
import type { RenderWorld } from '../core/world';
import type { OracleHost } from '../providers/host';
import type { TargetResolution } from '../providers/identity';
import type { CascadeContext } from './cascade';
import type { Cuts } from './cells';

export interface RenderEquivalenceClass {
  representative: ScenarioPoint;
  description: string;
  cellCount: number;
  activeRuleFingerprint: string;
}

export interface RenderEquivalence {
  classes: readonly RenderEquivalenceClass[];
}

export const activeRuleFingerprint = (
  ctx: CascadeContext,
  resolution: TargetResolution,
  point: ScenarioPoint
): string => stableHash(activeRuleIds(analyzeCascade(ctx, resolution, point)));

export const partitionCells = (
  ctx: CascadeContext,
  resolution: TargetResolution,
  cells: readonly ScenarioCell[]
): RenderEquivalence => {
  const classes = new Map<string, RenderEquivalenceClass>();

  for (const cell of cells) {
    const fingerprint = activeRuleFingerprint(ctx, resolution, cell.point);
    const existing = classes.get(fingerprint);
    if (existing === undefined) {
      classes.set(fingerprint, {
        representative: cell.point,
        description: describeCell(cell),
        cellCount: 1,
        activeRuleFingerprint: fingerprint,
      });
      continue;
    }
    classes.set(fingerprint, {
      ...existing,
      cellCount: existing.cellCount + 1,
    });
  }

  return { classes: Array.from(classes.values()) };
};

/**
 * The standalone entry point (facade: `equivalenceClasses`). It builds its own
 * speculation view and obligation registry so it can be called without a
 * running oracle session; nothing it does can raise an obligation, because
 * partitioning reads guards only, never declaration values.
 */
export const renderEquivalenceClasses = (
  host: OracleHost,
  world: RenderWorld,
  target: string,
  cuts: Cuts
): RenderEquivalence => {
  const resolution = host.identity.resolveTarget(target);
  if (resolution === undefined) {
    throw new TypeError(
      `renderEquivalenceClasses: unknown target '${target}' — known ` +
        `components: ${host.identity
          .components()
          .map((component) => component.id)
          .sort()
          .join(', ')}`
    );
  }

  const view = speculate(host, world.interventions);
  const ctx: CascadeContext = {
    universe: view.universe,
    tokens: view.tokens,
    scenario: world.scenario,
    obligations: new ObligationRegistry(),
    dependencies: host.dependencies,
  };

  const domain = scopedDomain(resolution, world);
  const harvested = harvestCuts(ctx, resolution, domain, cuts, 4096);
  return partitionCells(ctx, resolution, cellsOf(domain, harvested.cuts));
};
