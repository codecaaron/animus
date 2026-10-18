/**
 * TS mirror of the engine's serde output: field spelling and optionality are
 * the engine's, never a transcription choice. One spelling per field.
 */

import type { DynamicPropMeta, RuntimeTables } from './dynamic-prop-config';
import type { FontPreload, PreloadedFontFace } from './font-preloads';
import type { ManifestDiagnostic } from './manifest-diagnostics';
import type { ExtractFileFacts } from './source-ingestion';

export interface ManifestComponentDescriptor {
  file: string;
  binding: string;
  class_name: string;
  extends_from: string | null;
  /** `asElement` | `asComponent` | `asClass`. */
  terminal: string;
  tag: string;
  replacement: string;
  system_prop_names: string[];
  /** The definition's fingerprint, which its location takes no part in. */
  definition_fingerprint: string;
  /** The props it accepts in authoring order, as the extract README's
   *  prop-order section states it. Present only where the host publishes
   *  the prop-order file and the component accepts a prop. */
  authoring_order?: ManifestOrderedProp[];
}

export interface ManifestSheets {
  /** The `@layer` ordering statement alone. */
  declaration: string;
  global: string;
  base: string;
  variants: string;
  compounds: string;
  states: string;
  system: string;
  custom: string;
}

export interface ManifestComponentSheets {
  base?: string;
  variants?: string;
  compounds?: string;
  states?: string;
  /** A compose family's rules for this child slot, emitted in the variants
   *  layer's `composed` sublayer. */
  composed_variants?: string;
  /** A compose family's rules for this child slot, emitted after the flat
   *  compound rules. */
  composed_compounds?: string;
}

/** Byte offsets into the source file. */
export interface ManifestUsageSpan {
  start: number;
  end: number;
}

/** One still-dynamic usage site. */
export interface ManifestUsageResidueRecord {
  binding: string;
  prop: string;
  file: string;
  span: ManifestUsageSpan;
  /** The dynamic-expression kind, kebab-cased. */
  kind: string;
}

export interface ManifestCrossFileFacts {
  componentNames: string[];
  classResolvers: string[];
  /**
   * Consuming file → family member tag as written there (`Panel.Body`,
   * `ui.Card.Body`) → the component id its slot renders.
   */
  memberBindings: Record<string, Record<string, string>>;
  renderedComponents: string[];
  /** binding → variant prop → option names. */
  variantOptions: Record<string, Record<string, string[]>>;
  /** binding → state names. */
  stateNames: Record<string, string[]>;
}

export interface ManifestEliminatedDetail {
  component: string;
  /** `"component"` | `"variant"` | `"state"` | `"compound"`. */
  kind: string;
  /** Variant option or state name, or a compound's index; `null` for a
   *  whole component. */
  name: string | null;
  reason: string;
}

export interface ManifestReconciliationReport {
  components_total: number;
  components_extracted: number;
  components_eliminated: number;
  variants_total: number;
  variants_used: number;
  variants_eliminated: number;
  states_total: number;
  states_used: number;
  states_eliminated: number;
  components_forced: number;
  variants_forced: number;
  states_forced: number;
  eliminated_details: ManifestEliminatedDetail[];
}

/**
 * A type alias, not an interface: only an alias carries the implicit index
 * signature that keeps it assignable to an open `Record<string, number>`.
 */
export type ManifestTiming = {
  parseCount: number;
};

/**
 * The parsed `ExtractEngine.analyze()` manifest. Every top-level field is
 * always present — an empty universe emits `{}` / `[]` / `""`, not absence.
 */
export interface ProjectManifest {
  fileFacts: Record<string, ExtractFileFacts>;
  crossFile: ManifestCrossFileFacts;
  parseCount: number;
  usageResidue: ManifestUsageResidueRecord[];
  /** Complete component CSS, before the TS-side unit fallback. */
  css: string;
  sheets: ManifestSheets;
  diagnostics: ManifestDiagnostic[];
  report: ManifestReconciliationReport;
  /** prop name → value → utility class name. */
  system_prop_map: Record<string, Record<string, string>>;
  dynamic_props: Record<string, DynamicPropMeta>;
  /** definition key (a prop's `transformId`) → source: the loaded system's
   *  configured transforms that passed self-containment admission and
   *  registered for static evaluation. */
  admitted_transforms: Record<string, string>;
  /** Sorted system props bound to a configured transform: their
   *  `system_prop_map` keys keep the authored value's type. */
  typed_system_props: string[];
  /** The tables runtime configs reference from the system-props module's
   *  `animusTables` export, each by the key its meta's `tables` names;
   *  absent where none is referenced. */
  runtime_tables?: RuntimeTables;
  /** key → the source of a `systemPropNames` list runtime configs
   *  reference from the system-props module's `systemPropNames_{key}`
   *  export; absent where none is referenced. */
  prop_name_lists?: Record<string, string>;
  /** Every system prop → the later-defined props that take effect over it,
   *  which runtime configs reference from the `supersededBy` export; absent
   *  where none is referenced. */
  superseded_by?: Record<string, string[]>;
  component_fragments: Record<string, ManifestComponentSheets>;
  /** The fingerprint of the system the analysis ran with. */
  system_fingerprint: string;
  /** parent component id → child component ids. */
  reverse_provenance: Record<string, string[]>;
  /** component id (`file::binding`) → descriptor. */
  components: Record<string, ManifestComponentDescriptor>;
  /** file path → component ids declared in it. */
  files: Record<string, string[]>;
  /** Files whose transform marks a builder chain `/* @__PURE__ *\/`, so a
   *  bundler drops a system no runtime code reads: a host transforms them
   *  even where they define no component. Absent where there are none. */
  builderFiles?: string[];
  /** Each extension dropped over a parent that is no analysed chain, with
   *  why (spec §12.2 row 11); absent where none was. */
  missing_inputs?: ManifestMissingInput[];
  /** The font files the emitted faces ask to preload, in emission order;
   *  absent where none does. */
  font_preloads?: ManifestFontPreload[];
  /** File → each tag written there as JSX that renders exactly one
   *  analysed component, as written (`B`, `ui.Box`, `Card.Body`) → it.
   *  Present only where the host publishes the prop-order file and a tag
   *  resolves. */
  tag_components?: Record<string, Record<string, string>>;
  timing: ManifestTiming;
}

/** One prop a component accepts, at its place in the authoring order. */
export interface ManifestOrderedProp {
  name: string;
  /** `variants` covers variants and compounds. */
  stage: 'variants' | 'states' | 'system' | 'custom';
  rank: number;
  /** The prop reaches the rendered target as written (`data-*`, `aria-*`,
   *  or a variant or state an `.asComponent()` target is forwarded), so the
   *  order it is written in can be observed there; absent, it does not. */
  forwarded?: true;
}

/** A preloaded font file and the faces that preload it, by their flags or
 *  by the host's `fontPreloads`, also named as their reports name them. */
export interface ManifestFontPreload extends FontPreload {
  faces: PreloadedFontFace[];
  names: string[];
}

/** An extension dropped over its parent: the typed evidence a host's
 *  rediscovery reads in place of the drop's message. */
export interface ManifestMissingInput {
  file: string;
  component: string;
  /** The parent as written in the extending file. */
  parent: string;
  /** The specifier the parent is imported by, where it is imported. */
  specifier: string | null;
  /** The rootDir-relative path the specifier probes, where it is a path. */
  base: string | null;
  outcome:
    | 'absent'
    | 'incomplete'
    | 'opaque'
    | 'adapted'
    | 'package'
    | 'unreached'
    | 'not-a-chain'
    | 'failed-parent';
}
