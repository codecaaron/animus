import { asRuleId, stableHash } from '../../core/identity';
import { ANIMUS_LAYER_ORDER } from '../../providers/style-universe';
import {
  conditionFor,
  cutsOfPredicates,
  PSEUDO_STATE_EXCLUSION,
} from './conditions';
import { parseStylesheet } from './css-parse';
import { AnimusAdapterError } from './errors';
import { isRecord, tokenReferencesIn } from './manifest-types';
import { analyzeSelector } from './selector';

import type { SourceRef } from '../../core/fact';
import type { RuleId } from '../../core/identity';
import type {
  DeclarationRecord,
  RuleOrigin,
  StyleRuleRecord,
  StyleUniverse,
} from '../../providers/style-universe';
import type {
  AtCondition,
  FontFaceBlock,
  KeyframesBlock,
  ParsedRule,
} from './css-parse';
import type { AnimusManifest, ManifestChain } from './manifest-types';
import type { ParsedComponent } from './replacement';
import type { AnalyzedSelector } from './selector';

/** A modeled rule plus the joins the other providers need back from it. */
export interface UniverseRule {
  record: StyleRuleRecord;
  selector: AnalyzedSelector;
  atStack: readonly AtCondition[];
  componentId?: string;
  systemProp?: string;
}

export interface UniverseBuild {
  universe: StyleUniverse;
  rules: readonly UniverseRule[];
  ruleById: ReadonlyMap<string, UniverseRule>;
  cuts: Readonly<Record<string, readonly number[]>>;
  keyframes: readonly KeyframesBlock[];
  fontFaces: readonly FontFaceBlock[];
}

/**
 * Animus shorthands → the CSS properties they land on. Only the shorthands
 * observed in the emitted artifacts are here; an unknown key falls back to
 * camel→kebab, and a key that resolves to no emitted property simply leaves
 * `authoredProperty` unset. Guessing wider would put a fabricated authoring
 * origin on a real declaration, which is exactly the failure DESIGN §8 names.
 */
const PROPERTY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  area: ['grid-area'],
  bg: ['background-color'],
  flexDir: ['flex-direction'],
  h: ['height'],
  m: ['margin'],
  maxH: ['max-height'],
  maxW: ['max-width'],
  mb: ['margin-bottom'],
  minH: ['min-height'],
  minW: ['min-width'],
  ml: ['margin-left'],
  mr: ['margin-right'],
  mt: ['margin-top'],
  mx: ['margin-left', 'margin-right'],
  my: ['margin-top', 'margin-bottom'],
  p: ['padding'],
  pb: ['padding-bottom'],
  pl: ['padding-left'],
  pos: ['position'],
  pr: ['padding-right'],
  pt: ['padding-top'],
  px: ['padding-left', 'padding-right'],
  py: ['padding-top', 'padding-bottom'],
  size: ['width', 'height'],
  w: ['width'],
};

const COMPOUND_SUFFIX = /^compound-(\d+)$/;

const camelToKebab = (key: string): string =>
  key.replace(/([A-Z])/g, '-$1').toLowerCase();

const cssPropertiesFor = (key: string): readonly string[] => {
  if (key.startsWith('--')) return [key];
  // Nested-block keys in the authored object: at-rules, `&`-selectors and the
  // `_pseudo` shorthands. They own their own emitted rule, never a property.
  if (/^[@&_]/.test(key) || key.includes('&') || key.includes(' ')) return [];
  return PROPERTY_ALIASES[key] ?? [camelToKebab(key)];
};

interface AuthoredEntry {
  key: string;
  value?: string;
}

/**
 * Index the *top level* of one authored stage value by the CSS property each
 * key lands on.
 *
 * Top level only, on purpose: a nested key (`_dark`, `@container …`,
 * `'[data-active="true"] &'`) produces a *different* emitted rule, so
 * descending would attach the outer `bg: 'surface'` to the rule whose authored
 * value was actually `bg: 'primary'`. The caller pairs this with a
 * plain-context check for the same reason.
 */
