import { TRUE } from '../../core/predicate';
import { componentDependency, manifestDependency } from './dependency';

import type { RenderSubject, SourceRef } from '../../core/fact';
import type { DependencyId } from '../../core/identity';
import type { DischargeProcedure } from '../../core/obligation';
import type { DependencyProvider } from '../../providers/dependency';
import type { HostObligation } from '../../providers/host';
import type { AnimusManifest, ManifestUsageResidue } from './manifest-types';
import type { ParsedComponent } from './replacement';
import type { UniverseRule } from './universe';

/**
 * Where an obligation points when the artifact has no source span for it — a
 * system-layer slot class or a theme-level dynamic prop is declared by the
 * build, not written at one call site. Naming the manifest is honest; naming
 * an arbitrary component file would not be.
 */
export const MANIFEST_ORIGIN = 'manifest.json';

const CONTEXT_CAPSULE: DischargeProcedure = {
  kind: 'context-capsule-measurement',
  description:
    'measure the element in an isolated browser capsule carrying exactly ' +
    'this scenario and this rule set',
  automated: true,
};

const CONTRACT: DischargeProcedure = {
  kind: 'contract-application',
  description:
    'apply a declared component contract stating whether the required ' +
    'ancestor structure is present',
  automated: false,
};

const FIXTURE: DischargeProcedure = {
  kind: 'fixture-lookup',
  description:
    'read the concrete prop value from a recorded invocation fixture',
  automated: true,
};

const PARTIAL_EVALUATION: DischargeProcedure = {
  kind: 'partial-evaluation',
  description:
    'partially evaluate the expression feeding this prop to a value or a ' +
    'finite value set',
  automated: true,
};

export interface AnimusObligationInput {
  manifest: AnimusManifest;
  components: readonly ParsedComponent[];
  rules: readonly UniverseRule[];
  dependencies: DependencyProvider;
  programHash: string;
}

const originOfRule = (rule: UniverseRule): SourceRef =>
  rule.record.source ?? {
    file: MANIFEST_ORIGIN,
    note:
      `no authored source span: this rule is emitted by the ` +
      `${rule.record.layer} layer, not by one builder stage`,
  };

const scopeOfRule = (rule: UniverseRule): RenderSubject[] => {
  const scope: RenderSubject[] = [{ kind: 'rule', rule: rule.record.id }];
  if (rule.componentId !== undefined) {
    scope.push({ kind: 'component', component: rule.componentId });
  }
  return scope;
};

/**
 * The unknowns the adapter already knows about, as declared host obligations
 * (DESIGN §4).
 *
 * Each family exists because the closed style universe genuinely stops short,
 * not because parsing was hard:
 *
 * - `tree-shape` — a relational selector's applicability is a fact about the
 *   rendered tree, and the render-shape provider is Phase 2.
 * - `geometry` — a container query tests a layout *result*; deriving it needs
 *   the layout IR this spike types but does not evaluate (DESIGN §10).
 * - `dynamic-value` — a dynamic system prop's value arrives at the call site,
 *   so the rule is known exactly and its `var()` binding is not.
 * - `runtime-style-write` — residue the extractor could not resolve
 *   statically; the value reaches the DOM outside the stylesheet entirely.
 *
 * Registering them here is what makes a later answer able to say `OUTSIDE_
 * MODEL` with a named residual instead of quietly answering as if the model
 * were complete.
 */
