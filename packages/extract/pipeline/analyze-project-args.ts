/** @internal */
export type AnalyzeProjectArgs = [
  filesJson: string,
  scalesJson: string,
  variableMapJson: string,
  contextualVarsJson: string | null,
  propConfigJson: string,
  groupRegistryJson: string,
  packageResolutionJson: string,
  devMode: boolean,
  emitterConfigJson: string | null,
  selectorAliasesJson: string | null,
  selectorOrderJson: null,
  globalStyleBlocksJson: string | null,
  pathAliasesJson: string | null,
  keyframesJson: string | null,
  staticCssJson: string | null,
  conditionAliasesJson: string | null,
  externalDirsJson: string | null,
  transformSourcesJson: string | null,
  transformProvenanceJson: string | null,
  declarationScalesJson?: string,
  analysisContextJson?: string,
  generatedNamesJson?: string,
  propertyRecordsJson?: string,
];

/** @internal */
export interface AnalyzeProjectInputs {
  filesJson: string;
  scalesJson: string;
  variableMapJson: string;
  contextualVarsJson: string | null;
  propConfigJson: string;
  groupRegistryJson: string;
  packageResolutionJson: string;
  devMode: boolean;
  emitterConfigJson: string | null;
  selectorAliasesJson: string | null;
  globalStyleBlocksJson: string | null;
  pathAliasesJson: string | null;
  keyframesJson: string | null;
  staticCssJson: string | null;
  conditionAliasesJson: string | null;
  externalDirsJson: string | null;
  transformSourcesJson: string | null;
  /** Absent in inputs persisted before it existed: no host-binding
   *  evidence, so configured sources reading `btoa`/`atob` are rejected. */
  transformProvenanceJson?: string | null;
  /** Present only for a theme with declaration scales; absence means none. */
  declarationScalesJson?: string;
  /** Present only when the host knows about renders the analysis cannot
   *  see (`AnalysisContext`); absence means it knows nothing. */
  analysisContextJson?: string;
  /** Present only under a prefix: each generated name and its final name,
   *  renamed in authored component styles. */
  generatedNamesJson?: string;
  /** Present only for a theme with declared properties: a prop writing only
   *  ones registered with a numeric syntax takes a number without a unit. */
  propertyRecordsJson?: string;
}

/** @internal */
export function buildAnalyzeProjectArgs(
  inputs: AnalyzeProjectInputs
): AnalyzeProjectArgs {
  const args: AnalyzeProjectArgs = [
    inputs.filesJson,
    inputs.scalesJson,
    inputs.variableMapJson,
    inputs.contextualVarsJson,
    inputs.propConfigJson,
    inputs.groupRegistryJson,
    inputs.packageResolutionJson,
    inputs.devMode,
    inputs.emitterConfigJson,
    inputs.selectorAliasesJson,
    null,
    inputs.globalStyleBlocksJson,
    inputs.pathAliasesJson,
    inputs.keyframesJson,
    inputs.staticCssJson,
    inputs.conditionAliasesJson,
    inputs.externalDirsJson,
    inputs.transformSourcesJson,
    inputs.transformProvenanceJson ?? null,
  ];
  // Each sent only when present, so the slots of a run without them are
  // unchanged; the context's slot follows the scales' slot.
  const tail = [
    inputs.declarationScalesJson,
    inputs.analysisContextJson,
    inputs.generatedNamesJson,
    inputs.propertyRecordsJson,
  ];
  const last = tail.findLastIndex((slot) => slot !== undefined && slot !== '');
  for (const slot of tail.slice(0, last + 1)) {
    args.push(slot || undefined);
  }
  return args;
}
