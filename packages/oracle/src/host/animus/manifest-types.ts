import { AnimusAdapterError } from './errors';

/**
 * Local types for the slices of `manifest.json` the adapter consumes.
 *
 * Deliberately *not* imported from `@animus-ui/extract`: the pipeline's own
 * types live behind a built `./pipeline` entry, and the manifest is emitted as
 * untyped JSON there anyway — importing them would couple the oracle to the
 * extractor's build output for no added guarantee. What is guaranteed here is
 * what the adapter reads, and nothing else; the unread remainder stays
 * addressable through `ManifestJsonValue`, which says what an unmodeled field
 * *is* without pretending to model what it means.
 *
 * The v1-era field names are snake_case (`class_name`, `extends_from`) while
 * the newer channels are camelCase (`fileFacts`, `usageResidue`) — that split
 * is the manifest's, not a transcription slip.
 *
 * The REFERENCE MODEL for that manifest now exists in the producing package:
 * `ProjectManifest` in `packages/extract/pipeline/manifest-schema.ts`, mirrored
 * from the Rust `AnalyzeResult` and tethered by
 * `packages/_integration/__tests__/manifest-shape.test.ts`. Consult it when a
 * field's spelling or optionality is in question; this file stays a separate
 * projection by the decision above (adapter-read slices only, no build-output
 * coupling), not for want of an owner.
 */

/**
 * The value domain of `manifest.json`: exactly what `JSON.parse` produces.
 *
 * Every field the adapter does not model is typed with this rather than left
 * open, so a reader that reaches an unmodeled key gets a value it can decide
 * about (object, list, scalar, null) instead of one it can only dereference on
 * faith. `undefined` is not a JSON value — it appears only as an omitted key,
 * which is why the object form admits it as a *value type* and this union does
 * not.
 */
export type ManifestJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly ManifestJsonValue[]
  | ManifestJsonObject;

/** A JSON object as the manifest carries it: keys present or absent. */
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
  /** `createComponent('<tag>', '<class>', {<config>}, …)` as emitted source. */
  replacement: string;
  system_prop_names?: readonly string[] | null;
  [key: string]: ManifestJsonValue | undefined;
}

export type ManifestStageDescriptor = {
  method: string;
  /** Byte offsets into the *original* source file. */
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

/** The authored builder-stage value, *before* token/scale resolution. */
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

/** One attribute of a recorded JSX usage element (`AttrFact` in extract). */
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

/**
 * One `UsageFact` as the manifest serializes it: an externally-tagged enum,
 * camelCase variants (`element` / `createElement`). The list is flat and in
 * source order — that flatness is exactly what the places layer's
 * correspondence guard reprojects fresh structure onto (PLACES.md §1).
 */
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

/** Pretty-printed CSS per emission layer, keyed by the layer's short name. */
export type ManifestSheets = Readonly<Record<string, string | undefined>>;

export interface AnimusManifest {
  components: Readonly<Record<string, ManifestComponent>>;
  files?: Readonly<Record<string, readonly string[]>>;
  reverse_provenance?: Readonly<Record<string, readonly string[]>>;
  /** Required — `asManifest` rejects a manifest without it, so no reader has
   * to guard against the confident-empty-universe case. */
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

/**
 * A keyed JSON object, decided by object identity rather than by a
 * representation test: `Object(value) === value` holds for exactly the objects
 * and arrays `JSON.parse` produces, and the `[object Object]` tag is what
 * separates a keyed block from a list. Everything `JSON.parse` cannot produce
 * — callables, boxed primitives, `Date`/`Map` and friends — is rejected here
 * rather than downstream, which is the whole point of admitting `manifest.json`
 * at one boundary.
 *
 * Admitting it is exactly what puts its contents in this module's value domain:
 * an input that passes here holds `ManifestJsonValue`s, so a caller that
 * reaches an unmodeled key gets a value it can decide about rather than one it
 * can only dereference on faith.
 */
export const isRecord = (value: unknown): value is ManifestJsonObject =>
  Object(value) === value &&
  Object.prototype.toString.call(value) === '[object Object]';

/**
 * The same decision stated over an already-decoded manifest value. `isRecord`
 * admits an input nobody has decided anything about yet; the artifact and
 * replacement readers have already decided their domain, so they narrow
 * through this instead and stay inside it. One body decides what a keyed JSON
 * object is — this only says which domain is asking.
 */
export const isManifestJsonObject = (
  value: ManifestJsonValue | undefined
): value is ManifestJsonObject => isRecord(value);

/**
 * A JSON string, excluding the boxed `String` object — which carries the same
 * `[object String]` tag but is not a value `JSON.parse` produces, and would
 * fail every downstream identity comparison if admitted.
 */
export const isManifestJsonString = (
  value: ManifestJsonValue | undefined
): value is string =>
  Object(value) !== value &&
  Object.prototype.toString.call(value) === '[object String]';

const TAG_PREFIX = '[object ';

/**
 * What the rejected value IS, for the diagnostic: its representation tag,
 * lowercased — the same evidence `isRecord` decides on, so the message names
 * exactly what failed the admission test (`null`, `array`, `string`) instead of
 * the coarser bucket a representation query would report.
 */
const describeRejected = <Value>(value: Value): string =>
  Object.prototype.toString
    .call(value)
    .slice(TAG_PREFIX.length, -1)
    .toLowerCase();

/**
 * Validating narrow. Only the fields the adapter *requires* are checked — a
 * manifest missing `components` is not a thin input the adapter can degrade
 * over, it is a different artifact, and reading it as an empty universe would
 * make every probe answer "nothing applies" with full confidence.
 *
 * Universally quantified over its input because its whole job is to decide
 * about a value nobody has decided about yet: `AnimusHostInput.manifest` is
 * whatever a caller parsed, and the guards below are what turn it into a
 * manifest or a refusal.
 */
export const asManifest = <Value>(value: Value): AnimusManifest => {
  if (!isRecord(value)) {
    throw new AnimusAdapterError(
      'manifest is not a JSON object — expected the contents of ' +
        '`manifest.json` as produced by `animus build`, got ' +
        describeRejected(value),
      { construct: 'manifest' }
    );
  }
  // Admitted: from here the input is this module's own value domain, and the
  // required-channel checks below read it as such.
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
  // SAFETY: This is the one place `manifest.json` is admitted, and the two
  // channels every reader dereferences without a further guard —
  // `components` and `sheets` — were both proven to be objects immediately
  // above. Everything beneath them is the emitter's declared contract (module
  // header): optional in this type, reached through optional chaining or a
  // defaulted read by every consumer, and deliberately not re-walked here,
  // because a full structural validation would reject manifests this adapter
  // can still answer from.
  return admitted as AnimusManifest;
};
