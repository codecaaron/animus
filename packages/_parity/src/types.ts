/** Comparison surface from one engine run over one corpus unit. A `type`, not
 *  an `interface`, so it stays assignable to the JSON value domain. */
export type UnitSurface = {
  /** Raw NAPI-emitted CSS, before any TS post-processing. */
  css: string;
  /** Per-file transformed code, keyed by fixture-relative path. */
  code: Record<string, string>;
  hasComponents: Record<string, boolean>;
  /** Sorted `file|kind|component|message` entries, compared as a multiset. */
  diagnostics: string[];
  observables: {
    componentFragmentKeys: string[];
    reverseProvenanceEdges: string[];
    /** Compared after `JSON.parse`: JS canonicalizes integer-like keys, so
     *  comparing the emitted text would diverge on spelling alone. */
    systemPropMapJson: string;
    dynamicPropsJson: string;
    /** Per-layer sheet contents and per-component fragment values; both reach
     *  consumers through plugin dev-split delivery and the fragment cache. */
    sheetsJson: string;
    componentFragmentsJson: string;
  };
  parseCount: number | null;
};

/** One corpus unit = one independent analyzeProject invocation. */
export interface CorpusUnit {
  id: string;
  files: Array<{ path: string; source: string }>;
  configSource: 'test-system';
}

export type ArtifactClass =
  | 'css'
  | 'code'
  | 'observables'
  | 'diagnostics'
  | 'css-validity';

export type CssClassification =
  | 'formatting'
  | 'rule-order'
  | 'selector'
  | 'value';

export interface Divergence {
  unit: string;
  artifact: ArtifactClass;
  detail: string;
  baselineSha256: string;
  candidateSha256: string;
  classification?: CssClassification;
  registered?: RegisterEntry;
}

export type RegisterCategory =
  | 'intentional-correctness'
  | 'ordering'
  | 'known-quirk';

export interface RegisterEntry {
  /** Exact unit id for active rows; anticipated rows may describe a prefix. */
  unit: string;
  artifact: ArtifactClass | 'any';
  category: RegisterCategory;
  note: string;
  /** anticipated = recorded before any engine pair can produce it. */
  status: 'active' | 'anticipated';
  /** Required, exact content identities for an active row. */
  baselineSha256?: string;
  candidateSha256?: string;
}

export interface FamilyDecl {
  family: string;
  units: string[];
  expectedVerdict: 'identical' | 'registered-divergence';
  registerCategory?: RegisterCategory;
  note?: string;
}
