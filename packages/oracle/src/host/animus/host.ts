import { stableHash } from '../../core/identity';
import { createAnimusDependencies } from './dependency';
import { createAnimusIdentity } from './identity';
import { asManifest } from './manifest-types';
import { buildObligations } from './obligations';
import { parseComponents } from './replacement';
import {
  componentDimensions,
  createAnimusScenarios,
  dimensionOwners,
} from './scenario';
import { createAnimusTokens } from './tokens';
import { buildUniverse } from './universe';

import type { ProgramRevision } from '../../core/world';
import type { HostObligation, OracleHost } from '../../providers/host';
import type { AnimusDependencyInput } from './dependency';
import type { AnimusScenarioInput } from './scenario';
import type { AnimusTokens } from './tokens';

export interface AnimusHostOptions {
  viewportMin?: number;
  viewportMax?: number;
}

export interface AnimusHostInput {
  manifest: unknown;
  stylesheetText?: string;
  label?: string;
  options?: AnimusHostOptions;
}

export interface AnimusHost extends OracleHost {
  tokens?: AnimusTokens;
  obligations(): readonly HostObligation[];
}

export const createAnimusHost = (input: AnimusHostInput): AnimusHost => {
  const manifest = asManifest(input.manifest);
  const components = parseComponents(manifest);

  const tokens =
    input.stylesheetText === undefined
      ? undefined
      : createAnimusTokens(input.stylesheetText);

  const notes =
    tokens === undefined
      ? [
          'design-token values — no stylesheet text was supplied, so `var()` ' +
            'references stay unresolved and the `mode` dimension is absent',
        ]
      : tokens.notes();

  const build = buildUniverse(manifest, components, notes);
  const owners = dimensionOwners(components);
  const componentDomains = componentDimensions(components, owners);

  const program: ProgramRevision = {
    kind: 'analysis-artifacts',
    hash: stableHash({
      manifest,
      stylesheet: input.stylesheetText ?? null,
    }),
  };
  if (input.label !== undefined) program.label = input.label;

  const dependencyInput: AnimusDependencyInput = {
    rules: build.rules,
    componentFiles: new Map(
      components.map((component) => [component.id, component.record.file])
    ),
    programHash: program.hash,
  };
  if (tokens !== undefined) dependencyInput.tokens = tokens;

  const dependencies = createAnimusDependencies(dependencyInput);

  const obligations = buildObligations({
    manifest,
    components,
    rules: build.rules,
    dependencies,
    programHash: program.hash,
  });

  const scenarioInput: AnimusScenarioInput = {
    componentDomains,
    cuts: build.cuts,
  };
  if (tokens !== undefined) scenarioInput.tokens = tokens;
  const viewportMin = input.options?.viewportMin;
  if (viewportMin !== undefined) scenarioInput.viewportMin = viewportMin;
  const viewportMax = input.options?.viewportMax;
  if (viewportMax !== undefined) scenarioInput.viewportMax = viewportMax;

  const scenarios = createAnimusScenarios(scenarioInput);

  const componentScoped = new Set(
    Array.from(componentDomains.values()).flatMap((domain) =>
      Object.keys(domain)
    )
  );
  const declared = scenarios.dimensions();
  const shared = Object.fromEntries(
    Object.keys(declared)
      .filter((name) => !componentScoped.has(name))
      .map((name) => [name, declared[name]])
  );

  const host: AnimusHost = {
    program,
    universe: { universe: () => build.universe },
    scenarios,
    identity: createAnimusIdentity({
      manifest,
      components,
      owners,
      componentDomains,
      shared,
    }),
    dependencies,
    obligations: () => obligations,
  };
  if (tokens !== undefined) host.tokens = tokens;

  return host;
};
