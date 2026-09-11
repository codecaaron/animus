export interface DynamicPropMeta {
  varName: string;
  slotClass: string;
  property?: string | null;
  properties?: readonly string[] | null;
  transformName?: string | null;
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

export interface DynamicPropConfig {
  [propName: string]: DynamicPropConfigEntry;
}

export function buildDynamicPropConfig(
  dynamicProps: Record<string, DynamicPropMeta>
): DynamicPropConfig {
  const configEntries: DynamicPropConfig = {};
  for (const [propName, meta] of Object.entries(dynamicProps)) {
    if (!meta.varName || !meta.slotClass) {
      throw new Error(
        `buildDynamicPropConfig: dynamic prop '${propName}' carries no slot metadata — ` +
          `expected varName and slotClass, got keys [${Object.keys(meta).join(', ')}].`
      );
    }
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
