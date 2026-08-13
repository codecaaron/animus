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
import { activeRuleIds, analyzeCascade } from './cascade';
import { cellsOf, harvestCuts, scopedDomain } from './cells';
import { describeCell } from './format';

import type { ScenarioCell, ScenarioPoint } from '../core/scenario';
import type { RenderWorld } from '../core/world';
import type { TargetResolution } from '../providers/identity';
import type { CascadeContext } from './cascade';
import type { OracleRuntime } from './runtime';

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
 * The seventh operation (facade: `equivalenceClasses`), on the same session
 * substrate as the other six: the runtime's cached speculation view, its
 * shared obligation registry (partitioning reads guards only today, but an
 * obligation raised here must not be dropped on the floor the day that
 * changes), and its configured cell budget rather than a private one.
 */
export const renderEquivalenceClasses = (
  rt: OracleRuntime,
  target: string,
  world?: RenderWorld
): RenderEquivalence => {
  const resolution = rt.resolveTarget(target);
  const probeWorld = rt.worldOf(world);
  const ctx = rt.contextFor(probeWorld);

  const domain = scopedDomain(resolution, probeWorld);
  const harvested = harvestCuts(
    ctx,
    resolution,
    domain,
    rt.host.scenarios.cuts(),
    rt.maxCells()
  );
  return partitionCells(ctx, resolution, cellsOf(domain, harvested.cuts));
};
