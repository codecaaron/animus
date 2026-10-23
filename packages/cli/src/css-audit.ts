import {
  classStem,
  isMediaFile,
  lineAtByte,
  outputEvidence,
  removeComponentRules,
  shippedClasses,
  slotReasons,
  splitStylesheet,
  STYLESHEET_SLICES,
  unbundledComponents,
} from '@animus-ui/extract/pipeline';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

import { UsageFailure } from './build';
import {
  addNamedClasses,
  addSelectedClasses,
  brotliSize,
  eachStyleRule,
  gzipSize,
  parseSheet,
  withoutSelectors,
} from './css-sheet';

import type { Sheet, SheetNode, SheetSelector, Sizes } from './css-sheet';
import type {
  FullProjectManifest,
  ManifestComponentDescriptor,
  OutputFile,
  SlotOpening,
} from '@animus-ui/extract/pipeline';

type StyleRule = Extract<SheetNode, { type: 'style' }>;
type AtRule = Extract<SheetNode, { type: 'at' }>;

/** Bytes a change saves, each file compressed on its own; negative where
 *  it costs bytes. A compressed size is `null` where it was not measured:
 *  gzip where the raw saving stays under the floor, Brotli where the gzip
 *  saving does or the finding ranks too low to measure. A measured finding
 *  without a Brotli measurement ranks below the floor; an unproven one is
 *  never ranked, nor below it. */
export interface Saving {
  raw: number;
  gzip: number | null;
  brotli: number | null;
}

export type Confidence = 'high' | 'medium' | 'low';

/** The host a built output looks like it came from. Split stylesheets and
 *  `removeUnbundledComponents` are options of the Vite plugin only. */
export type DeliveryHost = 'vite' | 'next' | 'other';

/** The delivery section, or why it was not estimated. */
export type DeliveryReport = DeliveryEstimate | { unavailable: string };

export interface DeliveryEstimate {
  host: DeliveryHost;
  /** How the shipped CSS is delivered now: Animus's layers in one file, or
   *  cut into slices. */
  stylesheets: 'single' | 'split';
  /** The files holding Animus's layers. */
  sheets: string[];
  /** What a split costs over one file: positive is bytes added. */
  splitCost: Saving;
  /** What `removeUnbundledComponents` would remove from the (split) CSS
   *  now, and the ids of the components it removes; `null` where removal
   *  must keep every component. */
  removal: {
    components: number;
    saving: Saving;
    removed: string[];
  } | null;
  removalKept: string | null;
  /** Output files the scan could not read as text, left out of the
   *  removal estimate; a Vite build would keep every component if they
   *  are part of its output. */
  unread: string[];
  /** Removal's saving less the split's cost, where the CSS is single now;
   *  removal's saving where it is split already. */
  net: Saving;
  /** Whether the verdict turns removal on: it would remove a component,
   *  and on single CSS its saving outweighs the split's cost. */
  removalRecommended: boolean;
  verdict: string;
  preconditions: string[];
}

export interface SlotGroup {
  /** The rule of the use proof that keeps them (`opaque-delivery`, …). */
  rule: string;
  /** System props this rule keeps a slot for. */
  props: number;
  /** Of those, the props no other rule keeps, which closing it closes. */
  only: number;
  /** What closing this rule alone saves: the slot rules of `only`. The
   *  groups' savings add up, since each prop is `only` in one group at
   *  most. */
  saving: Saving;
  /** The components it keeps them for, most props first, each with the
   *  sites where the rule applies to it. */
  owners: Array<{ component: string; props: number; sites: string[] }>;
}

export interface SlotReport {
  props: number;
  /** What closing every kept slot saves: the slot rules' whole cost. */
  saving: Saving;
  groups: SlotGroup[];
  /** Why usage is not proven project-wide, by rule. */
  usageGaps: Record<string, number>;
  componentSlots: {
    slots: number;
    components: number;
    byRule: Record<string, number>;
  };
}

export type RestructureKind =
  | 'kept-options'
  | 'defaults-only-extension'
  | 'repeated-base-block';

export interface Restructure {
  kind: RestructureKind;
  title: string;
  /** Component ids it changes. */
  components: string[];
  suggestion: string;
  confidence: Confidence;
  /** What keeps the confidence below high. */
  caveats: string[];
  saving: Saving;
  /** It measures under the floor, so it is listed collapsed and counts in
   *  their total. An unproven finding never is: it promises no saving. */
  belowFloor: boolean;
  /** Every component it changes is one `removeUnbundledComponents` would
   *  remove, so the delivery estimate already counts its saving. */
  removedByDelivery: boolean;
  /** Present where a site passing a value no literal spells holds the
   *  finding back: it is never ranked, nor counted below the floor,
   *  whatever it measures; its saving is what pruning would remove if no
   *  such site reaches the options. */
  unproven?: Unproven;
}

/** What holds a kept-option finding back: each site that passes a value no
 *  literal spells, `file:line` (`file@byte` where its source cannot be
 *  read, `file (createElement)` for a call). */
export interface Unproven {
  dynamicSites: string[];
  /** The sites among them that pass on their component's own prop, which
   *  the component's callers write. */
  forwards: Array<{ site: string; component: string; prop: string }>;
  /** The sites among them whose value is computed from their component's
   *  own props: its callers decide them, but not which option the site
   *  takes, so no literal at the site keeps the component's API. */
  derived: Array<{
    site: string;
    component: string;
    props: string[];
    /** The React context it also reads, as `Context.member`. */
    contexts?: string[];
    /** The literal a destructuring defaults a context read to, by read. */
    contextDefaults?: Record<string, JsonValue>;
    through: string | null;
  }>;
  /** The sites among them that pass a React state hook's state slot, which
   *  changes at run time: \`at\` is the hook's call, \`file:line\`. */
  runtimeState: Array<{ site: string; hook: string; at: string }>;
  /** The sites among them whose value is read from React context and no
   *  prop (`Context.member`): what provides the context decides it. */
  context: Array<{
    site: string;
    reads: string[];
    /** The literal a destructuring defaults a read to, by read: what the
     *  value takes where the context leaves the member out. */
    defaults?: Record<string, JsonValue>;
    through: string | null;
  }>;
  /** Each site's origin for each axis it keeps, as the text reads it: one
   *  site can pass one axis from a prop and another from context, and an
   *  axis whose value has no origin says so. */
  byAxis: Array<{ site: string; axis: string; origin: string }>;
  /** Evidence, where every dynamic site forwards: the listed options, by
   *  axis, that the callers the engine matches to the forwarding component
   *  through the module graph pass, as values the analysis proves. A caller
   *  the audit cannot match, or a branch before the render, can differ.
   *  `null` where a site computes its value, or no caller is matched. */
  reachedByCallers: Array<{ axis: string; options: string[] }> | null;
  /** Candidates, not a promise: the listed options no matched caller
   *  passes, as `axis: option`. `null` with `reachedByCallers`, or where a
   *  matched caller passes a value the audit cannot read. */
  notPassedByMatchedCallers: string[] | null;
  /** Where `reachedByCallers` is: whether the matched callers are in the
   *  forwarding component's own module, through imports, or both, and the
   *  components whose callers were read too because a caller passes the
   *  prop on from one of their own (`Button`, whose `<ButtonBehavior
   *  {...props} />` passes on what its callers write). */
  matchedCallers: {
    inModule: boolean;
    throughImports: boolean;
    chain: string[];
    /** A forwarding component is also reached by a route the matching does
     *  not follow (a dynamic import, an escape, a namespace member), so no
     *  not-passed list is given. */
    unmatchedRoute: boolean;
    /** The matched callers that pass a React state hook's state slot,
     *  which changes at run time: the hook and its call, `file:line`. */
    runtimeState: Array<{ hook: string; at: string }>;
    /** The matched callers that pass a value computed from their own
     *  component's props, which those components' callers decide. */
    derived: Array<{
      at: string;
      component: string;
      props: string[];
      contexts?: string[];
      contextDefaults?: Record<string, JsonValue>;
      through: string | null;
    }>;
    /** A matched caller passes a value the audit cannot read and cannot
     *  say where it comes from. */
    unexplained: boolean;
    /** The forwarded props a matched caller leaves out whose default is a
     *  value the audit cannot read, as `Component's prop`. */
    unreadDefaults: string[];
  } | null;
  /** Where an origin above names React context, what it rests on
   *  (`CONTEXT_ASSUMPTION`): no code mutates the value the provider
   *  supplies, which no module's analysis can prove. */
  contextAssumption?: string;
  /** The build-wide hold (`CssAuditReport.restructures.pruningHold`) keeps
   *  every option of this component, so no change at a site can remove one
   *  until it closes. */
  blocked: boolean;
  /** What the finding's `saving` measures: the CSS pruning would remove if
   *  no dynamic site reached these options, which the audit cannot prove. */
  savingMeans: 'removed-if-proven-unreached';
}

export interface Refusal {
  kind: RestructureKind;
  title: string;
  components: string[];
  rule: string;
  /** As `Restructure.unproven`. */
  unproven?: Unproven;
}

export interface CssAuditReport {
  manifest: string;
  dist: string;
  /** What the audit could not confirm: output without Animus's layers,
   *  whose classes it cannot tell from the app's. */
  warnings: string[];
  /** Animus's CSS: the files holding an `@layer anm-…` block, or every CSS
   *  file where none does. */
  css: { files: number; sizes: Sizes; others: string[] };
  components: number;
  delivery: DeliveryReport;
  /** `null` where the manifest carries no slot provenance (a build without
   *  `--verbose`). */
  slots: SlotReport | null;
  restructures: {
    /** Findings saving less Brotli than this are listed collapsed. */
    floor: number;
    findings: Restructure[];
    refused: Refusal[];
    /** How sites were matched to components: by the engine's tag table,
     *  or by binding name where the manifest carries none. */
    siteEvidence: 'component-id' | 'binding-name';
    /** What keeps every variant and state option of every component, as
     *  the engine holds pruning off. Where code may patch a built-in every
     *  render reads through (the manifest's `patches-intrinsics` usage
     *  gaps): how many such sites, in how many files, the first few,
     *  `file:line`, and every site with the rule that makes it count
     *  (`prototype-use`, `unowned-write`, …; `null` where the manifest names
     *  none). The engine records the first site of each kind in a file, so
     *  the count is a floor. `unseen`: each source the analysis may not
     *  read, by kind, with what releases it. `null` where nothing holds, or
     *  the manifest carries no slot provenance. */
    pruningHold: {
      patchSites: number;
      files: number;
      firstSites: string[];
      sites: Array<{ site: string; rule: string | null }>;
      unseen: Array<{
        kind: UnseenKind;
        site: string;
        detail: string | null;
        release: string;
      }>;
    } | null;
  };
}

/** The share of CSS Brotli under which a restructure is listed collapsed. */
const FLOOR_SHARE = 0.0025;

/** At most this many restructures per kind get a Brotli measurement, the
 *  largest gzip savings first; the rest keep their gzip measurement. */
const BROTLI_PER_KIND = 12;

/** A declaration block shorter than this is too small to share. */
const MIN_SHARED_DECLARATIONS = 3;

/** Findings under the floor the text names. */
const BELOW_SHOWN = 3;

/** Dynamic sites a finding's text names. */
const SITES_SHOWN = 3;

/** Owners listed per slot group, and sites per owner. */
const OWNERS_SHOWN = 5;
const SITES_PER_OWNER = 2;

// ---------------------------------------------------------------- input

type Literal = string | number | boolean | null;

/** An attribute as the manifest's `proven` usage reports it. */
interface UsageAttr {
  name: string;
  /** Every value it can write that is known: literals, or breakpoint
   *  objects of them. */
  values: JsonValue[];
  /** The analysis proves `values` are all it writes; otherwise it may
   *  write another. */
  proven: boolean;
  skip?: boolean;
  /** Written by only some branches of a spread, so it may be left out. */
  optional?: boolean;
  /** A proven value may also be `undefined` or `null`. */
  absent?: boolean;
  /** Where a runtime value is written, in UTF-8 bytes of its file. */
  dynamicSpan?: { start: number; end: number };
  /** The enclosing component's own prop a runtime value passes on
   *  unchanged. */
  forwarded?: ForwardedFact;
  /** The enclosing component's props a runtime value is computed from,
   *  and the React context it also reads (`Context.member`). */
  derived?: {
    component: string;
    props: string[];
    contexts?: string[];
    contextDefaults?: Record<string, JsonValue>;
    through?: string;
  };
  /** The React context a runtime value is read from, and no prop, with
   *  the literal a destructuring defaults a read to. */
  context?: {
    reads: string[];
    defaults?: Record<string, JsonValue>;
    through?: string;
  };
  /** The state slot of a React state hook, its call at byte `at`. */
  runtimeState?: { hook: string; at: number };
  /** For an inline object no static value as a whole, its members read
   *  one by one: literal `readable` ones, `unreadable` keys, and `open`
   *  where a spread or computed key may write any key. */
  members?: {
    readable: { [key: string]: JsonValue };
    unreadable?: string[];
    open?: boolean;
  };
}

/** The props of its component a value is computed from (`UsageAttr`). */
type Derived = NonNullable<UsageAttr['derived']>;

/** A prop of the enclosing component a value passes on: the prop as a
 *  caller writes it, or a member of the object it holds (`path`); left
 *  out, `default`, or `nullish`, which also replaces `null`; with
 *  `nullToUndefined` (`prop ?? undefined`), a `null` passed on as
 *  `undefined`. */
interface ForwardedFact {
  component: string;
  prop: string;
  path?: string[];
  default?: Literal;
  nullish?: Literal;
  nullToUndefined?: boolean;
  /** Its destructuring defaults the prop to a value the engine cannot
   *  read (an import, an expression). */
  defaultUnread?: boolean;
  /** Whose unread default a prop left out here takes, as `Component's
   *  prop`, where a forward passes it on to another component's; the
   *  audit's own, never the engine's. */
  unreadDefaultOf?: string;
}

interface UsageFact {
  element?: {
    tag: { ident?: string; member?: string };
    attrs: UsageAttr[];
    /** A spread that can deliver any prop follows the first `spread`
     *  attrs, so it can replace them. */
    spread?: number;
    /** That spread passes on the enclosing component's own props: its
     *  props object, or a rest of them that never carries `omits`. */
    spreadForward?: { component: string; omits?: string[] };
  };
  createElement?: { ident: string | null; member: string | null };
}

interface DistFile {
  file: string;
  text: string;
}

/** What the scan of the built output read. */
interface Dist {
  /** Every file's path, relative to the output directory. */
  names: string[];
  /** The files read as text. */
  files: DistFile[];
  /** Files whose bytes are no UTF-8 text, other than media, OS metadata
   *  and compressed copies of files read, which are skipped unread. */
  unread: string[];
}

/** The most bytes Node reads into one buffer. */
const MAX_FILE_BYTES = 2 ** 31 - 1;

/** Files an OS writes beside a folder's own: never build output. */
const OS_METADATA = /^(?:\.DS_Store|Thumbs\.db|desktop\.ini|\._.*)$/i;

