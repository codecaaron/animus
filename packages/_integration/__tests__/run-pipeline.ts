/**
 * Shared pipeline helper for integration tests.
 *
 * Runs the full extraction pipeline: NAPI → transform resolution → unit fallback.
 * Same code path as the vite-plugin, minus file discovery and subprocess.
 */
import { createRequire } from 'node:module';

import {
  applyUnitFallback,
  resolveTransformPlaceholders,
} from '@animus-ui/extract/pipeline';

import { config, theme } from '../fixtures/setup';

const require = createRequire(import.meta.url);
const { analyzeProject, clearAnalysisCache } = require('@animus-ui/extract');

export { clearAnalysisCache };

export function runPipeline(
  fileEntries: Array<{ path: string; source: string }>
) {
  const manifestJson = analyzeProject(
    JSON.stringify(fileEntries),
    theme.scalesJson,
    theme.variableMapJson,
    theme.contextualVarsJson || null,
    config.propConfig,
    config.groupRegistry,
    '{}',
    false,
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