const authoredIndex = (value: unknown): Map<string, AuthoredEntry> => {
  const index = new Map<string, AuthoredEntry>();
  if (!isRecord(value)) return index;

  for (const [key, raw] of Object.entries(value)) {
    const properties = cssPropertiesFor(key);
    if (properties.length === 0) continue;

    const scalar =
      typeof raw === 'string' || typeof raw === 'number'
        ? String(raw)
        : undefined;
    // A responsive object (`fontSize: { _: 14, sm: 16 }`) names the property
    // but has no single authored value — record the key, withhold the value.
    if (scalar === undefined && !isRecord(raw)) continue;

    for (const property of properties) {
      if (index.has(property)) continue;
      index.set(
        property,
        scalar === undefined ? { key } : { key, value: scalar }
      );
    }
  }

  return index;
};

/** The chain whose emitted class is this component's, else its binding's. */
export const findChain = (
  manifest: AnimusManifest,
  component: ParsedComponent
): ManifestChain | undefined => {
  const chains = manifest.fileFacts?.[component.record.file]?.chains ?? [];
  return (
    chains.find((chain) => chain.className === component.record.class_name) ??
    chains.find(
      (chain) => chain.descriptor.binding === component.record.binding
    )
  );
};

interface StageMatch {
  index: number;
  /** Compound styles live in the *second* argument, not the conditions one. */
  second: boolean;
  note?: string;
}

const matchStage = (
  chain: ManifestChain,
  origin: RuleOrigin
): StageMatch | undefined => {
  const stages = chain.stages;

  if (origin.method === 'styles') {
    const index = stages.findIndex((stage) => stage.method === 'styles');
    return index === -1 ? undefined : { index, second: false };
  }

  if (origin.method === 'variant') {
    const exact = stages.findIndex(
      (stage) =>
        stage.method === 'variant' &&
        isRecord(stage.value) &&
        stage.value.prop === origin.variantProp
    );
    if (exact !== -1) return { index: exact, second: false };

    const byOption = stages.findIndex(
      (stage) =>
        stage.method === 'variant' &&
        isRecord(stage.value) &&
        isRecord(stage.value.variants) &&
        origin.variantOption !== undefined &&
        Object.hasOwn(stage.value.variants, origin.variantOption)
    );
    return byOption === -1
      ? undefined
      : {
          index: byOption,
          second: false,
          note: 'matched by variant option; no stage declares this prop',
        };
  }

  if (origin.method === 'compound') {
    const compounds: number[] = [];
    stages.forEach((stage, index) => {
      if (stage.method === 'compound') compounds.push(index);
    });
    const index = compounds[origin.compoundIndex ?? -1];
    return index === undefined ? undefined : { index, second: true };
  }

  if (origin.method === 'states') {
    const index = stages.findIndex(
      (stage) =>
        stage.method === 'states' &&
        isRecord(stage.value) &&
        origin.state !== undefined &&
        Object.hasOwn(stage.value, origin.state)
    );
    return index === -1 ? undefined : { index, second: false };
  }

  return undefined;
};

const authoredValueOf = (
  chain: ManifestChain,
  match: StageMatch,
  origin: RuleOrigin
): unknown => {
  const stage = chain.stages[match.index];
  if (stage === undefined) return undefined;

  if (origin.method === 'styles') return stage.value;
  if (origin.method === 'compound') return stage.secondValue;
  if (origin.method === 'variant') {
    if (!isRecord(stage.value) || origin.variantOption === undefined) {
      return undefined;
    }
    const variants = stage.value.variants;
    return isRecord(variants) ? variants[origin.variantOption] : undefined;
  }
  if (origin.method === 'states') {
    if (!isRecord(stage.value) || origin.state === undefined) return undefined;
    return stage.value[origin.state];
  }
  return undefined;
};

const sourceRefOf = (
  chain: ManifestChain,
  match: StageMatch
): SourceRef | undefined => {
  const descriptor = chain.descriptor.stages[match.index];
  const span = match.second
    ? (descriptor?.secondArgSpan ?? descriptor?.argSpan)
    : descriptor?.argSpan;

  if (span != null) {
    return {
      file: '',
      span: [span[0], span[1]],
      ...(match.note === undefined ? {} : { note: match.note }),
    };
  }

  const fallback = chain.descriptor.span;
  if (fallback == null) return undefined;
  return {
    file: '',
    span: [fallback[0], fallback[1]],
    note: 'stage argument span unavailable; span covers the whole builder chain',
  };
};