/** A precompressed copy (`app.js.br`) of a file written beside it. */
const COMPRESSED_COPY = /\.(?:br|gz|zst)$/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** A JSON value, as `JSON.parse` returns it. */
type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
type JsonRecord = { [key: string]: JsonValue };

// A JSON value's kind, without `typeof`: an object is the only JSON value
// equal to its own conversion to an object, and a string the only other one
// equal to its own conversion to a string. An object is never converted to
// a string, since that runs whatever it holds under `toString`.
const isObject = (value: JsonValue | undefined): boolean =>
  Object(value) === value;
const isText = (value: JsonValue | undefined): value is string =>
  !isObject(value) && String(value) === value;
const isRecord = (value: JsonValue | undefined): value is JsonRecord =>
  isObject(value) && !Array.isArray(value);
const isList = (value: JsonValue | undefined): value is JsonValue[] =>
  Array.isArray(value);
/** A string, number, boolean or null: what a literal attribute value is. */
const isLiteral = (value: JsonValue | undefined): value is Literal =>
  value !== undefined && !isObject(value);

/** The value `record` holds under `key` itself, never one it inherits
 *  (a prop or tag named `constructor`). */
function ownEntry<Value>(
  record: Readonly<Record<string, Value>> | undefined,
  key: string
): Value | undefined {
  return record !== undefined && Object.hasOwn(record, key)
    ? record[key]
    : undefined;
}

/** `value` where it is a record, else an empty one. */
const recordOf = (value: JsonValue | undefined): JsonRecord =>
  isRecord(value) ? value : {};

/** Each value of a record, or `null` where `value` is no record. */
const recordValues = (value: JsonValue | undefined): JsonValue[] | null =>
  isRecord(value) ? Object.values(value) : null;

/** A record each of whose values is a record of `isEntry` values: a table
 *  the audit looks up by file or binding, then by tag or axis. */
const tableOf = (
  value: JsonValue | undefined,
  isEntry: (entry: JsonValue) => boolean
): boolean =>
  recordValues(value)?.every(
    (inner) => recordValues(inner)?.every(isEntry) ?? false
  ) ?? false;

/** A slot opening the audit reads: its rule, as text. */
const isOpening = (value: JsonValue): boolean =>
  isRecord(value) && isText(value.rule);

/** Each opening list of a record of them is one. */
const openingLists = (value: JsonValue | undefined): boolean =>
  recordValues(value)?.every((list) => isList(list) && list.every(isOpening)) ??
  false;

/** One usage fact the audit reads: an element with a tag and attributes,
 *  or a `createElement` call. */
function isUsageFact(fact: JsonValue): boolean {
  if (!isRecord(fact)) return false;
  if (fact.element !== undefined) {
    const element = fact.element;
    return (
      isRecord(element) &&
      isRecord(element.tag) &&
      isList(element.attrs) &&
      (element.spread === undefined || Number.isInteger(element.spread)) &&
      element.attrs.every(
        (attr) =>
          isRecord(attr) &&
          isText(attr.name) &&
          isList(attr.values) &&
          (attr.proven === true || attr.proven === false) &&
          (attr.dynamicSpan === undefined ||
            (isRecord(attr.dynamicSpan) &&
              Number.isInteger(attr.dynamicSpan.start)))
      )
    );
  }
  return fact.createElement === undefined || isRecord(fact.createElement);
}

/** The first part of `raw` the audit cannot read, or `null`. */
function manifestProblem(raw: JsonRecord): string | null {
  for (const section of [
    'components',
    'component_fragments',
    'fileFacts',
    'report',
  ]) {
    if (!isRecord(raw[section])) return `it has no ${section} section`;
  }
  for (const [id, component] of Object.entries(recordOf(raw.components))) {
    if (!isRecord(component)) return `component ${id} is no object`;
    for (const key of [
      'binding',
      'class_name',
      'replacement',
      'terminal',
      'tag',
    ]) {
      if (!isText(component[key])) return `component ${id} has no ${key}`;
    }
    const parent = component.extends_from;
    if (parent !== undefined && parent !== null && !isText(parent)) {
      return `component ${id}'s extends_from is no id`;
    }
  }
  for (const [id, sheets] of Object.entries(
    recordOf(raw.component_fragments)
  )) {
    if (!(recordValues(sheets)?.every(isText) ?? false)) {
      return `the fragments of ${id} are no record of CSS texts`;
    }
  }
  for (const [file, facts] of Object.entries(recordOf(raw.fileFacts))) {
    if (!isRecord(facts)) return `the facts of ${file} are no object`;
    const usage = facts.proven;
    if (usage === undefined && facts.usage !== undefined) {
      return `the facts of ${file} carry no proven usage`;
    }
    if (usage !== undefined && !(isList(usage) && usage.every(isUsageFact))) {
      return `the proven usage of ${file} is not in the form this audit reads`;
    }
  }
  for (const section of [
    'reverse_provenance',
    'dynamic_props',
    'tag_components',
    'tag_declarations',
    'crossFile',
    'sheets',
  ]) {
    if (raw[section] !== undefined && !isRecord(raw[section])) {
      return `its ${section} section is no object`;
    }
  }
  const crossFile = recordOf(raw.crossFile);
  const tables: Array<
    [string, JsonValue | undefined, (entry: JsonValue) => boolean]
  > = [
    ['system_prop_map', raw.system_prop_map, isText],
    ['tag_components', raw.tag_components, isText],
    ['tag_declarations', raw.tag_declarations, isText],
    ['crossFile.memberBindings', crossFile.memberBindings, isText],
    [
      'crossFile.variantOptions',
      crossFile.variantOptions,
      (options) => isList(options) && options.every(isText),
    ],
  ];
  for (const [name, table, isEntry] of tables) {
    if (table !== undefined && !tableOf(table, isEntry)) {
      return `its ${name} is not a table of records this audit reads`;
    }
  }
  if (
    !(
      recordValues(raw.dynamic_props)?.every(
        (meta) =>
          isRecord(meta) &&
          (meta.slotClass === undefined || isText(meta.slotClass))
      ) ?? true
    )
  ) {
    return 'its dynamic_props are no record of prop records';
  }
  if (
    raw.as_component_targets !== undefined &&
    !(recordValues(raw.as_component_targets)?.every(isText) ?? false)
  ) {
    return 'its as_component_targets are no record of declarations';
  }
  if (
    raw.unmatched_routes !== undefined &&
    !(isList(raw.unmatched_routes) && raw.unmatched_routes.every(isText))
  ) {
    return 'its unmatched_routes are no list of declarations';
  }
  if (raw.css !== undefined && !isText(raw.css)) return 'its css is no text';
  if (
    raw.sheets !== undefined &&
    !(recordValues(raw.sheets)?.every(isText) ?? false)
  ) {
    return 'its sheets are no record of CSS texts';
  }
  const provenance = raw.slot_provenance;
  if (provenance !== undefined) {
    if (
      !isRecord(provenance) ||
      !isList(provenance.usage) ||
      !provenance.usage.every(isOpening) ||
      !openingLists(provenance.owners) ||
      !(
        recordValues(provenance.props)?.every(
          (keepers) =>
            isList(keepers) &&
            keepers.every(
              (keeper) =>
                isOpening(keeper) && isRecord(keeper) && isText(keeper.owner)
            )
        ) ?? false
      ) ||
      (provenance.components !== undefined &&
        !(recordValues(provenance.components)?.every(openingLists) ?? false))
    ) {
      return 'its slot_provenance is not in the form this audit reads';
    }
  }
  return null;
}

/** A manifest the audit has checked, with its usage facts. */
interface AuditedManifest {
  manifest: FullProjectManifest;
  usage: Record<string, { proven?: UsageFact[] }>;
}

function readManifest(path: string): AuditedManifest {
  const remedy =
    'pass --manifest the manifest.json `animus build --verbose` writes, or one a host captured, from the same @animus-ui version';
  let raw: JsonValue;
  try {
    // SAFETY: JSON.parse returns a JSON value, which `JsonValue` spells.
    raw = JSON.parse(readFileSync(path, 'utf8')) as JsonValue;
  } catch (error) {
    throw new UsageFailure(
      `css audit: cannot read the manifest ${path} (${String(error)}); ${remedy}`
    );
  }
  const problem = isRecord(raw) ? manifestProblem(raw) : 'it is no object';
  if (problem !== null || !isRecord(raw)) {
    throw new UsageFailure(
      `css audit: ${path} is not a full manifest this audit reads: ${problem}; ${remedy}`
    );
  }
  raw.reverse_provenance ??= {};
  raw.dynamic_props ??= {};
  raw.css ??= '';
  const report = recordOf(raw.report);
  if (Number(report.components_forced) !== report.components_forced) {
    report.components_forced = 0;
  }
  return {
    // SAFETY: `manifestProblem` checked every section and field the audit
    // reads, and the optional ones it reads are filled in above.
    manifest: raw as FullProjectManifest & JsonRecord,
    // SAFETY: each file's proven usage was checked by `isUsageFact`.
    usage: raw.fileFacts as Record<string, { proven?: UsageFact[] }> &
      JsonRecord,
  };
}

/**
 * The built output's files: media, OS metadata and precompressed copies
 * of files beside them skipped before they are read; a file no UTF-8 text
 * spells set aside as unread.
 */
function readDist(dir: string): Dist {
  const remedy = 'pass --dist the directory the build wrote its output to';
  let paths: string[];
  try {
    paths = walk(dir);
  } catch (error) {
    throw new UsageFailure(
      `css audit: cannot read the built output ${dir} (${String(error)}); ${remedy}`
    );
  }
  const names = paths.map((path) => relative(dir, path));
  const present = new Set(names);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const files: DistFile[] = [];
  const unread: string[] = [];
  for (const [index, path] of paths.entries()) {
    const file = names[index]!;
    if (
      isMediaFile(file) ||
      OS_METADATA.test(basename(file)) ||
      (COMPRESSED_COPY.test(file) &&
        present.has(file.replace(COMPRESSED_COPY, '')))
    ) {
      continue;
    }
    let bytes: Buffer;
    try {
      if (statSync(path).size > MAX_FILE_BYTES) {
        throw new Error('over the 2 GiB a file can be read in');
      }
      bytes = readFileSync(path);
    } catch (error) {
      throw new UsageFailure(
        `css audit: cannot read ${file} in ${dir} (${String(error)}); ${remedy}`
      );
    }
    try {
      files.push({ file, text: decoder.decode(bytes) });
    } catch {
      unread.push(file);
    }
  }
  if (!files.some(({ file }) => file.endsWith('.css'))) {
    throw new UsageFailure(`css audit: ${dir} holds no .css file; ${remedy}`);
  }
  return { names, files, unread };
}

// ---------------------------------------------------------- measurement

/** How far a measurement goes: raw bytes, then gzip, then Brotli. */
type Depth = 'raw' | 'gzip' | 'brotli';

/** The texts an edit replaces and what it replaces them with. */
interface Edit {
  before: string[];
  after: string[];
}

/** The shipped CSS files, and what an edit of them saves. */
class Measured {
  /** The compressed sizes of the shipped files, which every measurement
   *  starts from; an edited text is measured once and dropped. */
  private readonly known = new Map<
    string,
    { gzip?: number; brotli?: Promise<number> }
  >();
  private readonly parsed = new Map<string, Sheet>();
  readonly files: ReadonlyMap<string, string>;

  constructor(files: ReadonlyMap<string, string>) {
    this.files = files;
    for (const text of files.values()) this.known.set(text, {});
  }

  sheet(file: string): Sheet {
    let sheet = this.parsed.get(file);
    if (sheet === undefined) {
      sheet = parseSheet(this.files.get(file)!);
      this.parsed.set(file, sheet);
    }
    return sheet;
  }

  private gzip(text: string): number {
    const known = this.known.get(text);
    if (known === undefined) return gzipSize(text);
    known.gzip ??= gzipSize(text);
    return known.gzip;
  }

  private brotli(text: string): Promise<number> {
    const known = this.known.get(text);
    if (known === undefined) return brotliSize(text);
    known.brotli ??= brotliSize(text);
    return known.brotli;
  }

  /** The texts' summed sizes, as deep as `depth`. */
  async sizes(texts: string[], depth: Depth): Promise<Saving> {
    const raw = texts.reduce((n, text) => n + Buffer.byteLength(text), 0);
    const gzip =
      depth === 'raw'
        ? null
        : texts.reduce((n, text) => n + this.gzip(text), 0);
    const brotli =
      depth === 'brotli'
        ? (await Promise.all(texts.map((text) => this.brotli(text)))).reduce(
            (n, size) => n + size,
            0
          )
        : null;
    return { raw, gzip, brotli };
  }

  /** What an edit saves, as deep as `depth`. */
  async saving({ before, after }: Edit, depth: Depth): Promise<Saving> {
    const [a, b] = await Promise.all([
      this.sizes(before, depth),
      this.sizes(after, depth),
    ]);
    return subtract(a, b);
  }

  /** The edit that drops the selectors `drop` picks, and the at-rules
   *  `dropAt` picks, from every file. */
  without(
    drop: (selector: SheetSelector, rule: StyleRule) => boolean,
    dropAt?: (rule: AtRule) => boolean
  ): Edit {
    const edit: Edit = { before: [], after: [] };
    for (const [file, css] of this.files) {
      const edited = withoutSelectors(this.sheet(file), drop, dropAt);
      if (edited === null) continue;
      edit.before.push(css);
      edit.after.push(edited);
    }
    return edit;
  }
}

/** A declaration's property name. */
const propertyOf = (declaration: string): string => {
  const name = declaration.slice(0, declaration.indexOf(':')).trim();
  return name.startsWith('--') ? name : name.toLowerCase();
};

/** The physical sides and sizes, whose logical names differ. */
const SIDES = new Set(['top', 'right', 'bottom', 'left']);
const SIZES = /^(?:(?:min|max)-)?(?:width|height|inline-size|block-size)$/;

/**
 * A property's family: the properties a shorthand sets with it, and their
 * logical and physical sides, under one name (`padding` for
 * `padding-top` and `padding-block-start`, `inset` for `top`, `gap` for
 * `row-gap`, `align` for `place-items`). Coarse on purpose: two
 * properties of one family may set the same longhand.
 */
function familyOf(property: string): string {
  const name = property.replace(/^-(?:webkit|moz|ms|o)-/, '');
  if (name.startsWith('--')) return name;
  if (SIDES.has(name) || name.startsWith('inset')) return 'inset';
  if (name === 'gap' || name.endsWith('-gap')) return 'gap';
  if (SIZES.test(name)) return 'size';
  if (/^(?:place|align|justify)-/.test(name)) return 'align';
  if (name === 'columns') return 'column';
  return name.split('-')[0]!;
}

// --------------------------------------------------------------- sites

interface Site {
  file: string;
  attrs: UsageAttr[] | null;
  /** As `UsageFact.element.spread`. */
  spread?: number;
  /** As `UsageFact.element.spreadForward`. */
  spreadForward?: { component: string; omits?: string[] };
  /** Matched by binding name, not by the engine's tag table. */
  byName: boolean;
  /** Where the site renders an `.asComponent()` component, which passes
   *  its props on to the declaration it renders: what it keeps back. */
  through?: AsComponentPass;
}

