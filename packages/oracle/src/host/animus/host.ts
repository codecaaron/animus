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
import type { AnimusTokens } from './tokens';

export interface AnimusHostOptions {
  /** Lower bound of the modeled `viewport.inline` interval (default 320). */
  viewportMin?: number;
  /** Upper bound of the modeled `viewport.inline` interval (default 1440). */
  viewportMax?: number;
}

export interface AnimusHostInput {
  /** Parsed `manifest.json` — validated, never trusted structurally. */
  manifest: unknown;
  /** The emitted `styles.css`. Its absence costs tokens, not soundness. */
  stylesheetText?: string;
  label?: string;
  options?: AnimusHostOptions;
}

/** The animus adapter's `OracleHost`, plus the channels only it can offer. */
export interface AnimusHost extends OracleHost {
  tokens?: AnimusTokens;
  obligations(): readonly HostObligation[];
}

/**
 * Build the six-provider host (DESIGN §9, §11) over one extraction run.
 *
 * Engine-free by construction: everything below is a read of `manifest.json`
 * plus the emitted stylesheet text. Nothing here reads a clock, a random
 * source, or the network, so two calls on the same input produce byte-identical
 * ids — which is what makes the world hash a usable cache key at all.
 *
 * Missing `stylesheetText` is a *degraded*, not broken, host: `tokens` is
 * undefined, the `mode` dimension disappears from the scenario domain, and
 * every `var()` in a declaration stays an unresolved reference. The universe,
 * identity, dependency and obligation channels are unaffected, because they
 * are derived from the manifest alone.
 */
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
    // Token facts derive from the stylesheet, so it is part of the program
    // identity — a manifest-only hash would give two runs with different
    // token CSS the same world ids. `null` keeps the degraded (no-stylesheet)
    // host distinct from one whose stylesheet is genuinely empty.
    hash: stableHash({
      manifest,
      stylesheet: input.stylesheetText ?? null,
    }),
    ...(input.label === undefined ? {} : { label: input.label }),
  };

  const dependencies = createAnimusDependencies({
    rules: build.rules,
    componentFiles: new Map(
      components.map((component) => [component.id, component.record.file])
    ),
    ...(tokens === undefined ? {} : { tokens }),
    programHash: program.hash,
  });

  const obligations = buildObligations({
    manifest,
    components,
    rules: build.rules,
    dependencies,
    programHash: program.hash,
  });

  const scenarios = createAnimusScenarios({
    componentDomains,
    ...(tokens === undefined ? {} : { tokens }),
    cuts: build.cuts,
    ...(input.options?.viewportMin === undefined
      ? {}
      : { viewportMin: input.options.viewportMin }),
    ...(input.options?.viewportMax === undefined
      ? {}
      : { viewportMax: input.options.viewportMax }),
  });

  // The axes no component owns (viewport, mode) affect every component, so
  // they belong to every target's domain — the same contract the in-memory
  // provider states. Derived by subtraction so the two constructions cannot
  // drift: unscoped = declared minus every component-scoped axis.
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

  return {
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
    ...(tokens === undefined ? {} : { tokens }),
    obligations: () => obligations,
  };
};