interface Indexes {
  byBaseClass: Map<string, ParsedComponent>;
  bySlotClass: Map<string, string>;
  byUtilityClass: Map<string, string>;
}

const buildIndexes = (
  manifest: AnimusManifest,
  components: readonly ParsedComponent[]
): Indexes => {
  const byBaseClass = new Map<string, ParsedComponent>();
  for (const component of components) {
    byBaseClass.set(component.record.class_name, component);
  }

  const bySlotClass = new Map<string, string>();
  for (const [prop, config] of Object.entries(manifest.dynamic_props ?? {})) {
    bySlotClass.set(config.slotClass, prop);
  }

  const byUtilityClass = new Map<string, string>();
  for (const [prop, byValue] of Object.entries(
    manifest.system_prop_map ?? {}
  )) {
    for (const className of Object.values(byValue)) {
      byUtilityClass.set(className, prop);
    }
  }

  return { byBaseClass, bySlotClass, byUtilityClass };
};

/**
 * `.animus-dyn-p-md` → `p`. Responsive slot classes suffix the breakpoint
 * name onto the base slot class, so one trailing segment is stripped when the
 * full class is unknown — never more, because `animus-dyn-z-index` is itself a
 * hyphenated prop and blind stripping would fold it into `animus-dyn-z`.
 */
const dynamicPropOf = (
  className: string,
  bySlotClass: ReadonlyMap<string, string>
): string | undefined => {
  const exact = bySlotClass.get(className);
  if (exact !== undefined) return exact;

  const cut = className.lastIndexOf('-');
  if (cut <= 0) return undefined;
  return bySlotClass.get(className.slice(0, cut));
};

interface OriginMatch {
  origin: RuleOrigin;
  component?: ParsedComponent;
  systemProp?: string;
}

const componentOriginOf = (
  component: ParsedComponent,
  suffix: string,
  fail: (message: string, snippet: string) => never
): RuleOrigin => {
  const { config } = component;
  const base: RuleOrigin = { component: component.id };

  if (suffix === '') return { ...base, method: 'styles' };

  for (const [prop, variant] of Object.entries(config.variants ?? {})) {
    if (suffix === `${prop}-default`) {
      return {
        ...base,
        method: 'variant',
        variantProp: prop,
        variantOption: 'default',
      };
    }
    for (const option of variant.options) {
      if (suffix === `${prop}-${option}`) {
        return {
          ...base,
          method: 'variant',
          variantProp: prop,
          variantOption: option,
        };
      }
    }
  }

  for (const state of config.states ?? []) {
    if (suffix === state) return { ...base, method: 'states', state };
  }

  const compound = COMPOUND_SUFFIX.exec(suffix);
  if (compound !== null) {
    const index = Number(compound[1]);
    if (index < (config.compounds ?? []).length) {
      return { ...base, method: 'compound', compoundIndex: index };
    }
  }

  return fail(
    `class suffix \`--${suffix}\` on ${component.id} matches no variant ` +
      'option, state or compound in its replacement config',
    `${component.record.class_name}--${suffix}`
  );
};

