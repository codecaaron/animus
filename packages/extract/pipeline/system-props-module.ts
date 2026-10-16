import { buildDynamicPropConfig } from './dynamic-prop-config';

import type {
  DynamicPropConfig,
  DynamicPropMeta,
  PropNameList,
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
    if ('transformId' in entry && entry.transformId !== undefined) {
      fields.push(
        `"transform":transforms[${JSON.stringify(entry.transformId)}]`
      );
    }
    return `${JSON.stringify(prop)}:{${fields.join(',')}}`;
  });
  return `{${entries.join(',')}}`;
}

/** Each shared `systemPropNames` list as its own export, so a bundle keeps
 *  only the lists its components reference. */
function propNameListsSource(
  lists: Record<string, PropNameList> | undefined
): string {
  return Object.entries(lists ?? {})
    .map(([key, { groups = [], names = [] }]) => {
      const list =
        groups.length === 0
          ? JSON.stringify(names)
          : `[].concat(${[
              ...groups.map((group) => `systemPropGroups.${group}`),
              ...(names.length > 0 ? [JSON.stringify(names)] : []),
            ].join(',')})`;
      return `export const systemPropNames_${key} = ${list};\n`;
    })
    .join('');
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
    `export const systemPropMap = ${opts.systemPropMapJson};\n` +
    `export const systemPropGroups = ${opts.groupRegistryJson};\n` +
    propNameListsSource(opts.propNameLists) +
    // A config narrows the system's one table to its own props.
    (opts.supersededBy && Object.keys(opts.supersededBy).length > 0
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
