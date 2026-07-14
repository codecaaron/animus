/** Comparison surface produced by one engine run over one corpus unit. */
export interface UnitSurface {
  /** Complete emitted CSS (raw NAPI output, before TS post-processing). */
  css: string;
  /** Per-file transformed code, keyed by fixture-relative path. */
  code: Record<string, string>;
  /** Per-file hasComponents flag. */
  hasComponents: Record<string, boolean>;
  /** Diagnostics multiset entries: `${kind}|${component}|${message}` per file. */
  diagnostics: string[];
  /** Manifest-derived observables (manifest itself has no parity by design). */
  observables: {
    componentFragmentKeys: string[];
    reverseProvenanceEdges: string[];
    /** Consumer-reaching virtual-module composition strings, post-JSON.parse
     *  (JS canonicalizes integer-like keys; comparisons must be post-parse). */
    systemPropMapJson: string;
    dynamicPropsJson: string;
    /** Per-layer sheet contents + per-component fragment VALUES — both
     *  consumer-visible (vite-plugin dev split delivery / fragment cache;
     *  next-plugin sheets.global). Inc-02 review falsifier finding. */
    sheetsJson: string;
    componentFragmentsJson: string;
  };
  /** Parser invocation count reported by the engine, or null if the engine
   *  does not report one. */
  parseCount: number | null;
}

/** One corpus unit = one independent analyzeProject invocation. */
export interface CorpusUnit {
  id: string;
  files: Array<{ path: string; source: string }>;
  /** Which serialized config feeds the engine (both corpora currently share
   *  the canary test-system). */
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
  /** Exact content identity for refresh licensing. */
  baselineSha256: string;
  candidateSha256: string;
  classification?: CssClassification;
  registered?: RegisterEntry;
}

export type RegisterCategory =
  | 'intentional-correctness'
  | 'ordering'
  | 'v1-feature-drift'
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
  /** Corpus unit ids that realize this family. */
  units: string[];
  expectedVerdict: 'identical' | 'registered-divergence';
  registerCategory?: RegisterCategory;
  note?: string;
}
