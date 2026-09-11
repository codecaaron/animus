import { asWorldId, stableHash } from './identity';

import type { RuleId, WorldId } from './identity';
import type {
  DimensionDomain,
  DimensionValue,
  ScenarioDomain,
} from './scenario';

export const MODEL_VERSION = 'oracle-0.1';

export interface ProgramRevision {
  kind: 'analysis-artifacts' | 'synthetic';
  hash: string;
  label?: string;
}

export interface EnvironmentProfile {
  name: string;
  assumptions: Readonly<Record<string, string>>;
}

export type WorldDelta =
  | { kind: 'remove-declaration'; rule: RuleId; property: string }
  | {
      kind: 'replace-declaration';
      rule: RuleId;
      property: string;
      value: string;
    }
  | { kind: 'add-declaration'; rule: RuleId; property: string; value: string }
  | { kind: 'replace-token'; token: string; value: string }
  | { kind: 'force-dimension'; dimension: string; value: DimensionValue }
  | {
      kind: 'pin-dimension-domain';
      dimension: string;
      domain: DimensionDomain;
    }
  | { kind: 'assume'; assumption: string; note?: string };

export interface RenderWorld {
  program: ProgramRevision;
  modelVersion: string;
  scenario: ScenarioDomain;
  environment: EnvironmentProfile;
  interventions: readonly WorldDelta[];
  evidenceRevision: string;
}

const worldIds = new WeakMap<RenderWorld, WorldId>();

export const worldId = (world: RenderWorld): WorldId => {
  const cached = worldIds.get(world);
  if (cached !== undefined) return cached;
  const id = asWorldId(stableHash(world));
  worldIds.set(world, id);
  return id;
};

export const applyDeltas = (
  world: RenderWorld,
  deltas: readonly WorldDelta[]
): RenderWorld => {
  const pinned = new Map<string, DimensionDomain>();

  for (const delta of deltas) {
    if (delta.kind === 'force-dimension') {
      pinned.set(delta.dimension, { kind: 'finite', values: [delta.value] });
    } else if (delta.kind === 'pin-dimension-domain') {
      pinned.set(delta.dimension, delta.domain);
    }
  }

  return {
    ...world,
    scenario: { ...world.scenario, ...Object.fromEntries(pinned) },
    interventions: [...world.interventions, ...deltas],
  };
};

export const describeDelta = (d: WorldDelta): string => {
  switch (d.kind) {
    case 'remove-declaration':
      return `remove ${d.property} from rule ${d.rule}`;
    case 'replace-declaration':
      return `set ${d.property} to ${d.value} in rule ${d.rule}`;
    case 'add-declaration':
      return `add ${d.property}: ${d.value} to rule ${d.rule}`;
    case 'replace-token':
      return `replace token ${d.token} with ${d.value}`;
    case 'force-dimension':
      return `force ${d.dimension} = ${String(d.value)}`;
    case 'pin-dimension-domain':
      return d.domain.kind === 'finite'
        ? `pin ${d.dimension} to {${d.domain.values.map(String).join(', ')}}`
        : `pin ${d.dimension} to [${d.domain.min}, ${d.domain.max}]`;
    case 'assume':
      return d.note === undefined
        ? `assume ${d.assumption}`
        : `assume ${d.assumption} (${d.note})`;
  }
};
