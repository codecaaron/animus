import {
  asDependencyId,
  asRuleId,
  asTargetId,
  stableHash,
} from '../core/identity';
import { isActiveState, parseScopedDimension } from '../core/scenario';
import { ANIMUS_LAYER_ORDER } from './style-universe';

import type { DependencyId, RuleId } from '../core/identity';
import type { ScenarioDomain, ScenarioPoint } from '../core/scenario';
import type { ProgramRevision } from '../core/world';
import type { OracleHost } from './host';
import type { ComponentRecord, TargetResolution } from './identity';
import type { StyleRuleRecord, StyleUniverse } from './style-universe';

export interface InMemoryHostConfig {
  program?: Partial<ProgramRevision>;
  layerOrder?: readonly string[];
  rules: readonly (Omit<StyleRuleRecord, 'id'> & { id?: string })[];
  components: readonly ComponentRecord[];
  dimensions?: ScenarioDomain;
  cuts?: Readonly<Record<string, readonly number[]>>;
  namedScenarios?: Readonly<Record<string, ScenarioPoint>>;
  targetDimensions?: Readonly<Record<string, ScenarioDomain>>;
  classesFor?: (
    component: ComponentRecord,
    point: ScenarioPoint
  ) => readonly string[];
  ruleDependencies?: Readonly<Record<string, readonly string[]>>;
}

/**
 * The animus class-emission convention: the component class, then one class
 * per bound variant, then one per active state. Ordering is by dimension name
 * so a point always yields the same class list — class order is part of what
 * later waves hash.
 */
const defaultClassesFor = (
  component: ComponentRecord,
  point: ScenarioPoint
): readonly string[] => {
  const variants: string[] = [];
  const states: string[] = [];

  for (const dimension of Object.keys(point).sort()) {
    const scoped = parseScopedDimension(dimension);
    if (scoped === undefined) continue;
    if (scoped.owner !== component.binding && scoped.owner !== component.id) {
      continue;
    }

    const value = point[dimension];
    if (scoped.kind === 'variant') {
      variants.push(`${component.className}--${scoped.name}-${String(value)}`);
    } else if (scoped.kind === 'state' && isActiveState(value)) {
      states.push(`${component.className}--${scoped.name}`);
    }
  }

  return [component.className, ...variants, ...states];
};

/**
 * The scenario axes that can affect one component: every unscoped axis
 * (viewport, mode, …) plus the scoped axes that name this component. A scoped
 * axis belonging to another component cannot change this target's classes, so
 * including it would only inflate the cell count.
 */
const dimensionsForComponent = (
  component: ComponentRecord,
  dimensions: ScenarioDomain
): ScenarioDomain => {
  const scoped: Record<string, ScenarioDomain[string]> = {};
  for (const dimension of Object.keys(dimensions)) {
    const parsed = parseScopedDimension(dimension);
    if (
      parsed === undefined ||
      parsed.owner === component.binding ||
      parsed.owner === component.id
    ) {
      scoped[dimension] = dimensions[dimension];
    }
  }
  return scoped;
};

/**
 * A host built from literal records — the substrate's test double and the
 * shape every real adapter has to produce. It is pure data: no clock, no
 * filesystem, no ordering that depends on anything but the config.
 */
export const createInMemoryHost = (config: InMemoryHostConfig): OracleHost => {
  const layerOrder = config.layerOrder ?? ANIMUS_LAYER_ORDER;

  const rules: StyleRuleRecord[] = config.rules.map((rule) => {
    const { id, ...content } = rule;
    return { ...content, id: asRuleId(id ?? stableHash(content)) };
  });

  const rulesById = new Map<string, StyleRuleRecord>(
    rules.map((rule) => [rule.id, rule])
  );

  const dimensions = config.dimensions ?? {};
  const cuts = config.cuts ?? {};
  const namedScenarios = config.namedScenarios ?? {};
  const ruleDependencies = config.ruleDependencies ?? {};
  const classesFor = config.classesFor ?? defaultClassesFor;

  const componentsById = new Map<string, ComponentRecord>(
    config.components.map((component) => [component.id, component])
  );

  const program: ProgramRevision = {
    kind: config.program?.kind ?? 'synthetic',
    hash:
      config.program?.hash ??
      stableHash({
        layerOrder,
        rules,
        components: config.components,
        dimensions,
        cuts,
        namedScenarios,
        targetDimensions: config.targetDimensions,
        ruleDependencies,
      }),
    ...(config.program?.label === undefined
      ? {}
      : { label: config.program.label }),
  };

  const universe: StyleUniverse = {
    rules,
    ruleById: (id: RuleId) => rulesById.get(id),
    layerOrder,
    exclusions: [],
  };

  const resolutionFor = (component: ComponentRecord): TargetResolution => ({
    target: asTargetId(component.id),
    component,
    dimensions:
      config.targetDimensions?.[component.id] ??
      config.targetDimensions?.[component.binding] ??
      dimensionsForComponent(component, dimensions),
    classes: (point: ScenarioPoint) => classesFor(component, point),
  });

  return {
    program,
    universe: { universe: () => universe },
    scenarios: {
      dimensions: () => dimensions,
      cuts: () => cuts,
      namedScenarios: () => namedScenarios,
    },
    identity: {
      components: () => config.components,
      componentById: (id: string) => componentsById.get(id),
      resolveTarget: (selector: string) => {
        const byId = componentsById.get(selector);
        if (byId !== undefined) return resolutionFor(byId);

        const byBinding = config.components.filter(
          (component) => component.binding === selector
        );
        if (byBinding.length !== 1) return undefined;
        return resolutionFor(byBinding[0]);
      },
    },
    dependencies: {
      dependenciesOfRule: (rule: RuleId): readonly DependencyId[] =>
        (ruleDependencies[rule] ?? []).map(asDependencyId),
      rulesOfSource: (file: string): readonly RuleId[] =>
        rules
          .filter(
            (rule) =>
              rule.source?.file === file ||
              (ruleDependencies[rule.id] ?? []).includes(file)
          )
          .map((rule) => rule.id),
    },
  };
};
