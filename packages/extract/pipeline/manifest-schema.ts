/**
 * The wire type of the manifest this pipeline produces.
 *
 * The AUTHORITY is Rust: `AnalyzeResult` in
 * `packages/extract/crates/extract-v2/src/engine.rs`, serialized by serde and
 * handed back from `ExtractEngine.analyze()` (the `analyzeProject` seam in
 * `engine-adapter.ts`). This module is that struct's TS mirror, declared in the
 * producing package so consumers stop re-deriving a private model each — before
 * it existed, `ProjectAnalysisResult.manifest` was `any` and five readers
 * disagreed about which fields were required and how they were spelled.
 *
 * A mirror needs a tether, not a promise: `packages/_integration/__tests__/
 * manifest-shape.test.ts` decodes a REAL engine manifest against these types at
 * runtime, so a Rust-side rename fails a test rather than silently rotting the
 * declaration. `packages/oracle` keeps its own adapter model on purpose (see
 * `packages/oracle/src/host/animus/manifest-types.ts`) — it must not depend on
 * this package's build output.
 *
 * FIELD SPELLING is the engine's, not a transcription choice (engine.rs:31-35):
 * plugin-consumed fields keep v1's exact snake_case serde names
 * (`system_prop_map`, `dynamic_props`, `component_fragments`,
 * `reverse_provenance`, `components`, `files`, `report`, `css`, `sheets`,
 * `diagnostics`), while v2-native channels are camelCase (`fileFacts`,
 * `crossFile`, `parseCount`, `usageResidue`). There is exactly ONE spelling per
 * field; nothing here is emitted under two names.
 *
 * OPTIONALITY is the serde attribute, not a guess: a field is optional here
 * only where the Rust side carries `skip_serializing_if`. Everything else is
 * always present — including the empty-collection cases, which serialize as
 * `{}` / `[]` rather than being omitted.
 */

import type { DynamicPropMeta } from './dynamic-prop-config';
import type { ManifestDiagnostic } from './manifest-diagnostics';
import type { ExtractFileFacts } from './source-ingestion';

/** `analyze_css::ComponentDescriptor` — the plugin-consumed component record. */
export interface ManifestComponentDescriptor {
  file: string;
  binding: string;
  class_name: string;
  /** `null` for a root component; never omitted. */
  extends_from: string | null;
  /** `asElement` | `asComponent` | `asClass` — emitted as a bare string. */
  terminal: string;
  tag: string;
  replacement: string;
  system_prop_names: string[];
}

/** `css::CssSheets` — the complete per-layer stylesheet split. */
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

/**
 * `css::PerComponentSheets` — the four splittable layers for one component.
 * Every field is `skip_serializing_if = "Option::is_none"`: a component with no
 * variants emits no `variants` key at all.
 */
export interface ManifestComponentSheets {
  base?: string;
  variants?: string;
  compounds?: string;
  states?: string;
}

/** `jsx_scan::UsageSpan` — byte offsets into the source file. */
export interface ManifestUsageSpan {
  start: number;
  end: number;
}

/** `usage_facts::UsageResidueRecord` — one still-dynamic usage site. */
export interface ManifestUsageResidueRecord {
  binding: string;
  prop: string;
  file: string;
  span: ManifestUsageSpan;
  /** `jsx_scan::DynamicExpressionKind`, kebab-cased by serde. */
  kind: string;
}

/** `cross_file::CrossFileFacts` — camelCase by serde `rename_all`. */
export interface ManifestCrossFileFacts {
  componentNames: string[];
  classResolvers: string[];
  /** `Family.Slot` dotted key → slot binding name. */
  memberBindings: Record<string, string>;
  renderedComponents: string[];
  /** binding → variant prop → option names. */
  variantOptions: Record<string, Record<string, string[]>>;
  /** binding → state names. */
  stateNames: Record<string, string[]>;
}

/** `reconcile::EliminatedDetail`. */
export interface ManifestEliminatedDetail {
  component: string;
  /** `"component"` | `"variant"` | `"state"`. */
  kind: string;
  /** Variant option or state name; `null` for a whole component. */
  name: string | null;
  reason: string;
}

/** `reconcile::ReconciliationReport` — the manifest's `report` field. */
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
 * The `timing` sub-object. `parseCount` is the same counter the top-level
 * `parseCount` field carries — both read `self.parse_count`.
 *
 * A type alias, not an interface, on purpose: the session's timing logger
 * takes an open `Record<string, number>` phase map (it predates this engine,
 * which reports only the one counter), and only an alias carries the implicit
 * index signature that keeps it assignable without widening the wire.
 */
export type ManifestTiming = {
  parseCount: number;
};

/**
 * The complete manifest `ExtractEngine.analyze()` returns, parsed.
 *
 * Every field is always present: `AnalyzeResult` declares no `Option` and no
 * `skip_serializing_if` at the top level, so an empty universe still emits
 * `{}` / `[]` / `""` for each. Absence therefore means "not this manifest",
 * which is why no reader needs a `?? {}` on a top-level field.
 */
export interface ProjectManifest {
  /** Per-file parse facts — the same `facts::FileFacts` the `extractFacts`
   *  surface returns, hence the same TS type. */
  fileFacts: Record<string, ExtractFileFacts>;
  crossFile: ManifestCrossFileFacts;
  parseCount: number;
  usageResidue: ManifestUsageResidueRecord[];
  /** Complete component CSS, before the TS-side unit fallback. */
  css: string;
  sheets: ManifestSheets;
  /** `analyze_css::CssDiagnostic` entries — the same records
   *  `surfaceManifestDiagnostics` routes, hence its type. */
  diagnostics: ManifestDiagnostic[];
  report: ManifestReconciliationReport;
  /** prop name → value → utility class name. */
  system_prop_map: Record<string, Record<string, string>>;
  /** `dynamic_meta::DynamicPropMeta` entries — typed by the module that turns
   *  them into the runtime `dynamicPropConfig`, which already owns this wire
   *  object's camelCase spelling. */
  dynamic_props: Record<string, DynamicPropMeta>;
  component_fragments: Record<string, ManifestComponentSheets>;
  /** parent component id → child component ids. */
  reverse_provenance: Record<string, string[]>;
  /** component id (`file::binding`) → descriptor. */
  components: Record<string, ManifestComponentDescriptor>;
  /** file path → component ids declared in it. */
  files: Record<string, string[]>;
  timing: ManifestTiming;
}
