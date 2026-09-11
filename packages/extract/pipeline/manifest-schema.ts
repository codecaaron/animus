/**
 * TS mirror of the engine's serde output: field spelling and optionality are
 * the engine's, never a transcription choice. One spelling per field.
 */

import type { DynamicPropMeta } from './dynamic-prop-config';
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
  /** `Family.Slot` dotted key → slot binding name. */
  memberBindings: Record<string, string>;
  renderedComponents: string[];
  /** binding → variant prop → option names. */
  variantOptions: Record<string, Record<string, string[]>>;
  /** binding → state names. */
  stateNames: Record<string, string[]>;
}

export interface ManifestEliminatedDetail {
  component: string;
  /** `"component"` | `"variant"` | `"state"`. */
  kind: string;
  /** Variant option or state name; `null` for a whole component. */
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
  component_fragments: Record<string, ManifestComponentSheets>;
  /** parent component id → child component ids. */
  reverse_provenance: Record<string, string[]>;
  /** component id (`file::binding`) → descriptor. */
  components: Record<string, ManifestComponentDescriptor>;
  /** file path → component ids declared in it. */
  files: Record<string, string[]>;
  timing: ManifestTiming;
}
