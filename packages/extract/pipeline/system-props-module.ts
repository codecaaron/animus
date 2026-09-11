import { buildDynamicPropConfig } from './dynamic-prop-config';

import type { DynamicPropMeta } from './dynamic-prop-config';

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
