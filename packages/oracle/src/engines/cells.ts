/**
 * Scenario-domain plumbing: which axes a question is quantified over, and which
 * numeric thresholds have to partition them.
 *
 * The cell invariant in `core/scenario` is conditional — sampling one
 * representative per cell decides a guard only if every threshold that guard
 * mentions is a cut. So every engine that quantifies harvests the thresholds
 * out of the candidate rules' own guards first (`harvestCuts`); a breakpoint a
 * rule tests but the theme never declared would otherwise split a cell and turn
 * a "proof" into a sample.
 */

import { collectCuts } from '../core/predicate';
import { countCells, enumerateCells } from '../core/scenario';
import { analyzeCascade } from './cascade';

import type { ScenarioCell, ScenarioDomain } from '../core/scenario';
import type { RenderWorld } from '../core/world';
import type { TargetResolution } from '../providers/identity';
import type { CascadeContext } from './cascade';

/** `variant:<c>:<p>` / `state:<c>:<n>` / `prop:<c>:<n>` — per-component. */
const SCOPED_DIMENSION = /^(variant|state|prop):/;

export type Cuts = Readonly<Record<string, readonly number[]>>;

/**
 * The axes that can change this target's answer: the target's own declared
 * dimensions, each narrowed to the world's domain where the world has one (a
 * `force-dimension` intervention lives here), plus any explicit override.
 * Another component's variant axis cannot alter this target's classes, so
 * leaving it out shrinks the cell count without weakening the quantification.
 */
export const scopedDomain = (
  resolution: TargetResolution,
  world: RenderWorld,
  override?: ScenarioDomain
): ScenarioDomain => {
  const domain: Record<string, ScenarioDomain[string]> = {};
  for (const dim of Object.keys(resolution.dimensions).sort()) {
    domain[dim] = world.scenario[dim] ?? resolution.dimensions[dim];
  }
  if (override !== undefined) {
    for (const dim of Object.keys(override).sort()) {
      domain[dim] = override[dim];
    }
  }
  return domain;
};

/** The axes every component shares — viewport, mode, anything unscoped. */
export const sharedDomain = (world: RenderWorld): ScenarioDomain => {
  const domain: Record<string, ScenarioDomain[string]> = {};
  for (const dim of Object.keys(world.scenario).sort()) {
    if (SCOPED_DIMENSION.test(dim)) continue;
    domain[dim] = world.scenario[dim];
  }
  return domain;
};

export const mergeCuts = (a: Cuts, b: Cuts): Cuts => {
  const merged: Record<string, number[]> = {};
  for (const source of [a, b]) {
    for (const dim of Object.keys(source)) {
      const values = new Set([...(merged[dim] ?? []), ...source[dim]]);
      merged[dim] = Array.from(values).sort((x, y) => x - y);
    }
  }
  return merged;
};

export interface HarvestedCuts {
  cuts: Cuts;
  /** Thresholds found on rule guards that the scenario provider omitted. */
  discovered: readonly string[];
  /** True when the pre-harvest partition was already too large to walk. */
  truncated: boolean;
}

/**
 * Fold every candidate rule's guard thresholds into the declared cuts.
 *
 * Candidacy is structural (class membership), so one pass over the *declared*
 * partition already sees every rule that can apply anywhere in the domain —
 * including the ones whose guards test a threshold that pass never sampled.
 * Refining a partition is always sound, so the second pass over the merged cuts
 * is strictly stronger than the first.
 */
export const harvestCuts = (
  ctx: CascadeContext,
  resolution: TargetResolution,
  domain: ScenarioDomain,
  declared: Cuts,
  limit: number
): HarvestedCuts => {
  if (countCells(domain, declared) > limit) {
    return { cuts: declared, discovered: [], truncated: true };
  }

  const seen = new Set<string>();
  let harvested: Cuts = {};

  for (const cell of enumerateCells(domain, declared)) {
    for (const candidate of analyzeCascade(ctx, resolution, cell.point)
      .candidates) {
      if (seen.has(candidate.rule.id)) continue;
      seen.add(candidate.rule.id);
      harvested = mergeCuts(harvested, collectCuts(candidate.guard));
    }
  }

  const discovered: string[] = [];
  for (const dim of Object.keys(harvested).sort()) {
    const known = new Set(declared[dim] ?? []);
    for (const value of harvested[dim]) {
      if (!known.has(value)) discovered.push(`${dim} = ${value}`);
    }
  }

  return {
    cuts: mergeCuts(declared, harvested),
    discovered,
    truncated: false,
  };
};

export const cellsOf = (
  domain: ScenarioDomain,
  cuts: Cuts
): readonly ScenarioCell[] => enumerateCells(domain, cuts);

export const cellCount = (domain: ScenarioDomain, cuts: Cuts): number =>
  countCells(domain, cuts);
