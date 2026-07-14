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
];

export interface AnalyzeProjectInputs {
  filesJson: string;
  scalesJson: string;
  variableMapJson: string;
  contextualVarsJson: string | null;
  propConfigJson: string;
  groupRegistryJson: string;
  packageResolutionJson: string;
  emitterConfigJson: string | null;
  selectorAliasesJson: string | null;
  globalStyleBlocksJson: string | null;
  pathAliasesJson: string | null;
  keyframesJson: string | null;
}

function buildAnalyzeProjectArgs(
  inputs: AnalyzeProjectInputs,
  devMode: boolean
): AnalyzeProjectArgs {
  return [
    inputs.filesJson,
    inputs.scalesJson,
    inputs.variableMapJson,
    inputs.contextualVarsJson,
    inputs.propConfigJson,
    inputs.groupRegistryJson,
    inputs.packageResolutionJson,
    devMode,
    inputs.emitterConfigJson,
    inputs.selectorAliasesJson,
    null,
    inputs.globalStyleBlocksJson,
    inputs.pathAliasesJson,
    inputs.keyframesJson,
  ];
}

export function buildProductionAnalyzeProjectArgs(
  inputs: AnalyzeProjectInputs
): AnalyzeProjectArgs {
  return buildAnalyzeProjectArgs(inputs, false);
}

export function buildHmrAnalyzeProjectArgs(
  inputs: AnalyzeProjectInputs
): AnalyzeProjectArgs {
  return buildAnalyzeProjectArgs(inputs, true);
}
