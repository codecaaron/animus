/**
 * CSS post-processing — the implementation lives in
 * `@animus-ui/extract/pipeline` (spec: css-post-processing, single
 * implementation across plugins). This module re-exports it for the
 * plugin's hook modules.
 */
export type { LightningTargets } from '@animus-ui/extract/pipeline';
export {
  postProcessCss,
  resolveLightningTargets,
} from '@animus-ui/extract/pipeline';
