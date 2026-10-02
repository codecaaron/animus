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
}

/** @internal */
export function buildAnalyzeProjectArgs(
  inputs: AnalyzeProjectInputs
): AnalyzeProjectArgs {
  return [
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
}
