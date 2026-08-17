import { asWorldId, stableHash } from './identity';

import type { RuleId, WorldId } from './identity';
import type {
  DimensionDomain,
  DimensionValue,
  ScenarioDomain,
} from './scenario';

/** The oracle's own semantics version — part of every cache key and state id. */
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

/**
 * A hypothetical edit, applied to a world without touching source. Deltas are
 * data, not patches: `simulate` and `diff` evaluate them, and nothing in the
 * substrate can write them back.
 */
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

/**
 * The world's content address. Every component that can change an answer is in
 * it (program revision, model version, scenario domain, environment
 * assumptions, interventions, evidence revision), which is what makes caching,
 * cross-world comparison and fixpoint detection sound (DESIGN §2).
 *
 * Memoized per object: worlds are immutable by construction (`applyDeltas`
 * always returns a fresh one), and every engine hashes its worlds several
 * times per probe.
 */
export const worldId = (world: RenderWorld): WorldId => {
  const cached = worldIds.get(world);
  if (cached !== undefined) return cached;
  const id = asWorldId(stableHash(world));
  worldIds.set(world, id);
  return id;
};

/**
 * Apply interventions, purely.
 *
 * Every delta is appended to `interventions` so the world's provenance stays
 * complete. Two kinds additionally have a *scenario* meaning the substrate can
 * discharge on its own — `force-dimension` narrows an axis to a single value,
 * `pin-dimension-domain` replaces one outright. The remaining kinds are style
 * universe edits whose interpretation belongs to the engines; recording them
 * here (rather than half-applying them) keeps this function total and keeps
 * the world hash honest about what was requested.
 */
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
