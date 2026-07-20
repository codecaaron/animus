/**
 * snake_case → camelCase mapping for the manifest's `dynamic_props` block.
 *
 * Single authoritative copy for both extraction plugins: the emitted
 * `dynamicPropConfig` object in each plugin's system-props module is
 * `JSON.stringify(buildDynamicPropConfig(...))`, so field order and the
 * omission rules (no `transformName` when absent, no `scaleValues` when
 * empty) are part of the emitted-bundle contract.
 */

export interface DynamicPropMeta {
  var_name: string;
  slot_class: string;
  transform_name?: string | null;
  scale_values?: Record<string, string> | null;
}

export interface DynamicPropConfigEntry {
  varName: string;
  slotClass: string;
  transformName?: string;
  scaleValues?: Record<string, string>;
}

export function buildDynamicPropConfig(
  dynamicProps: Record<string, DynamicPropMeta>
): Record<string, DynamicPropConfigEntry> {
  const configEntries: Record<string, DynamicPropConfigEntry> = {};
  for (const [propName, meta] of Object.entries(dynamicProps)) {
    configEntries[propName] = {
      varName: meta.var_name,
      slotClass: meta.slot_class,
      ...(meta.transform_name ? { transformName: meta.transform_name } : {}),
      ...(meta.scale_values && Object.keys(meta.scale_values).length > 0
        ? { scaleValues: meta.scale_values }
        : {}),
    };
  }
  return configEntries;
}
