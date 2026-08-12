import { AnimusAdapterError } from './errors';

/**
 * Local types for the slices of `manifest.json` the adapter consumes.
 *
 * Deliberately *not* imported from `@animus-ui/extract`: the pipeline's own
 * types live behind a built `./pipeline` entry, and the manifest is emitted as
 * untyped JSON there anyway — importing them would couple the oracle to the
 * extractor's build output for no added guarantee. What is guaranteed here is
 * what the adapter reads, and nothing else; index-signature escape hatches keep
 * the unread remainder addressable without pretending to model it.
 *
 * The v1-era field names are snake_case (`class_name`, `extends_from`) while
 * the newer channels are camelCase (`fileFacts`, `usageResidue`) — that split
 * is the manifest's, not a transcription slip.
 */
export type ManifestTerminal = 'asElement' | 'asComponent' | 'asClass';

export type ManifestSpan = readonly [number, number];

export interface ManifestComponent {
  file: string;
  binding: string;
  class_name: string;
  extends_from?: string | null;
  terminal: ManifestTerminal;
  tag?: string | null;
  /** `createComponent('<tag>', '<class>', {<config>}, …)` as emitted source. */
  replacement: string;
  system_prop_names?: readonly string[] | null;
  [key: string]: unknown;
}

export interface ManifestStageDescriptor {
  method: string;
  /** Byte offsets into the *original* source file. */
  argSpan?: ManifestSpan | null;
  secondArgSpan?: ManifestSpan | null;
}

export interface ManifestChainDescriptor {
  binding: string;
  terminal?: string;
  tag?: string | null;
  stages: readonly ManifestStageDescriptor[];
  extractable?: boolean;
  bailReason?: string | null;
  span?: ManifestSpan | null;
  extendsFrom?: string | null;
}

/** The authored builder-stage value, *before* token/scale resolution. */
export interface ManifestStage {
  method: string;
  value?: unknown;
  secondValue?: unknown;
  evalError?: string | null;
}

export interface ManifestChain {
  className: string;
  descriptor: ManifestChainDescriptor;
  stages: readonly ManifestStage[];
  fatalError?: string | null;
}

export interface ManifestFileFacts {
  path?: string;
  chains?: readonly ManifestChain[];
  [key: string]: unknown;
}

export interface ManifestDynamicProp {
  varName: string;
  slotClass: string;
  property?: string | null;
  properties?: readonly string[] | null;
  transformName?: string | null;
  scaleValues?: Readonly<Record<string, string>> | null;
}

export interface ManifestUsageResidue {
  binding: string;
  prop: string;
  file: string;
  span: { start: number; end: number };
  kind: string;
}

export interface ManifestEliminated {
  component: string;
  kind: string;
  name?: string | null;
  reason: string;
}

export interface ManifestReport {
  eliminated_details?: readonly ManifestEliminated[];
  [key: string]: unknown;
}

/** Pretty-printed CSS per emission layer, keyed by the layer's short name. */
export type ManifestSheets = Readonly<Record<string, string | undefined>>;

export interface AnimusManifest {
  components: Readonly<Record<string, ManifestComponent>>;
  files?: Readonly<Record<string, readonly string[]>>;
  reverse_provenance?: Readonly<Record<string, readonly string[]>>;
  sheets?: ManifestSheets;
  component_fragments?: Readonly<
    Record<string, Readonly<Record<string, string>>>
  >;
  fileFacts?: Readonly<Record<string, ManifestFileFacts>>;
  usageResidue?: readonly ManifestUsageResidue[];
  dynamic_props?: Readonly<Record<string, ManifestDynamicProp>>;
  system_prop_map?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  report?: ManifestReport;
  [key: string]: unknown;
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Validating narrow. Only the fields the adapter *requires* are checked — a
 * manifest missing `components` is not a thin input the adapter can degrade
 * over, it is a different artifact, and reading it as an empty universe would
 * make every probe answer "nothing applies" with full confidence.
 */
export const asManifest = (value: unknown): AnimusManifest => {
  if (!isRecord(value)) {
    throw new AnimusAdapterError(
      'manifest is not a JSON object — expected the contents of ' +
        '`manifest.json` as produced by `animus build`, got ' +
        (value === null ? 'null' : typeof value),
      { construct: 'manifest' }
    );
  }
  if (!isRecord(value.components)) {
    throw new AnimusAdapterError(
      'manifest has no `components` map — this is not an animus extraction ' +
        'manifest, or it predates the component channel',
      { construct: 'manifest.components' }
    );
  }
  return value as AnimusManifest;
};

/** Every `var(--x)` referenced by a declaration value, in first-seen order. */
export const tokenReferencesIn = (value: string): string[] => {
  const refs: string[] = [];
  const pattern = /var\(\s*(--[A-Za-z0-9_-]+)/g;
  for (;;) {
    const match = pattern.exec(value);
    if (match === null) break;
    if (!refs.includes(match[1])) refs.push(match[1]);
  }
  return refs;
};