const originOf = (
  layer: string,
  selector: AnalyzedSelector,
  indexes: Indexes,
  fail: (message: string, snippet: string) => never
): OriginMatch => {
  let best: { component: ParsedComponent; suffix: string } | undefined;
  let bestLength = -1;

  for (const className of selector.model.classNames) {
    for (const [base, component] of indexes.byBaseClass) {
      if (className !== base && !className.startsWith(`${base}--`)) continue;
      if (base.length <= bestLength) continue;
      bestLength = base.length;
      best = {
        component,
        suffix: className === base ? '' : className.slice(base.length + 2),
      };
    }
  }

  if (best !== undefined) {
    return {
      origin: componentOriginOf(best.component, best.suffix, fail),
      component: best.component,
    };
  }

  if (layer === 'anm-system') {
    for (const className of selector.model.classNames) {
      const systemProp =
        dynamicPropOf(className, indexes.bySlotClass) ??
        indexes.byUtilityClass.get(className);
      if (systemProp !== undefined) {
        return { origin: { method: 'system', systemProp }, systemProp };
      }
    }
    return fail(
      'system-layer rule whose class matches no dynamic slot and no ' +
        'system_prop_map entry',
      selector.model.raw
    );
  }

  if (layer === 'anm-global') return { origin: { method: 'global' } };

  return fail(
    `rule in layer ${layer} matches no component base class — the ` +
      'class-suffix grammar cannot attribute it',
    selector.model.raw
  );
};

/**
 * Sub-layer precedence.
 *
 * CSS ranks the *unlayered* content of a layer above its nested sub-layers, so
 * `anm-variants` (rules written directly into it) outranks
 * `anm-variants/standalone` and `anm-variants/composed`. The universe's total
 * order is `indexOf(layer, layerOrder)` then `order`, so the expansion puts
 * every sub-layer *before* its parent: earlier index = lower precedence. The
 * sub-layer sequence itself comes from the sheet's own `@layer a, b;`
 * statement when it declares one, so the declared order is honoured rather
 * than re-derived from where rules happened to land.
 */
const expandLayerOrder = (
  subLayers: ReadonlyMap<string, readonly string[]>
): string[] =>
  ANIMUS_LAYER_ORDER.flatMap((layer) => [
    ...(subLayers.get(layer) ?? []).map((sub) => `${layer}/${sub}`),
    layer,
  ]);

