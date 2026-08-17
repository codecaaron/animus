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

  // The optional fields are absent whenever the manifest carries null or
  // nothing there: a record that reports `extendsFrom: undefined` would claim
  // the adapter looked and found no parent, which is not the same fact as a
  // component that has none recorded.
  const record: ComponentRecord = {
    id: component.id,
    file: component.record.file,
    binding: component.record.binding,
    className: component.record.class_name,
    terminal: component.record.terminal,
  };
  if (component.record.extends_from != null) {
    record.extendsFrom = component.record.extends_from;
  }
  if (component.record.tag != null) record.tag = component.record.tag;
  if (span != null) {
    record.source = {
      file: component.record.file,
      span: [span[0], span[1]],
      note: 'the whole builder chain, from binding to terminal',
    };
  }

  return record;
};

/**
 * A component's public record and the parsed config it was derived from, kept
 * together so resolution never has to look the parse back up by id — the two
 * halves are produced from one `ParsedComponent` and cannot go missing
 * independently.
 */
interface IdentifiedComponent {
  record: ComponentRecord;
  parsed: ParsedComponent;
}

export const createAnimusIdentity = (
  input: AnimusIdentityInput
): IdentityProvider => {
  const identified: IdentifiedComponent[] = input.components.map((parsed) => ({
    record: recordOf(input.manifest, parsed),
    parsed,
  }));
  const records = identified.map((entry) => entry.record);
  const byId = new Map<string, IdentifiedComponent>(
    identified.map((entry) => [entry.record.id, entry])
  );

  const resolutionFor = (entry: IdentifiedComponent): TargetResolution => {
    const { record } = entry;
    const owner = input.owners.get(record.id) ?? record.binding;
    return {
      target: asTargetId(record.id),
      component: record,
      dimensions: {
        ...input.shared,
        ...(input.componentDomains.get(record.id) ?? {}),
      },
      classes: (point: ScenarioPoint) =>
        classesAtPoint(entry.parsed, owner, point),
    };
  };

  return {
    components: () => records,
    componentById: (id: string) => byId.get(id)?.record,
    resolveTarget: (selector: string) => {
      const exact = byId.get(selector);
      if (exact !== undefined) return resolutionFor(exact);

      // A bare binding that matches two components resolves to nothing: an
      // arbitrary winner would scope every later answer to a component the
      // caller did not name, and the ambiguity would never surface.
      const named = identified.filter(
        (entry) => entry.record.binding === selector
      );
      return named.length === 1 ? resolutionFor(named[0]) : undefined;
    },
  };
};
