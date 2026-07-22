import { buildDynamicPropConfig } from './dynamic-prop-config';

import type { DynamicPropMeta } from './dynamic-prop-config';

/**
 * Build the source of the runtime system-props module — served as
 * `virtual:animus/system-props` by the Vite plugin and written to
 * `.animus/system-props.js` by the Next plugin. One generator so the two
 * runtimes can never drift.
 *
 * Runtime transform functions for dynamic props are not yet supported
 * (transforms are resolved at extraction time via boa_engine in Rust), so
 * `transforms` defaults to an empty object literal.
 */
export function buildSystemPropsModule(opts: {
  systemPropMapJson: string;
  groupRegistryJson: string;
  dynamicProps: Record<string, DynamicPropMeta>;
  transformsSource?: string;
}): string {
  const dynamicPropConfig = buildDynamicPropConfig(opts.dynamicProps);
  return (
    `export const systemPropMap = ${opts.systemPropMapJson};\n` +
    `export const systemPropGroups = ${opts.groupRegistryJson};\n` +
    `export const dynamicPropConfig = ${JSON.stringify(dynamicPropConfig)};\n` +
    `export const transforms = ${opts.transformsSource ?? '{}'};\n`
  );
}
