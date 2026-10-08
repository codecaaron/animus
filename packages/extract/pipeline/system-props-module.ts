import { buildDynamicPropConfig } from './dynamic-prop-config';

import type { DynamicPropMeta } from './dynamic-prop-config';
import type { ProjectManifest } from './manifest-schema';

/** Compiles the exact entry text in strict mode, the mode of the ES module it
 *  lands in, without evaluating it: one malformed entry would otherwise fail
 *  the whole module. */
function parsesAsEntry(entry: string): boolean {
  try {
    Function(`'use strict'; return {\n${entry}};`);
    return true;
  } catch {
    return false;
  }
}

/** Delivers the loaded system's configured transform sources that analysis
 *  admitted, keyed by definition and wrapped as `({source})` like the
 *  build-time evaluator registers them. Static evaluation uses the same
 *  definitions, so a same-named project declaration reaches neither path. */
function transformsSource(
  admittedTransforms: ProjectManifest['admitted_transforms']
): string {
  const entries = Object.entries(admittedTransforms)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, source]) => `  ${JSON.stringify(name)}: (${source}),\n`)
    .filter(parsesAsEntry);
  return entries.length > 0 ? `{\n${entries.join('')}}` : '{}';
}

export function buildSystemPropsModule(opts: {
  systemPropMapJson: string;
  groupRegistryJson: string;
  dynamicProps: Record<string, DynamicPropMeta>;
  admittedTransforms: ProjectManifest['admitted_transforms'];
  typedSystemProps: ProjectManifest['typed_system_props'];
}): string {
  const dynamicPropConfig = buildDynamicPropConfig(opts.dynamicProps);
  return (
    `export const systemPropMap = ${opts.systemPropMapJson};\n` +
    `export const systemPropGroups = ${opts.groupRegistryJson};\n` +
    `export const dynamicPropConfig = ${JSON.stringify(dynamicPropConfig)};\n` +
    `export const transforms = ${transformsSource(opts.admittedTransforms)};\n` +
    // Only a component reading a typed system prop imports the list.
    (opts.typedSystemProps.length > 0
      ? `export const typedSystemProps = ${JSON.stringify(opts.typedSystemProps)};\n`
      : '')
  );
}