/** What an `.asComponent()` component passes on to the declaration it
 *  renders (the runtime's `createComponent`), for one prop: `'kept'` for
 *  its own variants and states it does not forward, which the target
 *  never sees, and its system props; `'unread'` where its config names the
 *  prop otherwise (a custom prop), which the audit does not read; the
 *  value a forwarded variant (its default) or state (`false`) takes where
 *  a caller leaves it out; `undefined` for a prop it passes unchanged. */
type AsComponentPass = (
  prop: string
) => 'kept' | 'unread' | { omitted: Literal | undefined } | undefined;

/** The declarations a route the matching does not follow reaches
 *  (`unmatched_routes`), with the target of each `.asComponent()` component
 *  one reaches: its sites are read as its target's callers
 *  (`componentSites`), so a route to it reaches the target's renders. */
function unmatchedRoutes(manifest: FullProjectManifest): Set<string> {
  const routes = new Set(manifest.unmatched_routes ?? []);
  const targets = Object.entries(manifest.as_component_targets ?? {});
  // A target may itself render through `.asComponent()`: until none is added.
  for (let size = -1; size !== routes.size;) {
    size = routes.size;
    for (const [component, target] of targets) {
      const file = component.slice(0, component.lastIndexOf('::'));
      if (routes.has(component) || routes.has(`${file}::*`)) {
        routes.add(target);
      }
    }
  }
  return routes;
}

/** Each component's JSX sites: by the engine's tag table where the manifest
 *  carries it, else by binding name. A `createElement` site has no attrs
 *  the audit can read. An `.asComponent()` component's sites are callers
 *  of the declaration it renders too (`as_component_targets`). */
interface ComponentSites {
  sites: Map<string, Site[]>;
  evidence: 'component-id' | 'binding-name';
  /** Every element's site by the declaration its tag names, `file::binding`,
   *  where the engine resolves it (`tag_declarations`): the callers of a
   *  component a forward names. */
  byDeclaration: Map<string, Site[]>;
}

function componentSites(audited: AuditedManifest): ComponentSites {
  const byDeclaration = new Map<string, Site[]>();
  const { manifest } = audited;
  const tables = manifest.tag_components;
  const evidence =
    tables && Object.keys(tables).length > 0 ? 'component-id' : 'binding-name';
  const byBinding = new Map<string, string[]>();
  for (const [id, component] of Object.entries(manifest.components)) {
    const ids = byBinding.get(component.binding) ?? [];
    ids.push(id);
    byBinding.set(component.binding, ids);
  }
  const sites = new Map<string, Site[]>();
  const push = (map: Map<string, Site[]>, key: string, site: Site) => {
    const list = map.get(key) ?? [];
    list.push(site);
    map.set(key, list);
  };
  for (const [file, facts] of Object.entries(audited.usage)) {
    for (const fact of facts.proven ?? []) {
      const tag = fact.element
        ? (fact.element.tag.ident ?? fact.element.tag.member)
        : (fact.createElement?.ident ?? fact.createElement?.member);
      if (!tag || /^[a-z][^.]*$/.test(tag)) continue;
      const attrs = fact.element?.attrs ?? null;
      const spread = fact.element?.spread;
      const declaration = fact.element
        ? ownEntry(ownEntry(manifest.tag_declarations, file), tag)
        : undefined;
      const spreadForward = fact.element?.spreadForward;
      const site: Site = {
        file,
        attrs,
        byName: true,
        ...(spread !== undefined && { spread }),
        ...(spreadForward !== undefined && { spreadForward }),
      };
      if (declaration !== undefined) push(byDeclaration, declaration, site);
      const resolved =
        ownEntry(ownEntry(tables, file), tag) ??
        ownEntry(ownEntry(manifest.crossFile?.memberBindings, file), tag);
      if (resolved !== undefined) {
        push(sites, resolved, { ...site, byName: false });
        const target = ownEntry(manifest.as_component_targets, resolved);
        const component = ownEntry(manifest.components, resolved);
        if (target !== undefined && component !== undefined) {
          push(byDeclaration, target, {
            ...site,
            byName: false,
            through: asComponentPass(manifest, component),
          });
        }
        continue;
      }
      for (const id of byBinding.get(tag) ?? []) push(sites, id, site);
    }
  }
  return { sites, evidence, byDeclaration };
}

/** What `component`, an `.asComponent()` one, passes on (`AsComponentPass`),
 *  read from its config. */
function asComponentPass(
  manifest: FullProjectManifest,
  component: ManifestComponentDescriptor
): AsComponentPass {
  const variants = new Map(
    [...variantsOf(manifest, component)].map(([axis, config]) => [
      axis,
      config.default,
    ])
  );
  const states = recordEntry(component.replacement, 'states');
  const forward = recordEntry(component.replacement, 'forward');
  const system = new Set(component.system_prop_names);
  return (prop) => {
    const variant = variants.has(prop);
    if (variant || (isList(states) && states.includes(prop))) {
      if (forward !== true && !(isList(forward) && forward.includes(prop))) {
        return 'kept';
      }
      return { omitted: variant ? (variants.get(prop) ?? undefined) : false };
    }
    if (system.has(prop)) return 'kept';
    if (component.replacement.includes(`"${prop}":`)) return 'unread';
    return undefined;
  };
}

const coApplies = (site: Site): boolean =>
  site.attrs?.some(
    (attr) => attr.name === 'className' || attr.name === 'asChild'
  ) ?? false;

// ------------------------------------------------------------ delivery

/** Whether an `@layer` prelude names one of Animus's layers, or a layer
 *  inside one (`anm-base.inner`), comments aside. */
function namesAnimusLayer(prelude: string): boolean {
  return prelude
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split(',')
    .some((name) => /^anm-[\w-]*(?:\.|$)/i.test(name.trim()));
}

/** Whether `nodes` hold a block of one of Animus's layers, at any depth:
 *  what marks a file as its output. */
function hasAnimusLayer(nodes: readonly SheetNode[]): boolean {
  return nodes.some(
    (node) =>
      (node.type === 'at' &&
        node.name === 'layer' &&
        namesAnimusLayer(node.prelude)) ||
      hasAnimusLayer(node.children)
  );
}

/** The entry script Vite writes into a page it builds, or a split
 *  stylesheet link the Vite plugin writes, whatever `build.assetsDir`. */
const VITE_PAGE =
  /<script\b[^>]*\btype="module"[^>]*\bcrossorigin\b|\bdata-animus-stylesheet\b/;

/** The host whose output a dist looks like, by its file names and pages. */
function hostOf(dist: Dist): DeliveryHost {
  const { names } = dist;
  if (
    names.some(
      (name) =>
        name === 'BUILD_ID' ||
        name === 'build-manifest.json' ||
        /^(?:.*\/)?(?:_next\/)?static\/chunks\//.test(name)
    )
  ) {
    return 'next';
  }
  const pages = dist.files.filter(({ file }) => /^[^/]+\.html$/.test(file));
  if (
    names.includes('.vite/manifest.json') ||
    pages.some(({ text }) => VITE_PAGE.test(text)) ||
    (pages.length > 0 && names.some((name) => name.startsWith('assets/')))
  ) {
    return 'vite';
  }
  return 'other';
}

/** `sheets` are the files holding Animus's layers (`animusSheets`). */
async function deliveryReport(
  audited: AuditedManifest,
  measured: Measured,
  dist: Dist,
  sheets: readonly string[]
): Promise<DeliveryReport> {
  const { manifest } = audited;
  if (sheets.length === 0) {
    return {
      unavailable:
        "no CSS file holds an `@layer anm-…` block, as an unlayered or cascade-layer-polyfilled build ships Animus's rules, so the audit cannot tell them from the app's own",
    };
  }
  const host = hostOf(dist);
  const single = sheets.length === 1;
  const texts = sheets.map((file) => measured.files.get(file)!);
  // A split cuts Animus's stylesheet into its slices, and the app's own CSS
  // the one file also held ships as a file of its own; a split sheet is
  // measured against its slices joined in link order.
  const slices = single
    ? sheets.flatMap((file) => {
        const css = measured.files.get(file)!;
        const [start, end] = animusRegion(measured.sheet(file), manifest);
        const own = css.slice(0, start) + css.slice(end);
        return [
          ...splitStylesheet(css.slice(start, end)).map(
            ({ css: slice }) => slice
          ),
          own,
        ].filter((slice) => slice.length > 0);
      })
    : texts;
  const joined = single
    ? texts
    : [[...texts].sort((a, b) => sliceRank(a) - sliceRank(b)).join('')];
  const preconditions = [
    "removeUnbundledComponents needs stylesheets: 'split' (Vite): it removes CSS from the stylesheet's own files, which only a split build emits after its scripts.",
    "stylesheets: 'split' needs a page Vite builds from HTML to link the slices; the dev server keeps one sheet.",
    'Removal keeps every component where the build also bundles another environment (SSR), leaves a module external, or a plugin emits scripts after Animus reads the bundle; none of these show in the dist, so check them.',
    `A component staticCss declares stays; the estimate counts it removed where no output file names it (${manifest.report.components_forced} components forced here).`,
    'A stylesheet shared with code outside the build (micro-frontends, module federation) is unsupported with removal on.',
  ];
  const { texts: evidence, unreadable } = outputEvidence(
    dist.files.map(({ file, text }): OutputFile => ({
      fileName: file,
      code: text,
    })),
    new Set(sheets)
  );
  let removalEdit: {
    components: number;
    removed: string[];
    edit: Edit;
  } | null = null;
  if (unreadable === null) {
    const components = manifest.components;
    const removed = unbundledComponents(
      components,
      shippedClasses(
        evidence.map(({ text }) => text),
        Object.values(components).map((component) => component.class_name)
      ),
      new Set()
    );
    const classes = new Set(removed.values());
    const edit: Edit = { before: [], after: [] };
    const went = new Set<string>();
    for (const css of slices) {
      const cut = removeComponentRules(css, classes);
      for (const name of cut.went) went.add(name);
      if (cut.css === null) continue;
      edit.before.push(css);
      edit.after.push(cut.css);
    }
    removalEdit = {
      components: [...classes].filter((name) => went.has(name)).length,
      removed: [...removed]
        .filter(([, name]) => went.has(name))
        .map(([id]) => id),
      edit,
    };
  }
  // What the slices weigh over one file: positive is bytes the split adds.
  const [splitCost, removalSaving] = await Promise.all([
    measured.saving({ before: slices, after: joined }, 'brotli'),
    removalEdit && measured.saving(removalEdit.edit, 'brotli'),
  ]);
  const removal =
    removalEdit && removalSaving
      ? {
          components: removalEdit.components,
          saving: removalSaving,
          removed: removalEdit.removed,
        }
      : null;
  const net = single
    ? subtract(removal?.saving ?? zero(), splitCost)
    : (removal?.saving ?? zero());
  const removalRecommended =
    removal !== null &&
    removal.components > 0 &&
    (!single || (net.brotli ?? 0) > 0);
  return {
    host,
    stylesheets: single ? 'single' : 'split',
    sheets: [...sheets],
    splitCost,
    removal,
    removalKept:
      unreadable === null
        ? null
        : `${unreadable} holds data the scan cannot read as text, which may name a class`,
    unread: dist.unread,
    net,
    removalRecommended,
    verdict: deliveryVerdict(
      host,
      single,
      splitCost,
      removal,
      net,
      removalRecommended
    ),
    preconditions,
  };
}

/**
 * Where Animus's stylesheet sits in a file that also holds the app's own
 * CSS, to the end of its last `@layer anm-…` block. It starts at its theme
 * variables: of the top-level `:root` rules before its first `@property`
 * registration (one of its own slot variables) or layer block, the one
 * declaring the most custom properties the manifest's CSS reads, the
 * later on a tie, with the `@property` registrations right before it. An
 * app's own `:root` declares few of them; without any, the region starts at
 * that registration or block.
 */
function animusRegion(
  sheet: Sheet,
  manifest: FullProjectManifest
): [number, number] {
  const top = sheet.rules;
  const layers = top.filter(
    (node) =>
      node.type === 'at' && node.name === 'layer' && /^anm-/.test(node.prelude)
  );
  if (layers.length === 0) return [0, sheet.css.length];
  const first = layers[0]!;
  const end = layers[layers.length - 1]!.end;
  const read = new Set(
    [...manifest.css.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]!)
  );
  const slotVariables = Object.values(manifest.dynamic_props).flatMap(
    (meta) => meta.varName ?? []
  );
  const marker = top.find(
    (node) =>
      node === first ||
      (node.type === 'at' &&
        node.name === 'property' &&
        slotVariables.some((name) => node.prelude.startsWith(name)))
  )!;
  let start = marker.start;
  let most = 0;
  for (const node of top) {
    if (node.start >= marker.start) break;
    if (
      node.type !== 'style' ||
      node.selectors.length !== 1 ||
      node.selectors[0]!.text !== ':root'
    ) {
      continue;
    }
    const declared = node.declarations.filter((declaration) =>
      read.has(propertyOf(declaration))
    ).length;
    if (declared > 0 && declared >= most) {
      most = declared;
      start = node.start;
    }
  }
  // Animus registers its typed custom properties just before its theme
  // variables: the `@property` rules right before the start are its own.
  let index = top.findIndex((node) => node.start === start);
  while (index > 0) {
    const previous = top[index - 1]!;
    if (previous.type !== 'at' || previous.name !== 'property') break;
    index -= 1;
    start = previous.start;
  }
  return [start, end];
}

/** Where a split file goes in link order: the slice most of it is, as
 *  `splitStylesheet` cuts it. */
function sliceRank(css: string): number {
  const sizes = splitStylesheet(css).map(({ css: slice }) => slice.length);
  return STYLESHEET_SLICES.findIndex(
    (_, index) => sizes[index] === Math.max(...sizes)
  );
}

/** The verdict for the Vite plugin, which alone has these options; for
 *  another host, said as what they would do there. */
function deliveryVerdict(
  host: DeliveryHost,
  single: boolean,
  splitCost: Saving,
  removal: DeliveryEstimate['removal'],
  net: Saving,
  recommended: boolean
): string {
  const verdict = viteVerdict(single, splitCost, removal, net, recommended);
  return host === 'vite'
    ? verdict
    : `split stylesheets and removeUnbundledComponents are Vite plugin options, and this output looks like ${host === 'next' ? 'a Next build' : 'another host’s'}; on Vite: ${verdict}`;
}

function viteVerdict(
  single: boolean,
  splitCost: Saving,
  removal: DeliveryEstimate['removal'],
  net: Saving,
  recommended: boolean
): string {
  const cost = splitCost.brotli ?? 0;
  const removalBrotli = removal?.saving.brotli ?? 0;
  if (removal === null) {
    return single
      ? `keep one stylesheet: removal must keep every component here, and a split costs ${bytes(cost)} Brotli`
      : `removal must keep every component here; one stylesheet would be ${bytes(cost)} Brotli smaller`;
  }
  if (removal.components === 0) {
    return single
      ? `keep one stylesheet: no component is unbundled, so removal has nothing to remove, and a split costs ${bytes(cost)} Brotli`
      : `nothing left to remove (removal is on, or every component is bundled); the split costs ${bytes(cost)} Brotli over one stylesheet`;
  }
  if (single) {
    const saved = net.brotli ?? 0;
    return recommended
      ? `turn on stylesheets: 'split' and removeUnbundledComponents: removing ${removal.components} components saves ${bytes(removalBrotli)} Brotli, the split costs ${bytes(cost)}, ${bytes(saved)} saved`
      : `keep one stylesheet: removal would save ${bytes(removalBrotli)} Brotli (${removal.components} components), the split costs ${bytes(cost)}, ${bytes(-saved)} more`;
  }
  return `turn on removeUnbundledComponents: it would remove ${removal.components} components, ${bytes(removalBrotli)} Brotli; the split already costs ${bytes(cost)} over one stylesheet`;
}

