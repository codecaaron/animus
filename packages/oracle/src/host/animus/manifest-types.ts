import { AnimusAdapterError } from './errors';

export type ManifestJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly ManifestJsonValue[]
  | ManifestJsonObject;

export interface ManifestJsonObject {
  readonly [key: string]: ManifestJsonValue | undefined;
}

export type ManifestTerminal = 'asElement' | 'asComponent' | 'asClass';

export type ManifestSpan = readonly [number, number];

export interface ManifestComponent {
  file: string;
  binding: string;
  class_name: string;
  extends_from?: string | null;
  terminal: ManifestTerminal;
  tag?: string | null;
  replacement: string;
  system_prop_names?: readonly string[] | null;
  [key: string]: ManifestJsonValue | undefined;
}

export type ManifestStageDescriptor = {
  method: string;
  argSpan?: ManifestSpan | null;
  secondArgSpan?: ManifestSpan | null;
};

export type ManifestChainDescriptor = {
  binding: string;
  terminal?: string;
  tag?: string | null;
  stages: readonly ManifestStageDescriptor[];
  extractable?: boolean;
  bailReason?: string | null;
  span?: ManifestSpan | null;
  extendsFrom?: string | null;
};

export type ManifestStage = {
  method: string;
  value?: ManifestJsonValue;
  secondValue?: ManifestJsonValue;
  evalError?: string | null;
};

export type ManifestChain = {
  className: string;
  descriptor: ManifestChainDescriptor;
  stages: readonly ManifestStage[];
  fatalError?: string | null;
};

export type ManifestUsageAttr = {
  name: string;
  staticValue?: ManifestJsonValue;
  enumerableValues?: readonly ManifestJsonValue[];
  dynamic?: boolean;
  dynamicKind?: string | null;
  dynamicSpan?: { start: number; end: number } | null;
  skip?: boolean;
  variantClass?: string;
};

export type ManifestUsageFact = {
  element?: {
    tag: { ident?: string; member?: string };
    attrs: readonly ManifestUsageAttr[];
  };
  createElement?: {
    ident?: string | null;
    member?: string | null;
  };
};

export type ManifestImportFact = {
  local: string;
  imported: string;
  source: string;
};

export interface ManifestFileFacts {
  path?: string;
  chains?: readonly ManifestChain[];
  usage?: readonly ManifestUsageFact[];
  imports?: readonly ManifestImportFact[];
  [key: string]: ManifestJsonValue | undefined;
}

export type ManifestDynamicProp = {
  varName: string;
  slotClass: string;
  property?: string | null;
  properties?: readonly string[] | null;
  transformName?: string | null;
  scaleValues?: Readonly<Record<string, string>> | null;
};

export type ManifestUsageResidue = {
  binding: string;
  prop: string;
  file: string;
  span: { start: number; end: number };
  kind: string;
};

export type ManifestEliminated = {
  component: string;
  kind: string;
  name?: string | null;
  reason: string;
};

export interface ManifestReport {
  eliminated_details?: readonly ManifestEliminated[];
  [key: string]: ManifestJsonValue | undefined;
}

export type ManifestSheets = Readonly<Record<string, string | undefined>>;

export interface AnimusManifest {
  components: Readonly<Record<string, ManifestComponent>>;
  files?: Readonly<Record<string, readonly string[]>>;
  reverse_provenance?: Readonly<Record<string, readonly string[]>>;
  sheets: ManifestSheets;
  component_fragments?: Readonly<
    Record<string, Readonly<Record<string, string>>>
  >;
  fileFacts?: Readonly<Record<string, ManifestFileFacts>>;
  usageResidue?: readonly ManifestUsageResidue[];
  dynamic_props?: Readonly<Record<string, ManifestDynamicProp>>;
  system_prop_map?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  report?: ManifestReport;
  [key: string]: ManifestJsonValue | undefined;
}

export const isRecord = (value: unknown): value is ManifestJsonObject =>
  Object(value) === value &&
  Object.prototype.toString.call(value) === '[object Object]';

export const isManifestJsonObject = (
  value: ManifestJsonValue | undefined
): value is ManifestJsonObject => isRecord(value);

export const isManifestJsonString = (
  value: ManifestJsonValue | undefined
): value is string =>
  Object(value) !== value &&
  Object.prototype.toString.call(value) === '[object String]';

const TAG_PREFIX = '[object ';

const describeRejected = <Value>(value: Value): string =>
  Object.prototype.toString
    .call(value)
    .slice(TAG_PREFIX.length, -1)
    .toLowerCase();

export const asManifest = <Value>(value: Value): AnimusManifest => {
  if (!isRecord(value)) {
    throw new AnimusAdapterError(
      'manifest is not a JSON object — expected the contents of ' +
        '`manifest.json` as produced by `animus build`, got ' +
        describeRejected(value),
      { construct: 'manifest' }
    );
  }
  const admitted: ManifestJsonObject = value;
  if (!isRecord(admitted.components)) {
    throw new AnimusAdapterError(
      'manifest has no `components` map — this is not an animus extraction ' +
        'manifest, or it predates the component channel',
      { construct: 'manifest.components' }
    );
  }
  if (!isRecord(admitted.sheets)) {
    throw new AnimusAdapterError(
      'manifest has no `sheets` map — without the emitted CSS there is no ' +
        'style universe, and reading this as an empty one would make every ' +
        "probe answer 'nothing applies' with full confidence",
      { construct: 'manifest.sheets' }
    );
  }
  // SAFETY: `components` and `sheets` — the channels readers dereference
  // unguarded — were both proven to be objects immediately above.
  return admitted as AnimusManifest;
};