export const buildObligations = (
  input: AnimusObligationInput
): HostObligation[] => {
  const obligations: HostObligation[] = [];
  const manifestDep = manifestDependency(input.programHash);

  for (const rule of input.rules) {
    if (rule.selector.classification !== 'relational') continue;
    obligations.push({
      origin: originOfRule(rule),
      guard: rule.record.condition,
      effectClass: 'tree-shape',
      influenceScope: scopeOfRule(rule),
      reason:
        `\`${rule.record.selector.raw}\` applies only when the rendered ` +
        'tree provides the matching ancestor or sibling; host-tree shape is ' +
        'not part of the closed style universe',
      dischargeOptions: [CONTRACT, CONTEXT_CAPSULE],
      dependencies: input.dependencies.dependenciesOfRule(rule.record.id),
    });
  }

  for (const rule of input.rules) {
    const container = rule.atStack.find(
      (condition) => condition.kind === 'container'
    );
    if (container === undefined) continue;
    obligations.push({
      origin: originOfRule(rule),
      guard: rule.record.condition,
      effectClass: 'geometry',
      influenceScope: scopeOfRule(rule),
      reason:
        `\`${rule.record.selector.raw}\` is guarded by a container query; ` +
        'the container’s inline size is a layout result the closed style ' +
        'universe does not derive, so the guard has no bindable dimension',
      dischargeOptions: [CONTEXT_CAPSULE],
      dependencies: input.dependencies.dependenciesOfRule(rule.record.id),
    });
  }

  const slotRules = new Map<string, UniverseRule[]>();
  for (const rule of input.rules) {
    if (rule.systemProp === undefined) continue;
    const existing = slotRules.get(rule.systemProp) ?? [];
    existing.push(rule);
    slotRules.set(rule.systemProp, existing);
  }

  const residue = input.manifest.usageResidue ?? [];
  const residueByProp = new Map<string, ManifestUsageResidue>();
  for (const entry of residue) {
    if (!residueByProp.has(entry.prop)) residueByProp.set(entry.prop, entry);
  }

  for (const [prop, config] of Object.entries(
    input.manifest.dynamic_props ?? {}
  )) {
    const rules = slotRules.get(prop);
    if (rules === undefined || rules.length === 0) continue;

    const declaring = input.components.filter((component) =>
      (component.record.system_prop_names ?? []).includes(prop)
    );
    const site = residueByProp.get(prop);
    const first = declaring[0];

    const origin: SourceRef =
      site !== undefined
        ? { file: site.file, span: [site.span.start, site.span.end] }
        : first !== undefined
          ? {
              file: first.record.file,
              note: `\`${prop}\` is declared as a system prop of ${first.id}`,
            }
          : {
              file: MANIFEST_ORIGIN,
              note: `\`${prop}\` is declared by the system, not by a component`,
            };

    const scope: RenderSubject[] = [
      ...rules.map(
        (rule): RenderSubject => ({ kind: 'rule', rule: rule.record.id })
      ),
      ...declaring.map(
        (component): RenderSubject => ({
          kind: 'component',
          component: component.id,
        })
      ),
    ];

    const dependencies: DependencyId[] = [
      ...declaring.map((component) => componentDependency(component.id)),
      manifestDep,
    ];

    obligations.push({
      origin,
      guard: TRUE,
      effectClass: 'dynamic-value',
      influenceScope: scope,
      reason:
        `the dynamic system prop \`${prop}\` binds \`${config.varName}\` on ` +
        `\`.${config.slotClass}\` at the call site; the rule is known ` +
        'exactly and the value it reads is not',
      dischargeOptions: [FIXTURE, CONTEXT_CAPSULE],
      dependencies: Array.from(new Set(dependencies)),
    });
  }

  for (const entry of residue) {
    const id = `${entry.file}::${entry.binding}`;
    const known = input.components.some((component) => component.id === id);
    obligations.push({
      origin: {
        file: entry.file,
        span: [entry.span.start, entry.span.end],
      },
      guard: TRUE,
      effectClass: 'runtime-style-write',
      influenceScope: known
        ? [{ kind: 'component', component: id }]
        : [{ kind: 'world' }],
      reason:
        `\`${entry.binding}.${entry.prop}\` (${entry.kind}) was not resolved ` +
        'statically; its value reaches the DOM outside the emitted stylesheet',
      dischargeOptions: [PARTIAL_EVALUATION, FIXTURE],
      dependencies: [manifestDep],
    });
  }

  return obligations;
};