// --------------------------------------------------------------- slots

async function slotReport(
  manifest: FullProjectManifest,
  measured: Measured
): Promise<SlotReport | null> {
  const provenance = manifest.slot_provenance;
  if (!provenance) return null;
  const ownerName = componentNames(manifest);
  // A slot's rules name its class, or the class with a suffix after a `-`
  // (`{slot}-md`, `{slot}--keep-md`); its variable is registered the same
  // way (`@property {var}`, `@property {var}-md`), for the slot alone.
  const named = (names: ReadonlySet<string>, name: string): boolean =>
    names.has(name) ||
    [...name.matchAll(/-/g)].some(({ index }) =>
      names.has(name.slice(0, index))
    );
  const dropProps = (props: Iterable<string>): Promise<Saving> => {
    const slots = [...props].flatMap(
      (prop) => ownEntry(manifest.dynamic_props, prop) ?? []
    );
    const classes = new Set(slots.flatMap((slot) => slot.slotClass ?? []));
    const variables = new Set(slots.flatMap((slot) => slot.varName ?? []));
    if (classes.size === 0) return Promise.resolve(zero());
    return measured.saving(
      measured.without(
        (selector) => selector.classes.some((name) => named(classes, name)),
        (rule) =>
          rule.name === 'property' && named(variables, rule.prelude.trim())
      ),
      'brotli'
    );
  };
  const rules = new Map<
    string,
    {
      props: Set<string>;
      only: Set<string>;
      owners: Map<string, { props: Set<string>; sites: Set<string> }>;
    }
  >();
  for (const [prop, keepers] of Object.entries(provenance.props)) {
    const openings = keepers.flatMap((keeper) =>
      slotReasons(provenance, keeper.owner, [keeper]).map((opening) => ({
        owner: keeper.owner,
        opening,
      }))
    );
    const kinds = new Set(openings.map(({ opening }) => opening.rule));
    for (const { owner, opening } of openings) {
      const group = rules.get(opening.rule) ?? {
        props: new Set<string>(),
        only: new Set<string>(),
        owners: new Map(),
      };
      group.props.add(prop);
      if (kinds.size === 1) group.only.add(prop);
      const held = group.owners.get(owner) ?? {
        props: new Set<string>(),
        sites: new Set<string>(),
      };
      held.props.add(prop);
      if (opening.file !== undefined) held.sites.add(placeOf(opening));
      group.owners.set(owner, held);
      rules.set(opening.rule, group);
    }
  }
  const [saving, ...savings] = await Promise.all([
    dropProps(Object.keys(provenance.props)),
    ...[...rules.values()].map(({ only }) => dropProps(only)),
  ]);
  const groups = [...rules]
    .map(([rule, { props, only, owners }], index): SlotGroup => ({
      rule,
      props: props.size,
      only: only.size,
      saving: savings[index]!,
      owners: [...owners]
        .map(([owner, held]) => ({
          component: ownerName(owner),
          props: held.props.size,
          sites: [...held.sites].sort().slice(0, SITES_PER_OWNER),
        }))
        .sort(
          (a, b) => b.props - a.props || a.component.localeCompare(b.component)
        )
        .slice(0, OWNERS_SHOWN),
    }))
    .sort(
      (a, b) =>
        b.props - a.props ||
        (b.saving.brotli ?? 0) - (a.saving.brotli ?? 0) ||
        a.rule.localeCompare(b.rule)
    );
  const usageGaps: Record<string, number> = {};
  for (const gap of provenance.usage) {
    usageGaps[gap.rule] = (usageGaps[gap.rule] ?? 0) + 1;
  }
  const byRule: Record<string, number> = {};
  let slots = 0;
  const owners = Object.entries(provenance.components ?? {});
  for (const [owner, byProp] of owners) {
    for (const openings of Object.values(byProp)) {
      slots += 1;
      const kept = slotReasons(provenance, owner, openings);
      for (const rule of new Set(kept.map((opening) => opening.rule))) {
        byRule[rule] = (byRule[rule] ?? 0) + 1;
      }
    }
  }
  return {
    props: Object.keys(provenance.props).length,
    saving: saving!,
    groups,
    usageGaps,
    componentSlots: { slots, components: owners.length, byRule },
  };
}

/** Each component as the report names it, in every section alike: its
 *  binding, and its file where another component of the manifest shares
 *  the binding. */
function componentNames(manifest: FullProjectManifest): (id: string) => string {
  const counts = new Map<string, number>();
  for (const { binding } of Object.values(manifest.components)) {
    counts.set(binding, (counts.get(binding) ?? 0) + 1);
  }
  return (id) => {
    const component = manifest.components[id];
    if (component === undefined) return id;
    return (counts.get(component.binding) ?? 0) > 1
      ? `${component.binding} (${component.file})`
      : component.binding;
  };
}

/** Where a slot opening applies: `file:line (detail)`. */
const placeOf = (opening: SlotOpening): string =>
  `${opening.file}${opening.line !== undefined ? `:${opening.line}` : ''}${opening.detail ? ` (${opening.detail})` : ''}`;

// --------------------------------------------------------- restructures

interface Candidate {
  finding: Omit<Restructure, 'saving' | 'belowFloor' | 'removedByDelivery'>;
  drop: (selector: SheetSelector, rule: StyleRule) => boolean;
}

/** The JSON object or array that opens at `at` in `text`, as text. */
function jsonValueAt(text: string, at: number): string | null {
  let depth = 0;
  for (let i = at; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) {
        if (text[i] === '\\') i++;
      }
    } else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return text.slice(at, i + 1);
    }
  }
  return null;
}

/** The JSON value a component's runtime record gives `key`, where it
 *  gives one: an object, an array, or a scalar (`"forward":true`). */
function recordEntry(replacement: string, key: string): JsonValue | undefined {
  const name = `"${key}":`;
  const at = replacement.indexOf(name);
  if (at < 0) return undefined;
  const rest = replacement.slice(at + name.length).trimStart();
  const text =
    rest[0] === '{' || rest[0] === '['
      ? jsonValueAt(rest, 0)
      : (/^(?:true|false|null|-?\d[\d.eE+-]*|"(?:[^"\\]|\\.)*")/.exec(
          rest
        )?.[0] ?? null);
  if (text === null) return undefined;
  try {
    // SAFETY: JSON.parse returns a JSON value, which `JsonValue` spells.
    return JSON.parse(text) as JsonValue;
  } catch {
    return undefined;
  }
}

/** The variant axes of a component's runtime record, each with its
 *  options (from the record, or the cross-file facts where the record
 *  does not list them) and its default. */
function variantsOf(
  manifest: FullProjectManifest,
  component: ManifestComponentDescriptor
): Map<string, { options: string[]; default: string | null }> {
  const axes = new Map<string, { options: string[]; default: string | null }>();
  const variants = recordEntry(component.replacement, 'variants');
  if (!isRecord(variants)) return axes;
  const listed =
    ownEntry(manifest.crossFile?.variantOptions, component.binding) ?? {};
  for (const [axis, config] of Object.entries(variants)) {
    const options = isRecord(config) ? ownEntry(config, 'options') : undefined;
    const fallback = isRecord(config) ? ownEntry(config, 'default') : undefined;
    axes.set(axis, {
      options: isList(options)
        ? options.filter(isText)
        : (ownEntry(listed, axis) ?? []),
      default: isText(fallback) ? fallback : null,
    });
  }
  return axes;
}

/**
 * The literals `name` receives at `sites`: written strings, numbers and
 * booleans, the values a conditional of literals enumerates, and `omitted`
 * where a site leaves the prop out; with how many sites pass a value the
 * audit cannot read.
 */
interface SiteLiterals {
  values: Set<string>;
  /** Sites passing a value no literal spells, each with where the value is
   *  written, where the facts say. */
  dynamic: DynamicSite[];
}

interface DynamicSite {
  site: Site;
  start: number | null;
  /** The component's own prop the site passes on, where it does. */
  forwarded?: ForwardedFact;
  /** The component's own props the site computes its value from. */
  derived?: NonNullable<UsageAttr['derived']>;
  /** The React state slot the site passes. */
  runtimeState?: NonNullable<UsageAttr['runtimeState']>;
  /** The React context the site reads its value from, and no prop. */
  context?: NonNullable<UsageAttr['context']>;
}

function literalsOf(
  name: string,
  sites: readonly Site[],
  omitted: Literal
): SiteLiterals {
  const values = new Set<string>();
  const dynamic: DynamicSite[] = [];
  const add = (value: Literal) => {
    if (value !== null) values.add(String(value));
  };
  for (const site of sites) {
    const attr = site.attrs?.findLast((written) => written.name === name);
    if (site.attrs === null) dynamic.push({ site, start: null });
    else if (attr === undefined || attr.skip) add(omitted);
    else {
      for (const value of attr.values) if (isLiteral(value)) add(value);
      // A value the analysis does not prove, a breakpoint object, or any
      // value no literal spells may pass any option.
      if (!attr.proven || !attr.values.every(isLiteral)) {
        dynamic.push({
          site,
          start: attr.dynamicSpan?.start ?? null,
          ...(attr.forwarded && { forwarded: attr.forwarded }),
          ...(attr.derived && { derived: attr.derived }),
          ...(attr.runtimeState && { runtimeState: attr.runtimeState }),
          ...(attr.context && { context: attr.context }),
        });
      }
    }
  }
  return { values, dynamic };
}

function keptOptions(
  manifest: FullProjectManifest,
  classes: ReadonlySet<string>,
  { sites, byDeclaration }: ComponentSites,
  locate: (dynamic: DynamicSite) => string,
  refused: Refusal[],
  blocked: boolean
): Candidate[] {
  const routes = unmatchedRoutes(manifest);
  const candidates: Candidate[] = [];
  const provenance = manifest.slot_provenance;
  const name = componentNames(manifest);
  for (const [id, component] of Object.entries(manifest.components)) {
    const used = sites.get(id) ?? [];
    const axes = variantsOf(manifest, component);
    if (axes.size === 0 || used.length === 0) continue;
    const kept: Array<{
      axis: string;
      options: string[];
      dynamic: DynamicSite[];
    }> = [];
    for (const [axis, config] of axes) {
      // Only an option that ships and is no default can be saved.
      const shipped = config.options.filter(
        (option) =>
          option !== config.default &&
          classes.has(`${component.class_name}--${axis}-${option}`)
      );
      if (shipped.length === 0) continue;
      const { values, dynamic } = literalsOf(axis, used, config.default);
      // Every site literal: the engine prunes what none writes itself.
      if (dynamic.length === 0) continue;
      const options = shipped.filter((option) => !values.has(option));
      if (options.length > 0) kept.push({ axis, options, dynamic });
    }
    if (kept.length === 0) continue;
    const listed = kept
      .map(({ axis, options }) => `${axis}: ${options.join(', ')}`)
      .join('; ');
    const count = kept.reduce((n, { options }) => n + options.length, 0);
    // A site is counted once, however many axes it leaves unproven, and
    // names each origin it passes, for each axis.
    const bySite = new Map<
      Site,
      Array<{ axis: string; dynamic: DynamicSite }>
    >();
    for (const { axis, dynamic: list } of kept) {
      for (const dynamic of list) {
        bySite.set(dynamic.site, [
          ...(bySite.get(dynamic.site) ?? []),
          { axis, dynamic },
        ]);
      }
    }
    const where: string[] = [];
    const forwards: Unproven['forwards'] = [];
    const derived: Unproven['derived'] = [];
    const runtimeState: Unproven['runtimeState'] = [];
    const context: Unproven['context'] = [];
    const byAxis: Unproven['byAxis'] = [];
    const same = <Entry>(a: Entry, b: Entry) =>
      JSON.stringify(a) === JSON.stringify(b);
    for (const list of bySite.values()) {
      const site = locate(list[0]!.dynamic);
      where.push(site);
      for (const { axis, dynamic } of list) {
        if (dynamic.forwarded !== undefined) {
          const { component: owner, prop } = dynamic.forwarded;
          const entry = { site, component: owner, prop };
          if (!forwards.some((f) => same(f, entry))) forwards.push(entry);
          byAxis.push({
            site,
            axis,
            origin: `forwarded from ${owner}'s ${prop}`,
          });
        } else if (dynamic.derived !== undefined) {
          const entry = {
            site,
            ...dynamic.derived,
            through: dynamic.derived.through ?? null,
          };
          if (!derived.some((d) => same(d, entry))) derived.push(entry);
          byAxis.push({ site, axis, origin: derivedPhrase(entry) });
        } else if (dynamic.runtimeState !== undefined) {
          const { hook, at } = dynamic.runtimeState;
          const entry = {
            site,
            hook,
            at: locate({ site: dynamic.site, start: at }),
          };
          if (!runtimeState.some((r) => same(r, entry))) {
            runtimeState.push(entry);
          }
          byAxis.push({ site, axis, origin: `runtime state from ${hook}` });
        } else if (dynamic.context !== undefined) {
          const { reads, defaults, through } = dynamic.context;
          const entry = {
            site,
            reads,
            ...(defaults !== undefined && { defaults }),
            through: through ?? null,
          };
          if (!context.some((c) => same(c, entry))) context.push(entry);
          byAxis.push({ site, axis, origin: contextPhrase(entry) });
        } else {
          byAxis.push({
            site,
            axis,
            origin: 'a value the audit cannot trace',
          });
        }
      }
    }
    const unproven: Unproven = {
      dynamicSites: where,
      forwards,
      derived,
      runtimeState,
      context,
      byAxis,
      ...reachedByCallers(kept, byDeclaration, routes, locate),
      blocked,
      savingMeans: 'removed-if-proven-unreached',
    };
    if (namesContext(unproven)) unproven.contextAssumption = CONTEXT_ASSUMPTION;
    const title = `${name(id)}: ${count} ${count === 1 ? 'option' : 'options'} unproven (${listed})`;
    const owners = provenance?.owners[id] ?? [];
    const unseen = owners.filter(
      ({ rule }) => rule === 'spread' || rule === 'create-element'
    );
    if (component.terminal === 'asClass') {
      refused.push({
        kind: 'kept-options',
        title,
        components: [id],
        unproven,
        rule: 'a class resolver: its uses are calls the audit does not read',
      });
      continue;
    }
    const through = Object.values(manifest.components).find(
      (other) =>
        other.terminal === 'asComponent' && other.tag === component.binding
    );
    if (through !== undefined) {
      refused.push({
        kind: 'kept-options',
        title,
        components: [id],
        unproven,
        rule: `rendered through ${through.binding} (asComponent), whose sites pass its props`,
      });
      continue;
    }
    if (unseen.length > 0 || used.some((site) => site.attrs === null)) {
      refused.push({
        kind: 'kept-options',
        title,
        components: [id],
        unproven,
        rule: 'a site spreads props or calls createElement, so it may pass any option',
      });
      continue;
    }
    const caveats: string[] = [
      `${keptByCount(where.length)}; the audit cannot prove which values ${where.length === 1 ? 'it passes' : 'they pass'}, so it is never ranked and no saving total counts it`,
    ];
    const hidden = owners.filter(({ rule }) => rule !== 'not-module-confined');
    if (hidden.length > 0) {
      caveats.push(
        `rendered where the audit cannot see its props (${[...new Set(hidden.map(({ rule }) => rule))].join(', ')})`
      );
    }
    if (used.some((site) => site.byName)) {
      caveats.push('sites matched by binding name');
    }
    if (provenance === undefined) {
      caveats.push('no slot provenance in the manifest, so spreads are unseen');
    }
    const dropped = new Set(
      kept.flatMap(({ axis, options }) =>
        options.map((option) => `${component.class_name}--${axis}-${option}`)
      )
    );
    candidates.push({
      finding: {
        kind: 'kept-options',
        title,
        components: [id],
        suggestion: keptSuggestion(unproven),
        confidence: 'low',
        caveats,
        unproven,
      },
      drop: (selector) =>
        selector.classes.some((className) => dropped.has(className)),
    });
  }
  return candidates;
}

