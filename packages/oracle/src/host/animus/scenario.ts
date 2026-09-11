import { MODE_DIMENSION, VIEWPORT_DIMENSION } from './conditions';

import type {
  DimensionDomain,
  ScenarioDomain,
  ScenarioPoint,
} from '../../core/scenario';
import type { ScenarioProvider } from '../../providers/scenario';
import type { ParsedComponent } from './replacement';
import type { AnimusTokens } from './tokens';

export const DEFAULT_VIEWPORT_MIN = 320;

export const DEFAULT_VIEWPORT_MAX = 1440;

export const variantDimension = (owner: string, prop: string): string =>
  `variant:${owner}:${prop}`;

export const stateDimension = (owner: string, name: string): string =>
  `state:${owner}:${name}`;

export const dimensionOwners = (
  components: readonly ParsedComponent[]
): Map<string, string> => {
  const counts = new Map<string, number>();
  for (const component of components) {
    const binding = component.record.binding;
    counts.set(binding, (counts.get(binding) ?? 0) + 1);
  }

  const owners = new Map<string, string>();
  for (const component of components) {
    const binding = component.record.binding;
    const collides = (counts.get(binding) ?? 0) > 1;
    owners.set(component.id, collides ? component.id : binding);
  }
  return owners;
};

export const componentDimensions = (
  components: readonly ParsedComponent[],
  owners: ReadonlyMap<string, string>
): Map<string, ScenarioDomain> => {
  const byComponent = new Map<string, ScenarioDomain>();

  for (const component of components) {
    const owner = owners.get(component.id) ?? component.record.binding;
    const domain: Record<string, DimensionDomain> = {};

    for (const [prop, variant] of Object.entries(
      component.config.variants ?? {}
    )) {
      domain[variantDimension(owner, prop)] = {
        kind: 'finite',
        values: [...variant.options],
      };
    }
    for (const state of component.config.states ?? []) {
      domain[stateDimension(owner, state)] = {
        kind: 'finite',
        values: [false, true],
      };
    }

    byComponent.set(component.id, domain);
  }

  return byComponent;
};

export interface AnimusScenarioInput {
  componentDomains: ReadonlyMap<string, ScenarioDomain>;
  tokens?: AnimusTokens;
  cuts: Readonly<Record<string, readonly number[]>>;
  viewportMin?: number;
  viewportMax?: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const createAnimusScenarios = (
  input: AnimusScenarioInput
): ScenarioProvider => {
  const viewportMin = input.viewportMin ?? DEFAULT_VIEWPORT_MIN;
  const viewportMax = input.viewportMax ?? DEFAULT_VIEWPORT_MAX;
  const modes = input.tokens?.modes() ?? [];

  const dimensions: Record<string, DimensionDomain> = {};
  dimensions[VIEWPORT_DIMENSION] = {
    kind: 'interval',
    min: viewportMin,
    max: viewportMax,
  };
  if (modes.length > 0) {
    dimensions[MODE_DIMENSION] = { kind: 'finite', values: [...modes] };
  }

  for (const domain of input.componentDomains.values()) {
    for (const [name, dimension] of Object.entries(domain)) {
      dimensions[name] = dimension;
    }
  }

  const thresholds = (input.tokens?.breakpoints() ?? []).filter(
    (breakpoint) => breakpoint.px > viewportMin && breakpoint.px <= viewportMax
  );

  const named: Record<string, ScenarioPoint> = {};
  const bands = [
    { name: 'base', lower: viewportMin },
    ...thresholds.map((breakpoint) => ({
      name: breakpoint.name,
      lower: breakpoint.px,
    })),
  ];

  bands.forEach((band, index) => {
    const upper = bands[index + 1]?.lower ?? viewportMax;
    const inline = clamp((band.lower + upper) / 2, viewportMin, viewportMax);
    if (modes.length === 0) {
      named[band.name] = { [VIEWPORT_DIMENSION]: inline };
      return;
    }
    for (const mode of modes) {
      named[`${band.name}.${mode}`] = {
        [VIEWPORT_DIMENSION]: inline,
        [MODE_DIMENSION]: mode,
      };
    }
  });

  return {
    dimensions: () => dimensions,
    cuts: () => input.cuts,
    namedScenarios: () => named,
  };
};
