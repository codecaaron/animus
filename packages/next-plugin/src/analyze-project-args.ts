import { buildAnalyzeProjectArgs } from '@animus-ui/extract/pipeline';

import type {
  AnalyzeProjectArgs,
  AnalyzeProjectInputs as PipelineAnalyzeProjectInputs,
} from '@animus-ui/extract/pipeline';

export type { AnalyzeProjectArgs } from '@animus-ui/extract/pipeline';

/**
 * Next-plugin call sites carry devMode implicitly (production vs HMR entry
 * point), so the local input shape omits it; the authoritative 14-slot tuple
 * lives in @animus-ui/extract/pipeline.
 */
export type AnalyzeProjectInputs = Omit<
  PipelineAnalyzeProjectInputs,
  'devMode'
>;

export function buildProductionAnalyzeProjectArgs(
  inputs: AnalyzeProjectInputs
): AnalyzeProjectArgs {
  return buildAnalyzeProjectArgs({ ...inputs, devMode: false });
}

export function buildHmrAnalyzeProjectArgs(
  inputs: AnalyzeProjectInputs
): AnalyzeProjectArgs {
  return buildAnalyzeProjectArgs({ ...inputs, devMode: true });
}