/** Where every dynamic site of `kept` passes on its component's own prop:
 *  the listed options its matched callers pass, by axis, and those none of
 *  them passes (`Unproven`). A caller is matched to that component through
 *  the module graph (`tag_declarations`, `as_component_targets`); one that
 *  passes on a prop of its own component in turn, by an attribute or a
 *  spread, is read through that component's callers. */
function reachedByCallers(
  kept: ReadonlyArray<{
    axis: string;
    options: string[];
    dynamic: DynamicSite[];
  }>,
  byDeclaration: ReadonlyMap<string, readonly Site[]>,
  routes: ReadonlySet<string>,
  locate: (dynamic: DynamicSite) => string
): Pick<
  Unproven,
  'reachedByCallers' | 'notPassedByMatchedCallers' | 'matchedCallers'
> {
  const none = {
    reachedByCallers: null,
    notPassedByMatchedCallers: null,
    matchedCallers: null,
  };
  const reached: Array<{ axis: string; options: string[] }> = [];
  const reading: CallerReading = {
    unread: false,
    unmatchedRoute: false,
    inModule: false,
    throughImports: false,
    chain: [],
    states: [],
    derived: [],
    unexplained: false,
    unreadDefaults: [],
  };
  const read = { byDeclaration, routes, reading };
  for (const { axis, options, dynamic } of kept) {
    const passed = new Set<string>();
    for (const { site, forwarded } of dynamic) {
      if (forwarded === undefined) return none;
      for (const value of forwardedValues(
        site.file,
        forwarded,
        read,
        new Set(),
        false
      )) {
        passed.add(value);
      }
    }
    reached.push({
      axis,
      options: options.filter((option) => passed.has(option)),
    });
  }
  const { unread, states, derived, ...matched } = reading;
  if (!matched.inModule && !matched.throughImports) return none;
  return {
    reachedByCallers: reached,
    notPassedByMatchedCallers:
      unread || matched.unmatchedRoute ? null : unreachedOptions(kept, reached),
    matchedCallers: {
      ...matched,
      runtimeState: states.map(({ site, hook, at }) => ({
        hook,
        at: locate({ site, start: at }),
      })),
      derived: derived.map(({ site, at, derived: from }) => ({
        at: locate({ site, start: at }),
        component: from.component,
        props: from.props,
        ...(from.contexts !== undefined && { contexts: from.contexts }),
        ...(from.contextDefaults !== undefined && {
          contextDefaults: from.contextDefaults,
        }),
        through: from.through ?? null,
      })),
    },
  };
}

/** What reading the callers of forwards found, across them all. */
interface CallerReading {
  /** Some matched caller passes a value the audit cannot read. */
  unread: boolean;
  /** A forwarding component is also reached by a route the matching does
   *  not follow (`unmatched_routes`). */
  unmatchedRoute: boolean;
  inModule: boolean;
  throughImports: boolean;
  /** The components whose callers were read because a caller passes the
   *  prop on from its own, in the order met. */
  chain: string[];
  /** The matched callers that pass a React state hook's state slot. */
  states: Array<{ site: Site; hook: string; at: number }>;
  /** The matched callers that pass a value computed from their own
   *  component's props, where it is written. */
  derived: Array<{ site: Site; at: number | null; derived: Derived }>;
  /** A matched caller passes a value no origin explains. */
  unexplained: boolean;
  /** The forwarded props a matched caller leaves out whose default the
   *  audit cannot read, as `Component's prop`. */
  unreadDefaults: string[];
}

/** Every value the matched callers of `forwarded`, declared in `file`, pass
 *  for its prop, following a caller that passes on its own component's
 *  prop to that component's callers. A declaration already on the way in
 *  is a cycle, and unread. */
function forwardedValues(
  file: string,
  forwarded: ForwardedFact,
  read: {
    byDeclaration: ReadonlyMap<string, readonly Site[]>;
    routes: ReadonlySet<string>;
    reading: CallerReading;
  },
  onPath: Set<string>,
  /** Reached through a caller that passes its own prop on. */
  followed: boolean
): Set<string> {
  const { reading } = read;
  const values = new Set<string>();
  const declaration = `${file}::${forwarded.component}`;
  if (onPath.has(declaration)) {
    reading.unread = true;
    reading.unexplained = true;
    return values;
  }
  onPath.add(declaration);
  if (read.routes.has(declaration) || read.routes.has(`${file}::*`)) {
    reading.unmatchedRoute = true;
  }
  if (followed && !reading.chain.includes(forwarded.component)) {
    reading.chain.push(forwarded.component);
  }
  for (const caller of read.byDeclaration.get(declaration) ?? []) {
    if (caller.file === file) reading.inModule = true;
    else reading.throughImports = true;
    const passed = callerValues(caller, forwarded);
    if (passed === null) {
      reading.unread = true;
      reading.unexplained = true;
    } else if ('state' in passed) {
      reading.unread = true;
      reading.states.push({ site: caller, ...passed.state });
    } else if ('derived' in passed) {
      reading.unread = true;
      reading.derived.push({ site: caller, ...passed });
    } else if ('unreadDefault' in passed) {
      reading.unread = true;
      if (!reading.unreadDefaults.includes(passed.unreadDefault)) {
        reading.unreadDefaults.push(passed.unreadDefault);
      }
    } else if ('forwarded' in passed) {
      const inner = forwardedValues(
        caller.file,
        passed.forwarded,
        read,
        onPath,
        true
      );
      for (const value of inner) values.add(value);
    } else for (const value of passed.values) values.add(value);
  }
  onPath.delete(declaration);
  return values;
}

/** The literal `value` holds at `path`, `undefined` where it holds none
 *  there, or `null` where what it holds is no literal, or where an object
 *  on the way that lacks the key holds a `__proto__`, which may supply it. */
function memberAt(
  value: JsonValue,
  path: readonly string[]
): Literal | undefined | null {
  let current: JsonValue | undefined = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    const record: JsonRecord = current;
    current = ownEntry(record, key);
    // An object literal's `__proto__: value` sets its prototype, which may
    // supply a key it does not write.
    if (current === undefined && ownEntry(record, '__proto__') !== undefined) {
      return null;
    }
  }
  if (current === undefined) return undefined;
  return isLiteral(current) ? current : null;
}

/** The literal an inline object's `members` hold at `path`, `undefined`
 *  where the object leaves it out, or `null` where they cannot say: a
 *  member written with a value the engine cannot read, or a key an open
 *  object may write. */
function membersAt(
  members: NonNullable<UsageAttr['members']>,
  path: readonly string[]
): Literal | undefined | null {
  const [key, ...rest] = path;
  if (key === undefined) return null;
  const value = ownEntry(members.readable, key);
  if (value !== undefined) return memberAt(value, rest);
  if ((members.unreadable ?? []).includes(key)) return null;
  return members.open ? null : undefined;
}

/** Every value `site` passes as `forwarded`'s prop, or the prop of its own
 *  component it passes on there, or the origin a caller's value has (React
 *  state, or computed from its own component's props), or `null` where one
 *  may be a value the audit cannot read: no proven literal, a member it
 *  cannot read, or a spread that can replace the attribute or deliver the
 *  prop. A prop left out takes its default, else its `nullish` literal;
 *  `null` and a missing member take the `nullish` literal. A prop left out
 *  whose default the engine cannot read is named (`unreadDefault`). */
function callerValues(
  site: Site,
  forwarded: ForwardedFact
):
  | { values: Set<string> }
  | { forwarded: ForwardedFact }
  | { state: NonNullable<UsageAttr['runtimeState']> }
  | { derived: Derived; at: number | null }
  | { unreadDefault: string }
  | null {
  const { prop, path = [] } = forwarded;
  let nullish = forwarded.nullish;
  let omitted = forwarded.default ?? nullish;
  let defaultUnread = forwarded.defaultUnread === true;
  if (site.attrs === null) return null;
  const values = new Set<string>();
  const take = (value: Literal | undefined) => {
    if (value !== undefined && value !== null) values.add(String(value));
  };
  const unreadOf =
    forwarded.unreadDefaultOf ?? `${forwarded.component}'s ${prop}`;
  const unreadDefault = { unreadDefault: unreadOf };
  const leftOut = () =>
    defaultUnread
      ? unreadDefault
      : { values: new Set(omitted == null ? [] : [String(omitted)]) };
  const passing = site.through?.(prop);
  if (passing === 'kept') return leftOut();
  if (passing === 'unread') return null;
  // The runtime fills a forwarded option's default for `undefined` and
  // `null` alike (`??=`); one without a default arrives as written.
  if (passing !== undefined && passing.omitted !== undefined) {
    omitted = passing.omitted;
    nullish = passing.omitted;
    defaultUnread = false;
  }
  // A spread that may hold the prop: any but a rest that never carries it.
  const spread =
    site.spread !== undefined &&
    !(site.spreadForward?.omits ?? []).includes(prop)
      ? site.spread
      : undefined;
  // A spread of the enclosing component's props passes on what its
  // callers write, `null` included, or `fallback` where they leave it out.
  const throughSpread = (fallback: Literal | undefined, unread = false) =>
    site.spreadForward === undefined || path.length > 0 || values.size > 0
      ? null
      : {
          forwarded: {
            component: site.spreadForward.component,
            prop,
            ...(fallback !== undefined && { default: fallback }),
            ...(nullish !== undefined && { nullish }),
            ...(unread && { defaultUnread: true, unreadDefaultOf: unreadOf }),
          },
        };
  // Walking back, an attribute settles the prop unless a branch of a
  // spread may leave it out, when the one before it may take its place.
  for (let index = site.attrs.length - 1; index >= 0; index--) {
    const attr = site.attrs[index]!;
    if (attr.name !== prop || attr.skip) continue;
    if (spread !== undefined && index < spread) {
      const [only] = attr.values;
      if (
        !attr.proven ||
        attr.absent ||
        attr.values.length !== 1 ||
        only === undefined
      ) {
        return null;
      }
      return isLiteral(only) ? throughSpread(only) : null;
    }
    if (!attr.optional && values.size === 0) {
      if (attr.runtimeState !== undefined) return { state: attr.runtimeState };
      if (attr.derived !== undefined) {
        return { derived: attr.derived, at: attr.dynamicSpan?.start ?? null };
      }
    }
    const inner = attr.forwarded;
    if (
      inner !== undefined &&
      !attr.optional &&
      values.size === 0 &&
      path.length === 0
    ) {
      // What the caller leaves out or makes null falls through to this
      // forward's own fallbacks, then this prop's; a `null` it passes on
      // as `undefined` arrives here left out.
      // A default the engine cannot read, the caller's own or this
      // prop's where the caller's leaves it to it, stays unread.
      const {
        nullToUndefined,
        defaultUnread: innerUnread,
        ...passedOn
      } = inner;
      const toOurs = inner.default === undefined && inner.nullish === undefined;
      const ours = defaultUnread && (toOurs || nullToUndefined === true);
      const unread = innerUnread === true || ours;
      const fallback = innerUnread
        ? undefined
        : (inner.default ?? inner.nullish ?? omitted);
      const nullFallback = nullToUndefined
        ? omitted
        : (inner.nullish ?? nullish);
      return {
        forwarded: {
          ...passedOn,
          ...(fallback !== undefined && { default: fallback }),
          ...(nullFallback !== undefined && { nullish: nullFallback }),
          ...(unread && { defaultUnread: true }),
          ...(ours && !innerUnread && { unreadDefaultOf: unreadOf }),
        },
      };
    }
    if (!attr.proven) {
      // An inline object's literal members read on their own.
      if (path.length === 0 || attr.members === undefined) return null;
      const member = membersAt(attr.members, path);
      if (member === null) return null;
      take(member ?? nullish);
      if (!attr.optional) return { values };
      continue;
    }
    for (const value of attr.values) {
      if (path.length > 0) {
        const member = memberAt(value, path);
        if (member === null) return null;
        take(member ?? nullish);
      } else if (isLiteral(value)) take(value ?? nullish);
      else return null;
    }
    // A value that may be `undefined` or `null` also selects what leaving
    // the prop out does, and what `null` does.
    if (attr.absent) {
      if (path.length > 0) return null;
      if (defaultUnread) return unreadDefault;
      take(omitted);
      take(nullish);
    }
    if (!attr.optional) return { values };
  }
  // Left out by the spread's callers, the prop takes what leaving it out
  // here does.
  if (spread !== undefined) return throughSpread(omitted, defaultUnread);
  if (defaultUnread) return unreadDefault;
  take(omitted);
  return { values };
}

/** "derived from Wrap's color through parseThemeColor". */
function derivedPhrase({
  component,
  props,
  contexts = [],
  contextDefaults,
  through,
}: {
  component: string;
  props: string[];
  contexts?: string[];
  contextDefaults?: Record<string, JsonValue>;
  through: string | null;
}): string {
  const named = [
    ...props.map((prop) => `${component}'s ${prop}`),
    ...contexts.map((read) => withDefault(read, contextDefaults)),
  ].join(' and ');
  return `derived from ${named}${through === null ? '' : ` through ${through}`}`;
}

/** "read from SegmentContext.treatment through ??"; a read a destructuring
 *  defaults says so: "SegmentContext.size (default lg)". */
function contextPhrase({
  reads,
  defaults,
  through,
}: {
  reads: string[];
  defaults?: Record<string, JsonValue>;
  through: string | null;
}): string {
  return `read from ${reads.map((read) => withDefault(read, defaults)).join(' and ')}${through === null ? '' : ` through ${through}`}`;
}

/** A context read with the literal its destructuring defaults it to. */
function withDefault(
  read: string,
  defaults: Record<string, JsonValue> | undefined
): string {
  const fallback = defaults?.[read];
  return fallback === undefined
    ? read
    : `${read} (default ${JSON.stringify(fallback)})`;
}

