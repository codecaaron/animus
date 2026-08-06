/**
 * Manifest `dynamic_props` → runtime `dynamicPropConfig` mapping.
 *
 * Single authoritative copy for both extraction plugins: the emitted
 * `dynamicPropConfig` object in each plugin's system-props module is
 * `JSON.stringify(buildDynamicPropConfig(...))`, so field order and the
 * omission rules (no `property` when absent, no `properties` when empty, no
 * `transformName` when absent, no `scaleValues` when empty) are part of the
 * emitted-bundle contract. Field order matches the per-component
 * `customDynamicConfig` the Rust assembler emits.
 *
 * The v2 manifest serializes `DynamicPropMeta` with
 * `serde(rename_all = "camelCase")`, so both plugins hand this builder
 * camelCase fields; the snake_case spelling is the older hand-written shape
 * and stays accepted. `property`/`properties` are single words — identical in
 * both spellings.
 */

export interface DynamicPropMeta {
  varName?: string;
  slotClass?: string;
  property?: string | null;
  properties?: readonly string[] | null;
  transformName?: string | null;
  /** Carried by the manifest for the per-component config; the shared module
   *  resolves transforms through the `transforms` registry, so it is dropped. */
  transformFnSource?: string | null;
  scaleValues?: Record<string, string> | null;
  var_name?: string;
  slot_class?: string;
  transform_name?: string | null;
  scale_values?: Record<string, string> | null;
}

export interface DynamicPropConfigEntry {
  varName: string;
  slotClass: string;
  property?: string;
  properties?: readonly string[];
  transformName?: string;
  scaleValues?: Record<string, string>;
}

export function buildDynamicPropConfig(
  dynamicProps: Record<string, DynamicPropMeta>
): Record<string, DynamicPropConfigEntry> {
  const configEntries: Record<string, DynamicPropConfigEntry> = {};
  for (const [propName, meta] of Object.entries(dynamicProps)) {
    const varName = meta.varName ?? meta.var_name;
    const slotClass = meta.slotClass ?? meta.slot_class;
    if (!varName || !slotClass) {
      // Loud on purpose: a rename on the manifest side has to fail the build,
      // not ship a config whose entries silently serialize to `{}`.
      throw new Error(
        `buildDynamicPropConfig: dynamic prop '${propName}' carries no slot metadata — ` +
          `expected varName/slotClass (the manifest's camelCase spelling) or ` +
          `var_name/slot_class (the legacy spelling), got keys [${Object.keys(meta).join(', ')}].`
      );
    }
    const transformName = meta.transformName ?? meta.transform_name;
    const scaleValues = meta.scaleValues ?? meta.scale_values;
    configEntries[propName] = {
      varName,
      slotClass,
      ...(meta.property ? { property: meta.property } : {}),
      ...(meta.properties && meta.properties.length > 0
        ? { properties: meta.properties }
        : {}),
      ...(transformName ? { transformName } : {}),
      ...(scaleValues && Object.keys(scaleValues).length > 0
        ? { scaleValues }
        : {}),
    };
  }
  return configEntries;
}
