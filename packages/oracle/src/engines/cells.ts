import { collectCuts } from '../core/predicate';
import {
  countCells,
  enumerateCells,
  isScopedDimension,
} from '../core/scenario';
import { applyDeltas } from '../core/world';
import { candidateGuardsAt } from './cascade';

import type { ScenarioCell, ScenarioDomain } from '../core/scenario';
import type { RenderWorld } from '../core/world';
import type { TargetResolution } from '../providers/identity';
import type { CascadeContext } from './cascade';

export type Cuts = Readonly<Record<string, readonly number[]>>;

export const pinDomain = (
  world: RenderWorld,
  override?: ScenarioDomain
): RenderWorld => {
  if (override === undefined) return world;
  const dimensions = Object.keys(override).sort();
  if (dimensions.length === 0) return world;
  return applyDeltas(
    world,
    dimensions.map((dimension) => ({
      kind: 'pin-dimension-domain' as const,
      dimension,
      domain: override[dimension],
    }))
  );
};

/**
 * Another component's variant axis cannot alter this target's classes, so
 * leaving it out shrinks the cell count without weakening quantification.
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

export const sharedDomain = (world: RenderWorld): ScenarioDomain => {
  const domain: Record<string, ScenarioDomain[string]> = {};
  for (const dim of Object.keys(world.scenario).sort()) {
    if (isScopedDimension(dim)) continue;
    domain[dim] = world.scenario[dim];
  }
  return domain;
};

export const mergeCuts = (a: Cuts, b: Cuts): Cuts => {
  const merged = new Map<string, number[]>();
  for (const source of [a, b]) {
    for (const dim of Object.keys(source)) {
      const values = new Set([...(merged.get(dim) ?? []), ...source[dim]]);
      merged.set(
        dim,
        Array.from(values).sort((x, y) => x - y)
      );
    }
  }
  return Object.fromEntries(merged);
};

export interface HarvestedCuts {
  cuts: Cuts;
  discovered: readonly string[];
  truncated: boolean;
}

/**
 * Candidacy is structural, so one pass over the declared partition already
 * sees every rule that can apply anywhere in the domain.
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
  const collected = new Map<string, Set<number>>();

  for (const cell of enumerateCells(domain, declared)) {
    for (const { rule, guard } of candidateGuardsAt(
      ctx,
      resolution,
      cell.point
    )) {
      if (seen.has(rule.id)) continue;
      seen.add(rule.id);
      const cuts = collectCuts(guard);
      for (const dim of Object.keys(cuts)) {
        const values = collected.get(dim) ?? new Set<number>();
        for (const value of cuts[dim]) values.add(value);
        collected.set(dim, values);
      }
    }
  }

  const harvested: Record<string, number[]> = {};
  for (const [dim, values] of collected) {
    harvested[dim] = Array.from(values).sort((a, b) => a - b);
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