/** The contexts a list of reads names (`SegmentContext` of
 *  `SegmentContext.size`), joined. */
function contextsOf(reads: string[]): string {
  return [...new Set(reads.map((name) => name.split('.')[0]))].join(' and ');
}

/** Who decides a derived value: its component's callers, and where it
 *  also reads React context, what provides that context wherever the
 *  value does not take the props (a caller leaving them out, for one). */
function derivedDecides(
  derived: { component: string; props: string[]; contexts?: string[] },
  where: 'here' | 'there'
): string {
  const { component, props, contexts = [] } = derived;
  const prop = props.length === 1 ? 'prop' : 'props';
  if (contexts.length === 0) {
    return `what ${component}'s callers pass decides it, so a change belongs at those callers; a literal ${where} would drop ${component}'s ${prop}.`;
  }
  const provided = contextsOf(contexts);
  return `what ${component}'s callers pass decides it, and what provides ${provided} decides it wherever the value does not take the ${prop} (where a caller leaves ${props.length === 1 ? 'it' : 'them'} out, for one), so a change belongs at those callers and where ${provided} is provided; a literal ${where} would drop ${component}'s ${prop} and the context.`;
}
/** What a change could let the engine see for a kept finding's options:
 *  literals at a forward's callers, a literal at a site that computes its
 *  value. Never a promise that options prune, which also takes holds a site
 *  cannot see, and never a literal where a site computes its value from its
 *  component's props, which would drop that prop. Empty where the hold
 *  blocks every change, or nothing is left to suggest: the matched callers
 *  already pass every listed option, and the other sites pass runtime
 *  state. */
function keptSuggestion(unproven: Unproven): string {
  if (unproven.blocked) {
    return 'Blocked: pruning is off for this build (see the hold at the top), so no change here can remove an option until it closes.';
  }
  const sites = unproven.dynamicSites.length;
  const parts: string[] = [];
  const covered =
    unproven.notPassedByMatchedCallers !== null &&
    unproven.notPassedByMatchedCallers.length === 0;
  if (unproven.forwards.length > 0 && !covered) {
    const components = new Set(
      unproven.forwards.map(({ component }) => component)
    );
    const props = [
      ...new Set(
        unproven.forwards.map(({ component, prop }) => `${component}'s ${prop}`)
      ),
    ];
    // A caller whose value is React state, or computed from its own
    // component's props, gets no literal remedy: one would replace it.
    const matched = unproven.matchedCallers;
    const origins =
      matched !== null &&
      matched.runtimeState.length +
        matched.derived.length +
        matched.unreadDefaults.length >
        0;
    if (!origins || matched.unexplained) {
      parts.push(
        `${props.join(' and ')} ${props.length === 1 ? 'passes' : 'pass'} on what ${components.size === 1 ? 'its callers write' : 'their callers write'}: literals at ${origins ? 'the callers whose value the audit cannot read' : 'those callers'} would let the engine see which options they reach.`
      );
    }
    if (matched !== null && matched.unreadDefaults.length > 0) {
      const named = matched.unreadDefaults;
      parts.push(
        `${named.join(' and ')} ${named.length === 1 ? 'defaults' : 'default'} to a value the audit cannot read (an import or an expression), and a matched caller leaves ${named.length === 1 ? 'it' : 'them'} out: a literal default, or a literal at those callers, would let the engine see which options they reach.`
      );
    }
    for (const { hook, at } of matched?.runtimeState ?? []) {
      parts.push(
        `A matched caller passes runtime state (${hook} at ${at}): no change is suggested there.`
      );
    }
    for (const from of matched?.derived ?? []) {
      parts.push(
        `A matched caller passes a value ${derivedPhrase(from)} (at ${from.at}): ${derivedDecides(from, 'there')}`
      );
    }
  }
  for (const derived of unproven.derived) {
    parts.push(
      `This site's value is ${derivedPhrase(derived)}: ${derivedDecides(derived, 'here')}`
    );
  }
  for (const read of unproven.context) {
    const contexts = contextsOf(read.reads);
    parts.push(
      `This site's value is ${contextPhrase(read)}: what provides ${contexts} decides it, so a change belongs where it is provided; a literal here would drop the context.`
    );
  }
  const explained = new Set([
    ...unproven.forwards.map(({ site }) => site),
    ...unproven.derived.map(({ site }) => site),
    ...unproven.runtimeState.map(({ site }) => site),
    ...unproven.context.map(({ site }) => site),
  ]).size;
  const others = sites - explained;
  if (others > 0) {
    parts.push(
      `${others === sites ? 'At the site' : `At the other ${others === 1 ? 'site' : `${others} sites`}`}, a literal, or a conditional of literals the engine can enumerate, in place of the value it cannot read would let it see which options ${others === 1 ? 'that site reaches' : 'those sites reach'}.`
    );
  }
  return parts.join(' ');
}

/** What a kept finding's matched callers pass, as evidence, never a
 *  verdict: `null` where it has none. */
function callerEvidence(unproven: Unproven | undefined): string | null {
  const reached = unproven?.reachedByCallers;
  const matched = unproven?.matchedCallers;
  if (!reached || !matched) return null;
  const passed = reached
    .filter(({ options }) => options.length > 0)
    .map(({ axis, options }) => `${axis}: ${options.join(', ')}`);
  const notPassed = unproven.notPassedByMatchedCallers;
  const where = [
    matched.inModule && 'in this module',
    matched.throughImports && 'through imports',
  ]
    .filter(Boolean)
    .join(' and ');
  // The components whose callers pass the prop on in turn, after the one
  // whose site this is.
  const followed = matched.chain;
  const through =
    followed.length > 0
      ? ` (with the callers of ${followed.join(', ')}, which pass it on)`
      : '';
  return [
    `callers matched ${where}${through} pass ${passed.length > 0 ? passed.join('; ') : 'none of the options listed'}`,
    notPassed === null
      ? [
          matched.runtimeState.length > 0 &&
            `a matched caller passes runtime state (${matched.runtimeState.map(({ hook, at }) => `${hook} at ${at}`).join(', ')})`,
          ...matched.derived.map(
            (from) =>
              `a matched caller passes a value ${derivedPhrase(from)} (at ${from.at})`
          ),
          matched.unexplained &&
            'a matched caller passes a value the audit cannot read',
          matched.unreadDefaults.length > 0 &&
            `a matched caller leaves out ${matched.unreadDefaults.join(' and ')}, whose default is a value the audit cannot read`,
          matched.unmatchedRoute &&
            'a forwarding component is also reached where the audit cannot match its callers (a dynamic import, a use other than as a tag, a namespace member, or an element handed to code the analysis does not read), so no list of options left out is given',
        ]
          .filter(Boolean)
          .join('; ')
      : notPassed.length > 0
        ? `options no matched caller passes: ${notPassed.join(', ')}`
        : 'matched callers already pass every listed option',
  ]
    .join('; ')
    .concat(
      '. A caller the audit cannot match, or a branch before this render, can differ.'
    );
}

/** The kept options no matched caller passes, as `axis: option`. */
function unreachedOptions(
  kept: ReadonlyArray<{ axis: string; options: string[] }>,
  reached: ReadonlyArray<{ axis: string; options: string[] }>
): string[] {
  return kept.flatMap(({ axis, options }) => {
    const passed = new Set(
      reached.find((entry) => entry.axis === axis)?.options ?? []
    );
    return options
      .filter((option) => !passed.has(option))
      .map((option) => `${axis}: ${option}`);
  });
}

/** High without caveats; low where a caveat changes what the rewrite
 *  must do (unseen sites, another element); medium otherwise. */
function confidenceOf(caveats: string[], low: boolean): Confidence {
  if (low) return 'low';
  return caveats.length === 0 ? 'high' : 'medium';
}

/** A component's rules from its fragments, each as `layer | conditions |
 *  selector with its class as & | declarations`. */
function fragmentKeys(manifest: FullProjectManifest, id: string): Set<string> {
  const component = manifest.components[id]!;
  const keys = new Set<string>();
  for (const [layer, css] of Object.entries(
    manifest.component_fragments[id] ?? {}
  )) {
    if (css === undefined) continue;
    eachStyleRule(parseSheet(css).rules, (rule) => {
      for (const selector of rule.selectors) {
        const anchored = selector.text
          .split(`.${component.class_name}`)
          .join('&');
        keys.add(
          `${layer}|${rule.context.join(' ')}|${anchored}|${rule.declarations.join(';')}`
        );
      }
    });
  }
  return keys;
}

const DEFAULT_OPTION_RULE = /^[^|]*\|[^|]*\|&--[\w-]+-default(?![\w-])/;

/** The runtime record after its element and class, defaults blanked. */
const recordAfterClass = (component: ManifestComponentDescriptor): string =>
  component.replacement
    .slice(
      component.replacement.indexOf(component.class_name) +
        component.class_name.length
    )
    .replace(/"default":"[^"]*"/g, '"default":§');

function defaultsOnlyExtensions(
  manifest: FullProjectManifest,
  sites: Map<string, Site[]>,
  shipped: (className: string) => boolean,
  refused: Refusal[]
): Candidate[] {
  const candidates: Candidate[] = [];
  const name = componentNames(manifest);
  const keys = new Map<string, Set<string>>();
  const keysOf = (id: string): Set<string> => {
    let known = keys.get(id);
    if (known === undefined) {
      known = fragmentKeys(manifest, id);
      keys.set(id, known);
    }
    return known;
  };
  const others = (leafId: string, className: string): string | null => {
    for (const [id, sheets] of Object.entries(manifest.component_fragments)) {
      if (id === leafId) continue;
      for (const css of Object.values(sheets)) {
        if (css?.includes(className)) return id;
      }
    }
    return (manifest.sheets?.global ?? '').includes(className)
      ? 'global styles'
      : null;
  };
  for (const [id, leaf] of Object.entries(manifest.components)) {
    const parentId = leaf.extends_from;
    const parent = parentId ? manifest.components[parentId] : undefined;
    if (!parentId || !parent || !shipped(leaf.class_name)) continue;
    if (recordAfterClass(leaf) !== recordAfterClass(parent)) continue;
    const leafKeys = keysOf(id);
    const parentKeys = keysOf(parentId);
    const differs = [
      ...[...leafKeys].filter((key) => !parentKeys.has(key)),
      ...[...parentKeys].filter((key) => !leafKeys.has(key)),
    ];
    if (!differs.every((key) => DEFAULT_OPTION_RULE.test(key))) continue;
    const leafAxes = variantsOf(manifest, leaf);
    const changed = [...variantsOf(manifest, parent)]
      .filter(
        ([axis, config]) => leafAxes.get(axis)?.default !== config.default
      )
      .map(([axis]) => `${axis}="${leafAxes.get(axis)?.default}"`);
    const title =
      changed.length > 0
        ? `${name(id)} is ${name(parentId)} with ${changed.join(', ')}`
        : `${name(id)} is a copy of ${name(parentId)} under its own class`;
    const target = others(id, leaf.class_name);
    const children = manifest.reverse_provenance[id] ?? [];
    const refuse = (rule: string) =>
      refused.push({
        kind: 'defaults-only-extension',
        title,
        components: [id, parentId],
        rule,
      });
    if (leaf.terminal === 'asClass') {
      refuse('a class resolver: there is no element to wrap');
      continue;
    }
    if (target !== null) {
      refuse(
        `another rule selects its class (${manifest.components[target]?.binding ?? target})`
      );
      continue;
    }
    if (children.length > 0) {
      refuse(
        `${children.length} components extend it, and a wrapper cannot be extended`
      );
      continue;
    }
    if (!shipped(parent.class_name)) {
      refuse(`${parent.binding}'s CSS does not ship on its own`);
      continue;
    }
    const caveats: string[] = [];
    const differentElement =
      leaf.terminal !== parent.terminal || leaf.tag !== parent.tag;
    if (differentElement) {
      caveats.push(
        `renders ${leaf.tag}, ${parent.binding} renders ${parent.tag}: the wrapper passes as`
      );
    }
    const used = sites.get(id) ?? [];
    if (used.some(coApplies)) {
      caveats.push(
        'sites pass className or asChild: a co-applied class meets the parent rules earlier in the sheet'
      );
    }
    if (used.some((site) => site.byName)) {
      caveats.push('sites matched by binding name');
    }
    const className = leaf.class_name;
    candidates.push({
      finding: {
        kind: 'defaults-only-extension',
        title,
        components: [id, parentId],
        suggestion:
          changed.length > 0
            ? `Replace the .extend() chain with a wrapper that renders <${parent.binding}> with ${changed.join(', ')} when the prop is omitted (\`props.x ?? default\`, so an explicit undefined still means the default). ${leaf.binding}'s class and its copy of ${parent.binding}'s CSS go.`
            : `Alias it: \`const ${leaf.binding} = ${parent.binding}\`. ${leaf.binding}'s class and its copy of ${parent.binding}'s CSS go.`,
        confidence: confidenceOf(caveats, differentElement),
        caveats,
      },
      drop: (selector) =>
        selector.classes.some((needed) => classStem(needed) === className),
    });
  }
  return candidates;
}

