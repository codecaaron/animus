interface ValuePropMeta {
  varName: string;
  slotClass: string;
  property?: string | null;
  properties?: readonly string[] | null;
  /** The bound transform's readable name, for diagnostics. */
  transformName?: string | null;
  /** The bound definition's key in the runtime `transforms` registry. */
  transformId?: string | null;
  transformFnSource?: string | null;
  scaleValues?: Record<string, string | number> | null;
  negative?: boolean;
  strict?: boolean;
  keywords?: readonly string[];
  /** The custom property a write of the prop also sets. */
  currentVar?: string | null;
  /**
   * Development only: the conditions (`_` for the base) at which a
   * production build keeps this prop's slot, empty when it keeps none.
   */
  productionConditions?: readonly string[];
  tables?: TableKeys;
  kind?: never;
}

/** Where a meta's tables sit in `animusTables`; a table without a key is
 *  inlined. */
export interface TableKeys {
  scaleValues?: string;
  keywords?: string;
  declarationScaleValues?: string;
}

/** The tables runtime configs share, each by its key. */
export interface RuntimeTables {
  scaleValues: Record<string, Record<string, string | number>>;
  keywords: Record<string, readonly string[]>;
  declarationScaleValues: Record<
    string,
    DeclarationPropMeta['declarationScaleValues']
  >;
}

/** A config's `systemPropNames`: its groups' lists, then its other names. */
export interface PropNameList {
  groups?: readonly string[];
  names?: readonly string[];
}

interface DeclarationPropMeta {
  kind: 'declarations';
  slotClass: string;
  memberVars: Record<string, string>;
  declarationScaleValues: Record<string, Record<string, string>>;
  /**
   * Development only: the conditions (`_` for the base) at which a
   * production build keeps this prop's slot, empty when it keeps none.
   */
  productionConditions?: readonly string[];
  tables?: TableKeys;
}

type DeclarationMeta = DeclarationPropMeta & {
  [
    K in Exclude<
      keyof ValuePropMeta,
      'kind' | 'slotClass' | 'productionConditions' | 'tables'
    >
  ]?: never;
};

export type DynamicPropMeta = ValuePropMeta | DeclarationMeta;

interface ValuePropConfigEntry {
  varName: string;
  slotClass: string;
  property?: string;
  properties?: readonly string[];
  transformName?: string;
  transformId?: string;
  scaleValues?: Record<string, string | number>;
  negative?: boolean;
  strict?: boolean;
  keywords?: readonly string[];
  currentVar?: string;
  productionConditions?: readonly string[];
  kind?: never;
}

type DeclarationConfigEntry = DeclarationPropMeta & {
  [
    K in Exclude<
      keyof ValuePropConfigEntry,
      'kind' | 'slotClass' | 'productionConditions'
    >
  ]?: never;
};

export type DynamicPropConfigEntry =
  | ValuePropConfigEntry
  | DeclarationConfigEntry;

export interface DynamicPropConfig {
  [propName: string]: DynamicPropConfigEntry;
}

export function buildDynamicPropConfig(
  dynamicProps: Record<string, DynamicPropMeta>
): DynamicPropConfig {
  const configEntries: DynamicPropConfig = {};
  for (const [propName, meta] of Object.entries(dynamicProps)) {
    if (meta.kind === 'declarations') {
      if (!meta.slotClass || !meta.memberVars || !meta.declarationScaleValues) {
        throw new Error(
          `buildDynamicPropConfig: declaration prop '${propName}' carries no member metadata — expected slotClass, memberVars and declarationScaleValues.`
        );
      }
      configEntries[propName] = {
        kind: meta.kind,
        slotClass: meta.slotClass,
        memberVars: meta.memberVars,
        declarationScaleValues: meta.declarationScaleValues,
        ...(meta.productionConditions && {
          productionConditions: meta.productionConditions,
        }),
      };
      continue;
    }
    if (!meta.varName || !meta.slotClass) {
      throw new Error(
        `buildDynamicPropConfig: dynamic prop '${propName}' carries no slot metadata — ` +
          `expected varName and slotClass, got keys [${Object.keys(meta).join(', ')}].`
      );
    }
    const entry: ValuePropConfigEntry = {
      varName: meta.varName,
      slotClass: meta.slotClass,
    };
    if (meta.property) entry.property = meta.property;
    if (meta.properties && meta.properties.length > 0) {
      entry.properties = meta.properties;
    }
    if (meta.transformName) entry.transformName = meta.transformName;
    if (meta.transformId) entry.transformId = meta.transformId;
    if (meta.scaleValues && Object.keys(meta.scaleValues).length > 0) {
      entry.scaleValues = meta.scaleValues;
    }
    if (meta.negative) entry.negative = true;
    if (meta.strict) entry.strict = true;
    if (meta.keywords?.length) entry.keywords = meta.keywords;
    if (meta.currentVar) entry.currentVar = meta.currentVar;
    if (meta.productionConditions) {
      entry.productionConditions = meta.productionConditions;
    }
    configEntries[propName] = entry;
  }
  return configEntries;
}
