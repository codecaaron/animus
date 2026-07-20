/**
 * Shared pipeline helper for integration tests.
 *
 * Drives the stateful v2 `ExtractEngine` (packages/extract/index-v2.js) exactly
 * as both production plugins do through `pipeline/engine-adapter.ts`: build an
 * `EngineOptions` object from the serialized theme + config, construct the
 * engine, and call `analyze()` once over the file set. The positional
 * `analyzeProject(filesJson, …)` surface is retained as the engine-invocation
 * layer so the direct-call test sites keep their exact v1-shaped argument
 * tuples — only the import source moves from the retired `../../extract/index.js`
 * to this helper. Same code path as the vite-plugin, minus file discovery and
 * subprocess.
 */
import { applyUnitFallback } from '@animus-ui/extract/pipeline';

import { config, theme } from '../fixtures/setup';

// Direct-path require of the v2 loader per the _integration NAPI-loading
// contract (see CLAUDE.md): index-v2.js is the package's only engine and its
// root entry. Package-specifier resolution is forbidden here.
const native = require('../../extract/index-v2.js');

/** The stateful v2 engine handle produced by `new native.ExtractEngine(...)`. */
interface V2ExtractEngine {
  analyze(filesJson: string): string;
  transformFile(path: string): string;
  clearCache(): void;
}

/** The retained engine from the most recent `analyzeProject` call. */
let lastEngine: V2ExtractEngine | null = null;

/**
 * Positional v2-backed shim for the retired v1 `analyzeProject` NAPI free
 * function. Trailing arguments are optional (the direct-call sites use a 9-arg
 * subset; `runPipeline` and the keyframes tests use the full 14). The tuple
 * maps to the v2 `EngineOptions` object exactly as engine-adapter.ts does:
 * `null` slots become `undefined` (NAPI `Option<String>` rejects `null`), the
 * emitter-config JSON is decomposed into `runtimeImport` / `cssModuleId` /
 * `systemPropsModuleId`, and the retained selector-order slot (index 10) has no
 * v2 field and is ignored.
 */
export type AnalyzeProject = (
  filesJson: string,
  scalesJson: string,
  variableMapJson: string,
  contextualVarsJson: string | null,
  propConfigJson: string,
  groupRegistryJson: string,
  packageResolutionJson: string,
  devMode: boolean,
  emitterConfigJson?: string | null,
  selectorAliasesJson?: string | null,
  selectorOrderJson?: string | null,
  globalStyleBlocksJson?: string | null,
  pathAliasesJson?: string | null,
  keyframesJson?: string | null
) => string;

export const analyzeProject: AnalyzeProject = (
  filesJson,
  scalesJson,
  variableMapJson,
  contextualVarsJson,
  propConfigJson,
  groupRegistryJson,
  packageResolutionJson,
  devMode,
  emitterConfigJson = null,
  selectorAliasesJson = null,
  // Retained selector-order NAPI slot — v2 has no selector-order field.
  _selectorOrderJson = null,
  globalStyleBlocksJson = null,
  pathAliasesJson = null,
  keyframesJson = null
) => {
  const emitterConfig = emitterConfigJson
    ? (JSON.parse(emitterConfigJson) as {
        runtime_import?: string;
        css_module_id?: string;
        system_props_module_id?: string;
      })
    : {};

  const engine = new native.ExtractEngine({
    runtimeImport: emitterConfig.runtime_import ?? undefined,
    cssModuleId: emitterConfig.css_module_id ?? undefined,
    systemPropsModuleId: emitterConfig.system_props_module_id ?? undefined,
    themeJson: scalesJson,
    variableMapJson,
    contextualVarsJson: contextualVarsJson ?? undefined,
    configJson: propConfigJson,
    groupRegistryJson,
    selectorAliasesJson: selectorAliasesJson ?? undefined,
    globalStyleBlocksJson: globalStyleBlocksJson ?? undefined,
    keyframesJson: keyframesJson ?? undefined,
    packageResolutionJson: packageResolutionJson ?? undefined,
    pathAliasesJson: pathAliasesJson ?? undefined,
    devMode,
  }) as V2ExtractEngine;
  lastEngine = engine;
  return engine.analyze(filesJson);
};

/** Reset retained engine state (v2 `ExtractEngine.clearCache`). */
export function clearAnalysisCache(): void {
  lastEngine?.clearCache();
  lastEngine = null;
}

export function runPipeline(
  fileEntries: Array<{ path: string; source: string }>,
  options: { devMode?: boolean } = {},
  analyze: AnalyzeProject = analyzeProject
) {
  // Mirrors the production vite-plugin `runAnalysis` 14-arg call — including
  // `selectorAliasesJson` so integration coverage exercises selector-alias
  // processing, plus `null` in the retained selector-order slot.
  // Placeholder nulls cover args with no integration-test analog
  // (`pathAliasesJson`, `keyframesJson`, `globalStyleBlocksJson`).
  //
  // `options.devMode` toggles the engine's `devMode` — defaults to false
  // (production semantics). Pass true to exercise the prospective-elimination
  // path required by the `css-reconciler` dev/build parity contract.
  const manifestJson = analyze(
    JSON.stringify(fileEntries),
    theme.scalesJson,
    theme.variableMapJson,
    theme.contextualVarsJson || null,
    config.propConfig,
    config.groupRegistry,
    '{}',
    options.devMode ?? false,
    null,
    config.selectorAliases,
    null,
    null,
    null,
    null
  );

  const manifest = JSON.parse(manifestJson);
  const css = applyUnitFallback(manifest.css || '');

  return { manifest, css };
}