function repeatedBaseBlocks(
  manifest: FullProjectManifest,
  measured: Measured,
  sites: Map<string, Site[]>,
  refused: Refusal[]
): Candidate[] {
  const byClass = new Map<string, string>();
  for (const [id, component] of Object.entries(manifest.components)) {
    byClass.set(component.class_name, id);
  }
  // Every property each component's class sets, by rule, to find the
  // members that set a block's property elsewhere.
  const setBy = new Map<string, Array<{ rule: StyleRule; props: string[] }>>();
  const groups = new Map<
    string,
    { declarations: string[]; members: Array<{ id: string; rule: StyleRule }> }
  >();
  for (const file of measured.files.keys()) {
    eachStyleRule(measured.sheet(file).rules, (rule) => {
      const props = rule.declarations.map(propertyOf);
      const named = new Set<string>();
      for (const selector of rule.selectors) {
        for (const name of selector.classes) {
          const stem = classStem(name);
          if (byClass.has(stem)) named.add(stem);
        }
      }
      for (const name of named) {
        const list = setBy.get(name) ?? [];
        list.push({ rule, props });
        setBy.set(name, list);
      }
      if (
        rule.declarations.length < MIN_SHARED_DECLARATIONS ||
        !rule.context.some((at) => /^@layer anm-base\b/.test(at))
      ) {
        return;
      }
      const key = `${rule.context.join(' ')}|${rule.declarations.join(';')}`;
      for (const selector of rule.selectors) {
        const id = /^\.[\w-]+$/.test(selector.text)
          ? byClass.get(selector.text.slice(1))
          : undefined;
        if (id === undefined) continue;
        const group = groups.get(key) ?? {
          declarations: rule.declarations,
          members: [],
        };
        if (!group.members.some((member) => member.id === id)) {
          group.members.push({ id, rule });
        }
        groups.set(key, group);
      }
    });
  }
  const candidates: Candidate[] = [];
  const name = componentNames(manifest);
  for (const { declarations, members } of groups.values()) {
    if (members.length < 2) continue;
    const blockFamilies = new Set(declarations.map(propertyOf).map(familyOf));
    const block = `{${declarations.join(';')}}`;
    const kept: string[] = [];
    const reasons = new Map<string, string[]>();
    const note = (reason: string, id: string) =>
      reasons.set(reason, [...(reasons.get(reason) ?? []), id]);
    for (const { id, rule } of members) {
      const component = manifest.components[id]!;
      if (component.terminal !== 'asElement') {
        note('renders another component or is a class resolver', id);
      } else if (
        component.extends_from !== null ||
        (manifest.reverse_provenance[id] ?? []).length > 0
      ) {
        note('in an extension chain, whose copies inherit its base', id);
      } else if (
        (setBy.get(component.class_name) ?? []).some(
          (other) =>
            other.rule !== rule &&
            other.props.some((prop) => blockFamilies.has(familyOf(prop)))
        )
      ) {
        note(
          "sets a property of the block's families (a shorthand, its longhands, or their logical or physical sides) in another rule",
          id
        );
      } else {
        kept.push(id);
      }
    }
    const names = (ids: string[]) => ids.map(name);
    const title = (ids: string[]) =>
      `${ids.length} components repeat the base block ${block} (${names(ids).join(', ')})`;
    for (const [reason, ids] of reasons) {
      refused.push({
        kind: 'repeated-base-block',
        title: `${names(ids).join(', ')}, of ${members.length} components repeating the base block ${block}`,
        components: ids,
        rule: reason,
      });
    }
    if (kept.length < 2) continue;
    const caveats: string[] = [];
    const tags = new Set(kept.map((id) => manifest.components[id]!.tag));
    if (tags.size > 1) {
      caveats.push(
        `members render different elements (${[...tags].join(', ')}): the layout passes as`
      );
    }
    const used = kept.flatMap((id) => sites.get(id) ?? []);
    if (used.some(coApplies)) {
      caveats.push(
        'sites pass className or asChild: a co-applied class may meet the shared rule in another order'
      );
    }
    if (used.some((site) => site.byName)) {
      caveats.push('sites matched by binding name');
    }
    const shared = new Set(
      kept.slice(1).map((id) => manifest.components[id]!.class_name)
    );
    const ruleOf = new Map(members.map(({ id, rule }) => [id, rule]));
    const rules = new Set(kept.slice(1).map((id) => ruleOf.get(id)));
    candidates.push({
      finding: {
        kind: 'repeated-base-block',
        title: title(kept),
        components: kept,
        suggestion:
          'Share it: one layout component whose base is the block, and each member written as `system.styles(rest)…asComponent(Layout)` with the rest of its styles. No other rule of a member sets a property of the block’s families, so the members’ own rules do not compete with the layout’s. A rule from elsewhere that matches these elements can: the layout’s rules land where its id (file::binding) sorts, so check that none sits between.',
        confidence: tags.size > 1 ? 'low' : 'medium',
        caveats,
      },
      drop: (selector, rule) =>
        rules.has(rule) && shared.has(selector.text.slice(1)),
    });
  }
  return candidates;
}

/**
 * Each candidate's saving: raw for all; gzip where the raw saving reaches
 * the floor, since no deletion compresses to more than it removes; Brotli,
 * run in parallel, for the largest gzip savings that reach it, at most
 * `BROTLI_PER_KIND` per kind.
 */
async function measureCandidates(
  candidates: Candidate[],
  measured: Measured,
  floor: number
): Promise<Restructure[]> {
  const first = await Promise.all(
    candidates.map(async (candidate) => {
      const edit = measured.without(candidate.drop);
      const raw = await measured.saving(edit, 'raw');
      return {
        candidate,
        saving: raw.raw < floor ? raw : await measured.saving(edit, 'gzip'),
      };
    })
  );
  first.sort((a, b) => (b.saving.gzip ?? -1) - (a.saving.gzip ?? -1));
  const perKind = new Map<RestructureKind, number>();
  const findings = await Promise.all(
    first.map(async ({ candidate, saving }): Promise<Restructure> => {
      const { kind } = candidate.finding;
      const count = perKind.get(kind) ?? 0;
      let final = saving;
      const unproven = candidate.finding.unproven !== undefined;
      if (!unproven && (saving.gzip ?? 0) >= floor && count < BROTLI_PER_KIND) {
        perKind.set(kind, count + 1);
        final = await measured.saving(
          measured.without(candidate.drop),
          'brotli'
        );
      }
      // Ranked on Brotli alone: one not measured stays below the floor, and
      // an unproven one is neither ranked nor below it.
      return {
        ...candidate.finding,
        saving: final,
        belowFloor:
          !unproven && (final.brotli === null || final.brotli < floor),
        removedByDelivery: false,
      };
    })
  );
  return findings.sort(
    (a, b) =>
      (b.saving.brotli ?? -Infinity) - (a.saving.brotli ?? -Infinity) ||
      (b.saving.gzip ?? -Infinity) - (a.saving.gzip ?? -Infinity) ||
      b.saving.raw - a.saving.raw
  );
}

/**
 * The findings with the delivery estimate's overlap marked, where its
 * verdict turns removal on: one whose every component removal removes saves
 * nothing once it is on, and the delivery saving already counts its CSS,
 * so it leaves the ranking; one that shares some components says so.
 */
function withoutRemoved(
  findings: Restructure[],
  delivery: DeliveryReport
): Restructure[] {
  if ('unavailable' in delivery || delivery.removal === null) return findings;
  const removed = new Set(
    delivery.removalRecommended ? delivery.removal.removed : []
  );
  if (removed.size === 0) return findings;
  return findings.map((finding) => {
    const gone = finding.components.filter((id) => removed.has(id));
    if (gone.length === 0) return finding;
    if (gone.length === finding.components.length) {
      return {
        ...finding,
        removedByDelivery: true,
        belowFloor: finding.unproven === undefined,
      };
    }
    return {
      ...finding,
      caveats: [
        ...finding.caveats,
        `removeUnbundledComponents removes ${gone.length} of its ${finding.components.length} components, whose share of this saving the delivery estimate also counts`,
      ],
    };
  });
}

// --------------------------------------------------------------- audit

export interface CssAuditOptions {
  manifest: string;
  dist: string;
  /** The project root the manifest's file paths are relative to, for the
   *  lines of the sites it names; without it a site is named by byte. */
  root?: string;
}

/** Names a dynamic site `file:line`, reading its file under `root`, or
 *  `file@byte` where the file cannot be read; a site whose value has no
 *  position (a `createElement` call's) by its file. */
function siteLocator(
  root: string | undefined
): (dynamic: DynamicSite) => string {
  const sources = new Map<string, Buffer | null>();
  const read = (file: string): Buffer | null => {
    if (!sources.has(file)) {
      let source: Buffer | null = null;
      try {
        source = root === undefined ? null : readFileSync(resolve(root, file));
      } catch {
        source = null;
      }
      sources.set(file, source);
    }
    return sources.get(file) ?? null;
  };
  return ({ site, start }) => {
    if (start === null) {
      return site.attrs === null ? `${site.file} (createElement)` : site.file;
    }
    const source = read(site.file);
    const line = source === null ? null : lineAtByte(source, start);
    return line === null ? `${site.file}@${start}` : `${site.file}:${line}`;
  };
}

/** Reads a build's full manifest and its built output, and measures what
 *  each finding would save. Writes nothing. */
export async function runCssAudit(
  options: CssAuditOptions
): Promise<CssAuditReport> {
  const audited = readManifest(options.manifest);
  const { manifest } = audited;
  const dist = readDist(options.dist);
  const measured = new Measured(
    new Map(
      dist.files
        .filter(({ file }) => file.endsWith('.css'))
        .map(({ file, text }) => [file, text])
    )
  );
  // The totals and the floor are Animus's CSS alone: another stylesheet
  // the app ships (an editor's, a library's) changes with none of these.
  const layered = [...measured.files.keys()].filter((file) =>
    hasAnimusLayer(measured.sheet(file).rules)
  );
  const counted = layered.length > 0 ? layered : [...measured.files.keys()];
  const total = await measured.sizes(
    counted.map((file) => measured.files.get(file)!),
    'brotli'
  );
  const floor = Math.round(total.brotli! * FLOOR_SHARE);
  const classes = new Set<string>();
  // The classes rules of Animus's layers name, for the mismatch check, and
  // the files with classes but none of Animus's layers.
  const layerClasses = new Set<string>();
  const inLayer = (rule: StyleRule) =>
    rule.context.some(
      (at) => at.startsWith('@layer ') && namesAnimusLayer(at.slice(7))
    );
  const unlayered: string[] = [];
  for (const file of measured.files.keys()) {
    const { rules } = measured.sheet(file);
    addSelectedClasses(rules, classes);
    addNamedClasses(rules, layerClasses, inLayer);
    if (!layered.includes(file) && addNamedClasses(rules, new Set()).size > 0) {
      unlayered.push(file);
    }
  }
  // A component ships where a rule names its class or one derived from it.
  const stems = new Set([...classes].map(classStem));
  const shipped = (className: string) => stems.has(className);
  const emitted = new Set<string>();
  // The classes the manifest emits outside its layers (a global block
  // registered unlayered).
  const emittedUnlayered = new Set<string>();
  for (const css of [manifest.css, ...Object.values(manifest.sheets ?? {})]) {
    const { rules } = parseSheet(css);
    addNamedClasses(rules, emitted);
    addNamedClasses(rules, emittedUnlayered, (rule) => !inLayer(rule));
  }
  // Every class the manifest can emit: its CSS's and sheets', and its
  // components', utilities' and dynamic slots' by name.
  const owned = new Set([
    ...emitted,
    ...Object.values(manifest.components).map((leaf) => leaf.class_name),
    ...Object.values(manifest.system_prop_map ?? {}).flatMap((byValue) =>
      Object.values(byValue)
    ),
    ...Object.values(manifest.dynamic_props).flatMap(
      (meta) => meta.slotClass ?? []
    ),
  ]);
  // Only Animus's layers tell its classes from the app's: without them a
  // class name alone cannot. A file with classes and no Animus layer is
  // audited with a warning that names it where it may hold this build's
  // output: no file has the layers, or the manifest emits classes outside
  // them. Beside layered output from a manifest that emits none, it is
  // another stylesheet the app ships (an editor's, a library's).
  const warnings: string[] = [];
  if (
    unlayered.length > 0 &&
    (layered.length === 0 || emittedUnlayered.size > 0)
  ) {
    const files = unlayered.sort();
    warnings.push(
      `css audit: ${files.slice(0, 3).join(', ')}${files.length > 3 ? `, +${files.length - 3} more` : ''} ${files.length === 1 ? 'has' : 'have'} classes and no Animus layers, so the audit cannot confirm this manifest comes from the same build as ${files.length === 1 ? 'it' : 'them'}`
    );
  }
  // Every class a rule of Animus's layers selects in the shipped CSS is one
  // the manifest can emit: a build that read a source differently (a
  // transform it could not resolve, other sources) names that component's
  // class from another fingerprint. Class names are what this compares: a
  // build that differs only in a declaration's value, or in a global rule
  // that selects no class, passes.
  const foreign = [...layerClasses].filter((name) => !owned.has(name));
  if (foreign.length > 0) {
    const named = foreign.sort();
    throw new UsageFailure(
      `css audit: the CSS under ${options.dist} selects ${named.length} classes in Animus's layers that the manifest's CSS does not (${named.slice(0, 5).join(', ')}${named.length > 5 ? `, +${named.length - 5} more` : ''}), so the manifest describes another build: one that read a source differently (an import the host resolves and \`animus build\` cannot, such as one through the bundler's resolve conditions (pass them with --condition) or aliases, which its warnings name) or used other settings; write the manifest from the configuration that built the output. (The check compares class names only, so a manifest whose build differs from the output only in declarations or classless global rules is not caught.)`
    );
  }
  const located = componentSites(audited);
  const { sites, evidence } = located;
  const refused: Refusal[] = [];
  const hold = pruningHold(manifest, options.root);
  const candidates = [
    ...keptOptions(
      manifest,
      classes,
      located,
      siteLocator(options.root),
      refused,
      hold !== null
    ),
    ...defaultsOnlyExtensions(manifest, sites, shipped, refused),
    ...repeatedBaseBlocks(manifest, measured, sites, refused),
  ];
  const [delivery, slots, measuredFindings] = await Promise.all([
    deliveryReport(audited, measured, dist, layered),
    slotReport(manifest, measured),
    measureCandidates(candidates, measured, floor),
  ]);
  const findings = withoutRemoved(measuredFindings, delivery);
  return {
    manifest: options.manifest,
    dist: options.dist,
    warnings,
    css: {
      files: counted.length,
      sizes: { raw: total.raw, gzip: total.gzip!, brotli: total.brotli! },
      others: [...measured.files.keys()].filter(
        (file) => !counted.includes(file)
      ),
    },
    components: Object.keys(manifest.components).length,
    delivery,
    slots,
    restructures: {
      floor,
      findings,
      refused,
      siteEvidence: evidence,
      pruningHold: hold,
    },
  };
}

/** The usage gaps where the analysis may not read a source that renders
 *  (analyze_css.rs's `analysis_gaps`), each with what releases it. */
const UNSEEN = {
  'unread-load': {
    what: 'a computed load that may load a file analysis does not read',
    one: 'computed load that may load a file analysis does not read',
    many: 'computed loads that may load a file analysis does not read',
    release:
      'analyse every file it may load, or narrow it to the files analysis reads; where the host lists no exact expansion of it, it may load any file',
  },
  'skipped-source': {
    what: 'a source analysis skips',
    one: 'source analysis skips',
    many: 'sources analysis skips',
    release: 'analyse it',
  },
  'incomplete-probe': {
    what: 'an import that opens a file analysis does not read',
    one: 'import that opens a file analysis does not read',
    many: 'imports that open a file analysis does not read',
    release: 'analyse the file it opens, or serve it as an asset',
  },
} satisfies Record<
  string,
  { what: string; one: string; many: string; release: string }
>;

type UnseenKind = keyof typeof UNSEEN;

/** What holds pruning off, as the engine holds it: the sites that may
 *  patch a built-in every render reads through (the manifest's
 *  `patches-intrinsics` usage gaps), and every source the analysis may not
 *  read (`UNSEEN`). While any is open the engine keeps every variant and
 *  state option of every component. */
function pruningHold(
  manifest: FullProjectManifest,
  root: string | undefined
): CssAuditReport['restructures']['pruningHold'] {
  const usage = manifest.slot_provenance?.usage ?? [];
  const siteOf = ({ file, at, line }: (typeof usage)[number]) => {
    if (file === undefined) return '(unnamed file)';
    if (line !== undefined) return `${file}:${line}`;
    if (at === undefined || root === undefined) return file;
    try {
      const found = lineAtByte(readFileSync(resolve(root, file)), at);
      return found === null ? `${file}@${at}` : `${file}:${found}`;
    } catch {
      return `${file}@${at}`;
    }
  };
  const patches = usage.filter(({ rule }) => rule === 'patches-intrinsics');
  const unseen = usage.flatMap((gap) => {
    const entry = ownEntry(UNSEEN, gap.rule);
    if (entry === undefined) return [];
    return [
      {
        // SAFETY: `ownEntry` found the rule as an own key of `UNSEEN`.
        kind: gap.rule as UnseenKind,
        site: siteOf(gap),
        detail: gap.detail ?? null,
        release: entry.release,
      },
    ];
  });
  if (patches.length === 0 && unseen.length === 0) return null;
  const sites = patches.map((patch) => ({
    site: siteOf(patch),
    rule: patch.detail ?? null,
  }));
  return {
    patchSites: patches.length,
    files: new Set(patches.map(({ file }) => file)).size,
    firstSites: sites.slice(0, SITES_SHOWN).map(({ site }) => site),
    sites,
    unseen,
  };
}

