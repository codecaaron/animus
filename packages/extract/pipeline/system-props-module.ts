import { buildDynamicPropConfig } from './dynamic-prop-config';

import type {
  DynamicPropConfig,
  DynamicPropMeta,
  RuntimeTables,
  TableKeys,
} from './dynamic-prop-config';
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

/** The system's dynamic config as source, each table its meta keys in
 *  `animusTables` referenced there rather than inlined, and each bound
 *  transform read from the module's `transforms`. */
function dynamicPropConfigSource(
  config: DynamicPropConfig,
  dynamicProps: Record<string, DynamicPropMeta>
): string {
  const entries = Object.entries(config).map(([prop, entry]) => {
    const keys: TableKeys = dynamicProps[prop]?.tables ?? {};
    const fields = Object.entries(entry).map(([field, value]) => {
      const key =
        field === 'scaleValues' ||
        field === 'keywords' ||
        field === 'declarationScaleValues'
          ? keys[field]
          : undefined;
      const source =
        key === undefined
          ? JSON.stringify(value)
          : `animusTables.${field}[${JSON.stringify(key)}]`;
      return `${JSON.stringify(field)}:${source}`;
    });
    if ('transformId' in entry && entry.transformId) {
      fields.push(
        `"transform":transforms[${JSON.stringify(entry.transformId)}]`
      );
    }
    return `${JSON.stringify(prop)}:{${fields.join(',')}}`;
  });
  return `{${entries.join(',')}}`;
}

/** Each shared `systemPropNames` list, its source as analysis rendered it,
 *  as its own export, so a bundle keeps only the lists its components
 *  reference. */
function propNameListsSource(
  lists: ProjectManifest['prop_name_lists']
): string {
  return Object.entries(lists ?? {})
    .map(([key, list]) => `export const systemPropNames_${key} = ${list};\n`)
    .join('');
}

/** The `systemPropMap` export, and what ends it: the generator writes the
 *  groups export next, and the map's JSON holds no `;` outside a string and
 *  no raw newline inside one. */
const SYSTEM_PROP_MAP_EXPORT = 'export const systemPropMap = ';
const SYSTEM_PROP_MAP_END = ';\nexport const systemPropGroups = ';

/** Where the `systemPropMap` export's JSON lies in a module
 *  `buildSystemPropsModule` wrote, as `[start, end)`; `null` for a module it
 *  did not write. */
export function systemPropMapSpan(source: string): [number, number] | null {
  // Where a line opens with the export: the source's first line counts.
  const line = `\n${source}`.indexOf(`\n${SYSTEM_PROP_MAP_EXPORT}`);
  const end = line < 0 ? -1 : source.indexOf(SYSTEM_PROP_MAP_END, line);
  return end < 0 ? null : [line + SYSTEM_PROP_MAP_EXPORT.length, end];
}

export function buildSystemPropsModule(opts: {
  systemPropMapJson: string;
  groupRegistryJson: string;
  dynamicProps: Record<string, DynamicPropMeta>;
  admittedTransforms: ProjectManifest['admitted_transforms'];
  typedSystemProps: ProjectManifest['typed_system_props'];
  runtimeTables: RuntimeTables | undefined;
  propNameLists?: ProjectManifest['prop_name_lists'];
  supersededBy?: ProjectManifest['superseded_by'];
}): string {
  const dynamicPropConfig = buildDynamicPropConfig(opts.dynamicProps);
  return (
    // Every config that references a table imports this one export.
    (opts.runtimeTables
      ? `export const animusTables = ${JSON.stringify(opts.runtimeTables)};\n`
      : '') +
    `${SYSTEM_PROP_MAP_EXPORT}${opts.systemPropMapJson}` +
    `${SYSTEM_PROP_MAP_END}${opts.groupRegistryJson};\n` +
    propNameListsSource(opts.propNameLists) +
    // A config narrows the system's one table to its own props.
    (opts.supersededBy
      ? `export const supersededBy = ${JSON.stringify(opts.supersededBy)};\n`
      : '') +
    `export const transforms = ${transformsSource(opts.admittedTransforms)};\n` +
    `export const dynamicPropConfig = ${dynamicPropConfigSource(dynamicPropConfig, opts.dynamicProps)};\n` +
    // Only a component reading a typed system prop imports the list.
    (opts.typedSystemProps.length > 0
      ? `export const typedSystemProps = ${JSON.stringify(opts.typedSystemProps)};\n`
      : '')
  );
}
