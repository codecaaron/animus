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
 * The v2 manifest is the only producer, and it serializes `DynamicPropMeta`
 * with `serde(rename_all = "camelCase")` — so camelCase is the only spelling
 * this reader accepts, and the throw below is what a rename on the Rust side
 * runs into.
 */

export interface DynamicPropMeta {
  varName: string;
  slotClass: string;
  property?: string | null;
  properties?: readonly string[] | null;
  transformName?: string | null;
  /** Carried by the manifest for the per-component config; the shared module
   *  resolves transforms through the `transforms` registry, so it is dropped. */
  transformFnSource?: string | null;
  scaleValues?: Record<string, string> | null;
}

export interface DynamicPropConfigEntry {
  varName: string;
  slotClass: string;
  property?: string;
  properties?: readonly string[];
  transformName?: string;
  scaleValues?: Record<string, string>;
}

/**
 * The emitted `dynamicPropConfig` object: prop name → its slot config entry.
 * Named because this map IS the system-props module's serialized contract —
 * `JSON.stringify` of exactly this value is what each plugin writes.
 */
export interface DynamicPropConfig {
  [propName: string]: DynamicPropConfigEntry;
}

export function buildDynamicPropConfig(
  dynamicProps: Record<string, DynamicPropMeta>
): DynamicPropConfig {
  const configEntries: DynamicPropConfig = {};
  for (const [propName, meta] of Object.entries(dynamicProps)) {
    if (!meta.varName || !meta.slotClass) {
      // Loud on purpose: a rename on the manifest side has to fail the build,
      // not ship a config whose entries silently serialize to `{}`.
      throw new Error(
        `buildDynamicPropConfig: dynamic prop '${propName}' carries no slot metadata — ` +
          `expected varName and slotClass, got keys [${Object.keys(meta).join(', ')}].`
      );
    }
    // Assigned in emission order rather than spread conditionally: the key
    // order below IS the serialized field order.
    const entry: DynamicPropConfigEntry = {
      varName: meta.varName,
      slotClass: meta.slotClass,
    };
    if (meta.property) entry.property = meta.property;
    if (meta.properties && meta.properties.length > 0) {
      entry.properties = meta.properties;
    }
    if (meta.transformName) entry.transformName = meta.transformName;
    if (meta.scaleValues && Object.keys(meta.scaleValues).length > 0) {
      entry.scaleValues = meta.scaleValues;
    }
    configEntries[propName] = entry;
  }
  return configEntries;
}