/** Why each rule of the patches-intrinsics hold counts a site
 *  (usage_facts/forwarding.rs and analyze_css.rs's patch gaps). */
const PATCH_RULES = {
  'prototype-use':
    'a computed read (`x[key]`) the analysis cannot bound may read a prototype (`__proto__`, `constructor`) off the object, and what it reads may be written through or handed on',
  'unowned-write':
    "a write into an object the module does not own (a parameter, an import, a ref's `current`, a DOM node), which may be a built-in or a prototype",
  'prop-key-store':
    "a store, under a key a render reads (a prop's, a variant's or a state's name, `children`, `ref`), into an object that may be the prototype every props object inherits",
  'prototype-let-go':
    'a prototype, or a descriptor taken off one, handed to code the walk does not follow',
  'trusted-let-go':
    'a trusted global (`window`, `globalThis`) handed to an import that reads code',
  'string-code':
    '`eval`, `Function` or a `constructor` called, which runs a string',
  'writer-let-go':
    'a writer (`Object.assign`, `Reflect.set`, …) handed on as a value, which writes into targets the walk cannot see',
  'unread-key-store': 'a store into a global by a key the walk cannot read',
  'spread-target': 'a spread or assign into a target the walk cannot name',
  'prototype-name-write':
    "a write of a built-in method's name into `this`, which a caller may bind to the global object",
} satisfies Record<string, string>;

// -------------------------------------------------------------- report

const zero = (): Saving => ({ raw: 0, gzip: 0, brotli: 0 });

const subtract = (a: Saving, b: Saving): Saving => ({
  raw: a.raw - b.raw,
  gzip: a.gzip === null || b.gzip === null ? null : a.gzip - b.gzip,
  brotli: a.brotli === null || b.brotli === null ? null : a.brotli - b.brotli,
});

const bytes = (n: number): string => `${n.toLocaleString('en-US')} B`;

const savingText = (saving: Saving): string =>
  `br ${saving.brotli ?? 'not measured'} · gz ${saving.gzip ?? 'not measured'} · raw ${saving.raw}`;

export function formatCssAudit(report: CssAuditReport): string {
  const { css, delivery, slots, restructures } = report;
  const lines: string[] = [
    ...report.warnings.map((warning) => `warning: ${warning}`),
    `animus css audit: ${report.dist}`,
    `Animus CSS ${css.files} files: raw ${bytes(css.sizes.raw)}, gzip ${bytes(css.sizes.gzip)}, Brotli ${bytes(css.sizes.brotli)}; ${report.components} components`,
    ...(css.others.length > 0
      ? [
          `Other CSS, left out of the totals and the floor: ${css.others.slice(0, 5).join(', ')}${css.others.length > 5 ? `, +${css.others.length - 5} more` : ''}`,
        ]
      : []),
    ...holdLines(restructures.pruningHold),
    `Savings are measured: each edits the shipped CSS and recompresses each file alone (gzip -9, Brotli q11 lgwin 22); Brotli ranks them, measured for at most ${BROTLI_PER_KIND} findings of each kind whose gzip saving reaches the floor; a finding it does not measure stays below the floor, except one a dynamic site holds back, which is listed as kept with no saving. A finding names its first ${SITES_SHOWN} dynamic sites, then how many more.`,
    '',
    '1. Delivery',
    ...deliveryLines(delivery, report.components),
    '',
    '2. Slot keepers',
  ];
  if (slots === null) {
    lines.push(
      '  No slot provenance in this manifest: build with `animus build --verbose` (or a host with verbose output) to see what keeps each runtime slot.'
    );
  } else if (slots.props === 0 && slots.componentSlots.slots === 0) {
    lines.push('  No runtime slot is kept.');
  } else {
    lines.push(
      `  ${slots.props} system props keep a runtime slot; closing every one saves ${savingText(slots.saving)}`
    );
    for (const group of slots.groups) {
      lines.push(
        `  ${group.rule}: keeps ${group.props} props; closing it alone closes ${group.only}, saving ${savingText(group.saving)}`
      );
      for (const owner of group.owners) {
        lines.push(
          `      ${owner.component}: ${owner.props} props${owner.sites.length > 0 ? `, at ${owner.sites.join('; ')}` : ''}`
        );
      }
    }
    const gaps = Object.entries(slots.usageGaps);
    if (gaps.length > 0) {
      lines.push(
        `  Usage not proven project-wide: ${gaps.map(([rule, n]) => `${rule} ${n}`).join(', ')}`
      );
    }
    if (slots.componentSlots.slots > 0) {
      lines.push(
        `  Component slots: ${slots.componentSlots.slots} on ${slots.componentSlots.components} components (${Object.entries(
          slots.componentSlots.byRule
        )
          .map(([rule, n]) => `${rule} ${n}`)
          .join(', ')})`
      );
    }
  }
  const above = restructures.findings.filter(
    (finding) => !finding.belowFloor && finding.unproven === undefined
  );
  // A finding a dynamic site holds back saves nothing the audit can
  // promise: it is listed as kept, never in a saving or a total.
  const below = restructures.findings.filter(
    (finding) => finding.belowFloor && !finding.removedByDelivery
  );
  const unproven = restructures.findings.filter(
    (finding) => finding.unproven !== undefined && !finding.removedByDelivery
  );
  const removed = restructures.findings.filter(
    (finding) => finding.removedByDelivery
  );
  lines.push(
    '',
    `3. Restructures (floor ${bytes(restructures.floor)} Brotli, 0.25% of the CSS; sites matched by ${restructures.siteEvidence === 'component-id' ? 'component id' : 'binding name'})`
  );
  if (above.length === 0) lines.push('  None above the floor.');
  above.forEach((finding, index) => {
    lines.push(
      `  ${index + 1}. [${finding.kind}] ${finding.confidence}: ${finding.title}`,
      `     saves ${savingText(finding.saving)}`,
      `     ${finding.suggestion}`
    );
    if (finding.caveats.length > 0) {
      lines.push(`     caveats: ${finding.caveats.join('; ')}`);
    }
  });
  if (below.length > 0) {
    const raw = below.reduce((n, finding) => n + finding.saving.raw, 0);
    lines.push(
      `  Below the floor: ${findings(below.length)}, ${bytes(raw)} raw together (${countBy(below.map(({ kind }) => kind))}); the largest:`
    );
    for (const finding of below.slice(0, BELOW_SHOWN)) {
      lines.push(
        `    ${savingText(finding.saving)}  [${finding.kind}] ${finding.confidence}: ${finding.title}`
      );
    }
  }
  if (unproven.length > 0) {
    lines.push(
      `  Kept (unproven): ${findings(unproven.length)}, whose options a dynamic site may pass, so the audit counts no saving for them:`
    );
    for (const finding of unproven) {
      lines.push(
        `    [${finding.kind}] ${finding.confidence}: ${titleText(finding)}`
      );
      const evidence = callerEvidence(finding.unproven);
      if (evidence !== null) lines.push(`      ${evidence}`);
      for (const { hook, at } of finding.unproven?.runtimeState ?? []) {
        lines.push(`      kept: runtime state (${hook} at ${at})`);
      }
      if (finding.suggestion !== '') {
        lines.push(`      next: ${finding.suggestion}`);
      }
    }
  }
  if (removed.length > 0) {
    lines.push(
      `  Left out: ${findings(removed.length)} on components removeUnbundledComponents removes, which the delivery verdict turns on and whose saving counts their CSS:`,
      ...removed.map((finding) => `    ${titleText(finding)}`)
    );
  }
  if (restructures.refused.length > 0) {
    lines.push(`  Refused: ${restructures.refused.length}`);
    const byRule = new Map<string, Refusal[]>();
    for (const refusal of restructures.refused) {
      const key = `${refusal.kind}: ${refusal.rule}`;
      byRule.set(key, [...(byRule.get(key) ?? []), refusal]);
    }
    for (const [rule, list] of byRule) {
      lines.push(`    ${rule} (${list.length}), e.g. ${titleText(list[0]!)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** The build-wide hold, said once at the top of the report. */
function holdLines(
  hold: CssAuditReport['restructures']['pruningHold']
): string[] {
  if (hold === null) return [];
  const reason = (rule: string | null) => {
    const why = rule === null ? undefined : ownEntry(PATCH_RULES, rule);
    return why === undefined ? '' : `: ${why}`;
  };
  const plural = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`;
  const byRule = new Map<string | null, string[]>();
  for (const { site, rule } of hold.sites) {
    byRule.set(rule, [...(byRule.get(rule) ?? []), site]);
  }
  const groups = [...byRule].sort(
    ([a, left], [b, right]) =>
      right.length - left.length || String(a).localeCompare(String(b))
  );
  const unseen = new Map<UnseenKind, string[]>();
  for (const { kind, site, detail } of hold.unseen) {
    unseen.set(kind, [
      ...(unseen.get(kind) ?? []),
      detail === null ? site : `${site} ${detail}`,
    ]);
  }
  const causes = [
    ...(hold.patchSites > 0
      ? [
          `${plural(hold.patchSites, 'site', 'sites')} in ${plural(hold.files, 'file', 'files')} may patch a built-in every render reads through (patches-intrinsics)`,
        ]
      : []),
    ...[...unseen].map(
      ([kind, sites]) =>
        `${plural(sites.length, UNSEEN[kind].one, UNSEEN[kind].many)} (${kind})`
    ),
  ];
  return [
    `Variant and state pruning is off for this build: ${causes.join(', and ')}, so every component keeps every option. The hold releases only when no site is left: each listed below must be resolved, and no site change below can prune an option until then.${hold.patchSites > 0 ? ' The analysis records the first such site of each kind in a file, so resolving one can uncover the next in the same file.' : ''}`,
    ...groups.flatMap(([rule, sites]) => [
      `  ${rule ?? 'rule not recorded'}, ${plural(sites.length, 'site', 'sites')}${reason(rule)}`,
      ...sites.map((site) => `    ${site}`),
    ]),
    ...[...unseen].flatMap(([kind, sites]) => [
      `  ${kind}, ${plural(sites.length, 'site', 'sites')}: ${UNSEEN[kind].what}; to release it, ${UNSEEN[kind].release}`,
      ...sites.map((site) => `    ${site}`),
    ]),
  ];
}

/** What a context origin assumes: React treats context values as
 *  immutable, and code in another module could still mutate one. */
const CONTEXT_ASSUMPTION =
  'a context origin holds only if no code mutates the value its provider supplies (React treats context values as immutable)';

/** Whether any origin a finding lists names React context. */
function namesContext(unproven: Unproven): boolean {
  return (
    unproven.context.length > 0 ||
    unproven.derived.some(({ contexts = [] }) => contexts.length > 0) ||
    (unproven.matchedCallers?.derived ?? []).some(
      ({ contexts = [] }) => contexts.length > 0
    )
  );
}

const keptByCount = (sites: number): string =>
  `kept by ${sites} dynamic ${sites === 1 ? 'site' : 'sites'}`;

const findings = (n: number): string =>
  `${n} ${n === 1 ? 'finding' : 'findings'}`;

/** A finding's title, and the dynamic sites that keep its options where
 *  any do, the first few named, each by its full path: a `file:line` in the
 *  file before it as its line alone. */
function titleText({ title, unproven }: Restructure | Refusal): string {
  if (unproven === undefined) return title;
  const { dynamicSites } = unproven;
  const forwarded = new Map<string, string>();
  for (const { site, component, prop } of unproven.forwards) {
    const note = forwarded.get(site);
    forwarded.set(
      site,
      note === undefined
        ? `forwarded from ${component}'s ${prop}`
        : `${note} and ${component}'s ${prop}`
    );
  }
  for (const derived of unproven.derived) {
    forwarded.set(derived.site, derivedPhrase(derived));
  }
  for (const { site, hook } of unproven.runtimeState) {
    forwarded.set(site, `runtime state from ${hook}`);
  }
  for (const read of unproven.context) {
    forwarded.set(read.site, contextPhrase(read));
  }
  // A site that keeps more than one axis names each axis's origin.
  const axesAt = new Map<string, Array<{ axis: string; origin: string }>>();
  for (const { site, axis, origin } of unproven.byAxis) {
    axesAt.set(site, [...(axesAt.get(site) ?? []), { axis, origin }]);
  }
  for (const [site, axes] of axesAt) {
    if (new Set(axes.map(({ axis }) => axis)).size > 1) {
      forwarded.set(
        site,
        axes.map(({ axis, origin }) => `${axis}: ${origin}`).join('; ')
      );
    }
  }
  let previous: string | null = null;
  const named = dynamicSites.slice(0, SITES_SHOWN).map((site) => {
    const note = forwarded.has(site) ? ` (${forwarded.get(site)})` : '';
    const line = /^(.+)(:\d+)$/.exec(site);
    if (line !== null && line[1] === previous) return `${line[2]}${note}`;
    previous = line?.[1] ?? null;
    return `${site}${note}`;
  });
  const more = dynamicSites.length - named.length;
  const assumed =
    unproven.contextAssumption === undefined
      ? ''
      : `; ${unproven.contextAssumption}`;
  return `${title}, ${keptByCount(dynamicSites.length)}: ${named.join(', ')}${more > 0 ? `, +${more} more` : ''}${assumed}`;
}

function deliveryLines(delivery: DeliveryReport, components: number): string[] {
  if ('unavailable' in delivery) {
    return [`  Not estimated: ${delivery.unavailable}`];
  }
  return [
    `  Now: ${delivery.stylesheets === 'single' ? 'one stylesheet' : `split, ${delivery.sheets.length} files`} (${delivery.sheets.join(', ')}); the output looks like ${delivery.host === 'vite' ? 'a Vite build' : delivery.host === 'next' ? 'a Next build' : 'neither a Vite nor a Next build'}`,
    `  Split costs: ${savingText(delivery.splitCost)}`,
    delivery.removal === null
      ? `  Removal keeps every component: ${delivery.removalKept}`
      : `  Removal: ${delivery.removal.components} of ${components} components no output file includes, counted from what the bundle ships, not from the source's renders; saves ${savingText(delivery.removal.saving)}`,
    ...(delivery.unread.length > 0
      ? [
          `  Not read as text, so left out of the removal estimate: ${delivery.unread.slice(0, 5).join(', ')}${delivery.unread.length > 5 ? `, +${delivery.unread.length - 5} more` : ''}; a Vite build keeps every component if they are part of its output`,
        ]
      : []),
    `  Verdict: ${delivery.verdict}`,
    '  Preconditions:',
    ...delivery.preconditions.map((line) => `    - ${line}`),
  ];
}

function countBy(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([value, n]) => `${value} ${n}`).join(', ');
}
