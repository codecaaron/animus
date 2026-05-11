/**
 * Shared pipeline helper for integration tests.
 *
 * Runs the full extraction pipeline: NAPI → transform resolution → unit fallback.
 * Same code path as the vite-plugin, minus file discovery and subprocess.
 */
import {
  applyUnitFallback,
  resolveTransformPlaceholders,
} from '@animus-ui/extract/pipeline';

import { config, theme } from '../fixtures/setup';

const {
  analyzeProject,
  clearAnalysisCache,
} = require('../../extract/index.js');

export { clearAnalysisCache };

export function runPipeline(
  fileEntries: Array<{ path: string; source: string }>,
  options: { devMode?: boolean } = {}
) {
  // Mirrors the production vite-plugin `runAnalysis` 14-arg call — including
  // `selectorAliasesJson` and `selectorOrderJson` so integration coverage
  // exercises selector-alias processing. Placeholder nulls for args with no
  // integration-test analog (`pathAliasesJson`, `keyframesBlocksJson`,
  // `globalStyleBlocksJson`).
  //
  // `options.devMode` toggles NAPI `dev_mode` — defaults to false (production
  // semantics). Pass true to exercise the prospective-elimination path
  // required by the `css-reconciler` dev/build parity contract.
  const manifestJson = analyzeProject(
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
    config.selectorOrder,
    null,
    null,
    null
  );

  const manifest = JSON.parse(manifestJson);
  let css: string = manifest.css || '';

  // Resolve transform placeholders using live functions
  if (css.includes('__TRANSFORM__') && config.transforms) {
    css = resolveTransformPlaceholders(css, config.transforms);
  }

  // Apply unit fallback
  css = applyUnitFallback(css);

  return { manifest, css };
}
