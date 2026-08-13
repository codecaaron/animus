import { asTargetId } from '../../core/identity';
import { isActiveState } from '../../core/scenario';
import { stateDimension, variantDimension } from './scenario';
import { findChain } from './universe';

import type {
  DimensionValue,
  ScenarioDomain,
  ScenarioPoint,
} from '../../core/scenario';
import type {
  ComponentRecord,
  IdentityProvider,
  TargetResolution,
} from '../../providers/identity';
import type { AnimusManifest } from './manifest-types';
import type { ParsedComponent } from './replacement';

/**
 * The class list a target carries at one scenario point.
 *
 * This mirrors `packages/system/src/runtime/resolveClasses.ts` — the runtime
 * that actually renders these components — and the host tests pin it to the
 * fixture. Three details are the runtime's, not conveniences:
 *
 * 1. Order is base → variants in *config declaration order* → compounds →
 *    states. Cascade order comes from layers, but class order is what later
 *    waves hash, so it has to be reproducible.
 * 2. An unbound variant prop that has a declared default emits
 *    `--{prop}-default`, never `--{prop}-{default}`. The runtime does this so
 *    a compose override cannot match the default class and inheritance from a
 *    parent still wins; emitting the resolved value here would model a
 *    selector that is never in the document.
 * 3. Compound conditions match against the *resolved* value — the bound one,
 *    else the config default — which is the opposite convention from (2), and
 *    is again what the runtime does.
 *
 * System-prop utility and dynamic slot classes are absent: which of them a
 * call site carries depends on the prop values at that invocation, which is
 * invocation identity (DESIGN §9.2, Phase 2), not a scenario coordinate. The
 * universe lists that as an exclusion.
 */
export const classesAtPoint = (
  component: ParsedComponent,
  owner: string,
  point: ScenarioPoint
): string[] => {
  const base = component.record.class_name;
  const { config } = component;
  const classes: string[] = [base];

  const resolved = new Map<string, DimensionValue | undefined>();
  for (const [prop, variant] of Object.entries(config.variants ?? {})) {
    const dimension = variantDimension(owner, prop);
    const bound = Object.hasOwn(point, dimension);
    resolved.set(prop, bound ? point[dimension] : variant.default);

    if (bound) classes.push(`${base}--${prop}-${String(point[dimension])}`);
    else if (variant.default !== undefined) {
      classes.push(`${base}--${prop}-default`);
    }
  }

  const currentOf = (prop: string): DimensionValue | undefined => {
    if (resolved.has(prop)) return resolved.get(prop);
    const dimension = variantDimension(owner, prop);
    return Object.hasOwn(point, dimension) ? point[dimension] : undefined;
  };

  for (const compound of config.compounds ?? []) {
    let matches = true;
    for (const [prop, expected] of Object.entries(compound.conditions)) {
      const current = currentOf(prop);
      const ok = Array.isArray(expected)
        ? expected.some((option) => option === current)
        : current === expected;
      if (!ok) {
        matches = false;
        break;
      }
    }
    if (matches) classes.push(compound.className);
  }

  for (const state of config.states ?? []) {
    const dimension = stateDimension(owner, state);
    if (Object.hasOwn(point, dimension) && isActiveState(point[dimension])) {
      classes.push(`${base}--${state}`);
    }
  }

  return classes;
};

export interface AnimusIdentityInput {
  manifest: AnimusManifest;
  components: readonly ParsedComponent[];
  owners: ReadonlyMap<string, string>;
  componentDomains: ReadonlyMap<string, ScenarioDomain>;
  /** The unscoped axes (viewport, mode) every target's domain must carry. */
  shared: ScenarioDomain;
}

const recordOf = (
  manifest: AnimusManifest,
  component: ParsedComponent
): ComponentRecord => {
  const chain = findChain(manifest, component);
  const span = chain?.descriptor.span;

  return {
    id: component.id,
    file: component.record.file,
    binding: component.record.binding,
    className: component.record.class_name,
    terminal: component.record.terminal,
    ...(component.record.extends_from == null
      ? {}
      : { extendsFrom: component.record.extends_from }),
    ...(component.record.tag == null ? {} : { tag: component.record.tag }),
    ...(span == null
      ? {}
      : {
          source: {
            file: component.record.file,
            span: [span[0], span[1]] as const,
            note: 'the whole builder chain, from binding to terminal',
          },
        }),
  };
};

export const createAnimusIdentity = (
  input: AnimusIdentityInput
): IdentityProvider => {
  const records = input.components.map((component) =>
    recordOf(input.manifest, component)
  );
  const byId = new Map<string, ComponentRecord>(
    records.map((record) => [record.id, record])
  );
  const parsedById = new Map<string, ParsedComponent>(
    input.components.map((component) => [component.id, component])
  );

  const resolutionFor = (record: ComponentRecord): TargetResolution => {
    const component = parsedById.get(record.id) as ParsedComponent;
    const owner = input.owners.get(record.id) ?? record.binding;
    return {
      target: asTargetId(record.id),
      component: record,
      dimensions: {
        ...input.shared,
        ...(input.componentDomains.get(record.id) ?? {}),
      },
      classes: (point: ScenarioPoint) =>
        classesAtPoint(component, owner, point),
    };
  };

  return {
    components: () => records,
    componentById: (id: string) => byId.get(id),
    resolveTarget: (selector: string) => {
      const exact = byId.get(selector);
      if (exact !== undefined) return resolutionFor(exact);

      // A bare binding that matches two components resolves to nothing: an
      // arbitrary winner would scope every later answer to a component the
      // caller did not name, and the ambiguity would never surface.
      const named = records.filter((record) => record.binding === selector);
      return named.length === 1 ? resolutionFor(named[0]) : undefined;
    },
  };
};