export const buildUniverse = (
  manifest: AnimusManifest,
  components: readonly ParsedComponent[],
  extraExclusions: readonly string[] = []
): UniverseBuild => {
  const indexes = buildIndexes(manifest, components);
  const sheets = manifest.sheets ?? {};

  const parsed: { layer: string; rule: ParsedRule }[] = [];
  const keyframes: KeyframesBlock[] = [];
  const fontFaces: FontFaceBlock[] = [];
  const subLayers = new Map<string, string[]>();

  for (const layer of ANIMUS_LAYER_ORDER) {
    const text = sheets[layer.replace(/^anm-/, '')];
    if (text === undefined || text.trim() === '') continue;

    const sheet = parseStylesheet(text, layer);
    keyframes.push(...sheet.keyframes);
    fontFaces.push(...sheet.fontFaces);

    for (const statement of sheet.layerStatements) {
      if (statement.layerPath.length !== 1) continue;
      if (statement.layerPath[0] !== layer) continue;
      subLayers.set(layer, [...statement.names]);
    }

    for (const rule of sheet.rules) {
      if (rule.layerPath[0] !== layer) {
        throw new AnimusAdapterError(
          `rule is not inside its sheet's \`@layer ${layer}\` wrapper`,
          { layer, snippet: rule.selector, construct: '@layer' }
        );
      }
      const sub = rule.layerPath[1];
      if (sub !== undefined) {
        const known = subLayers.get(layer) ?? [];
        if (!known.includes(sub)) subLayers.set(layer, [...known, sub]);
      }
      parsed.push({ layer, rule });
    }
  }

  const layerOrder = expandLayerOrder(subLayers);
  const orderByLayer = new Map<string, number>();
  const usedIds = new Map<string, number>();
  const rules: UniverseRule[] = [];
  const ruleById = new Map<string, UniverseRule>();

  for (const { layer, rule } of parsed) {
    const fail = (message: string, snippet: string): never => {
      throw new AnimusAdapterError(message, { layer, snippet });
    };

    const selector = analyzeSelector(rule.selector);
    const layerKey = rule.layerPath.join('/');
    const { origin, component, systemProp } = originOf(
      layer,
      selector,
      indexes,
      fail
    );

    const chain =
      component === undefined ? undefined : findChain(manifest, component);
    const match = chain === undefined ? undefined : matchStage(chain, origin);
    const rawSource =
      chain === undefined || match === undefined
        ? undefined
        : sourceRefOf(chain, match);
    const source =
      rawSource === undefined || component === undefined
        ? undefined
        : { ...rawSource, file: component.record.file };

    // Authored provenance is attached only where the emitted rule is the
    // *plain* form of its stage — one compound selector, no at-conditions.
    // Every other rule came from a nested block whose authored keys this
    // index deliberately does not descend into.
    const authored =
      chain !== undefined &&
      match !== undefined &&
      selector.classification === 'class-simple' &&
      rule.atStack.length === 0
        ? authoredIndex(authoredValueOf(chain, match, origin))
        : undefined;

    const declarations: DeclarationRecord[] = rule.declarations.map(
      (declaration) => {
        const tokenRefs = tokenReferencesIn(declaration.value);
        const entry = authored?.get(declaration.property);
        return {
          property: declaration.property,
          value: declaration.value,
          ...(declaration.important ? { important: true } : {}),
          ...(tokenRefs.length === 0 ? {} : { tokenRefs }),
          ...(entry === undefined ? {} : { authoredProperty: entry.key }),
          ...(entry?.value === undefined ? {} : { authoredValue: entry.value }),
        };
      }
    );

    const content = {
      layer: layerKey,
      selector: selector.model.raw,
      conditions: rule.atStack,
      declarations: rule.declarations,
    };
    const base = stableHash(content);
    const seen = usedIds.get(base) ?? 0;
    usedIds.set(base, seen + 1);
    const id: RuleId = asRuleId(seen === 0 ? base : `${base}#${seen}`);

    const order = orderByLayer.get(layerKey) ?? 0;
    orderByLayer.set(layerKey, order + 1);

    const record: StyleRuleRecord = {
      id,
      selector: selector.model,
      declarations,
      condition: conditionFor(rule.atStack),
      layer: layerKey,
      order,
      ...(source === undefined ? {} : { source }),
      origin,
    };

    const universeRule: UniverseRule = {
      record,
      selector,
      atStack: rule.atStack,
      ...(component === undefined ? {} : { componentId: component.id }),
      ...(systemProp === undefined ? {} : { systemProp }),
    };
    rules.push(universeRule);
    ruleById.set(id, universeRule);
  }

  const relational = rules.filter(
    (rule) => rule.selector.classification === 'relational'
  ).length;

  const exclusions: string[] = [
    'inline `style=` attributes written by the application at runtime',
    'per-invocation system-prop utility and dynamic slot classes — which ' +
      'classes a call site carries is invocation identity (DESIGN §9.2), ' +
      'Phase 2',
    `@keyframes timing semantics — ${keyframes.length} block(s) are ` +
      'catalogued, never resolved into time-varying declarations',
    `@font-face descriptors — ${fontFaces.length} block(s) are catalogued, ` +
      'not modeled as cascade rules',
    'runtime DOM mutation (class or style writes after render)',
    'stylesheets not emitted by animus (application CSS, third-party CSS, ' +
      'user-agent defaults)',
    PSEUDO_STATE_EXCLUSION,
    `host-tree shape — ${relational} relational selector(s) are modeled as ` +
      'rules but carry a `tree-shape` obligation instead of a decidable guard',
  ];

  exclusions.push(...extraExclusions);

  for (const component of components) {
    if (component.note === undefined) continue;
    exclusions.push(`${component.id}: ${component.note}`);
  }

  for (const detail of manifest.report?.eliminated_details ?? []) {
    const name = detail.name == null ? '' : ` \`${detail.name}\``;
    exclusions.push(
      `production reconciliation pruned ${detail.kind}${name} on ` +
        `${detail.component}: ${detail.reason}`
    );
  }

  const universe: StyleUniverse = {
    rules: rules.map((rule) => rule.record),
    ruleById: (id: RuleId) => ruleById.get(id)?.record,
    layerOrder,
    exclusions,
  };

  return {
    universe,
    rules,
    ruleById,
    cuts: cutsOfPredicates(rules.map((rule) => rule.record.condition)),
    keyframes,
    fontFaces,
  };
};
