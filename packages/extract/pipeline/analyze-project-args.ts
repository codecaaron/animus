/**
 * The positional argument tuple for the NAPI `analyzeProject` call.
 *
 * This is the single authoritative copy of the 14-slot contract consumed by
 * both extraction plugins (vite-plugin and next-plugin). The slot order is
 * mirrored by the Rust NAPI surface — changing it requires a coordinated
 * Rust-side update.
 */

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
  // Appended slot (modern-css-surface inc 03): condition alias map JSON.
  // Appended (not inserted mid-tuple) so existing slot positions are stable.
  conditionAliasesJson: string | null,
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
  /** Forced-emission declarations (spec: static-emission-overrides). */
  staticCssJson: string | null;
  /** Condition alias map JSON (modern-css-surface inc 03), or null. */
  conditionAliasesJson: string | null;
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
  ];
}
