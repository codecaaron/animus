import {
  classStem,
  outputEvidence,
  removeComponentRules,
  shippedClasses,
  slotReasons,
  splitStylesheet,
  STYLESHEET_SLICES,
  unbundledComponents,
} from '@animus-ui/extract/pipeline';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { UsageFailure } from './build';
import {
  brotliSize,
  eachStyleRule,
  gzipSize,
  parseSheet,
  withoutSelectors,
} from './css-sheet';

import type { Sheet, SheetNode, SheetSelector, Sizes } from './css-sheet';
import type {
  ExtractFileFacts,
  FullProjectManifest,
  ManifestComponentDescriptor,
  OutputFile,
  SlotOpening,
} from '@animus-ui/extract/pipeline';

type StyleRule = Extract<SheetNode, { type: 'style' }>;

/** Bytes a change saves, each file compressed on its own; negative where
 *  it costs bytes. A compressed size is `null` where it was not measured:
 *  gzip where the raw saving stays under the floor, Brotli where the gzip
 *  saving does or the finding ranks too low to measure. */
export interface Saving {
  raw: number;
  gzip: number | null;
  brotli: number | null;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface DeliveryReport {
  /** How the shipped CSS is delivered now: Animus's layers in one file, or
   *  cut into slices. */
  stylesheets: 'single' | 'split';
  /** The files holding Animus's layers. */
  sheets: string[];
  /** What a split costs over one file: positive is bytes added. */
  splitCost: Saving;
  /** What `removeUnbundledComponents` would remove from the (split) CSS
   *  now; `null` where removal must keep every component. */
  removal: {
    components: number;
    saving: Saving;
  } | null;
  removalKept: string | null;
  /** Removal's saving less the split's cost, where the CSS is single now;
   *  removal's saving where it is split already. */
  net: Saving;
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
  /** What the slot rules of the props it keeps weigh: what closing it
   *  saves once nothing else keeps them. */
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
  belowFloor: boolean;
}

export interface Refusal {
  kind: RestructureKind;
  title: string;
  components: string[];
  rule: string;
}

export interface CssAuditReport {
  manifest: string;
  dist: string;
  css: { files: number; sizes: Sizes };
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

/** Owners listed per slot group, and sites per owner. */
const OWNERS_SHOWN = 5;
const SITES_PER_OWNER = 2;

// ---------------------------------------------------------------- input

interface UsageAttr {
  name: string;
  staticValue?: string | number | boolean | null;
  enumerableValues?: Array<string | number | boolean | null>;
  dynamic: boolean;
  skip: boolean;
}

interface UsageFact {
  element?: { tag: { ident?: string; member?: string }; attrs: UsageAttr[] };
  createElement?: { ident: string | null; member: string | null };
}

interface DistFile {
  file: string;
  bytes: Buffer;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function readManifest(path: string): FullProjectManifest {
  let parsed: FullProjectManifest;
  try {
    // SAFETY: the sections read below are checked before use; anything
    // else in the file is read only through them.
    parsed = JSON.parse(readFileSync(path, 'utf8')) as FullProjectManifest;
  } catch (error) {
    throw new UsageFailure(
      `css audit: cannot read the manifest ${path}: ${String(error)}`
    );
  }
  const missing = (
    ['components', 'component_fragments', 'fileFacts', 'report'] as const
  ).filter((section) => (parsed?.[section] ?? null) === null);
  if (missing.length > 0) {
    throw new UsageFailure(
      `css audit: ${path} is not a full manifest (no ${missing.join(', ')}); write one with \`animus build --verbose\``
    );
  }
  return parsed;
}

function readDist(dir: string): DistFile[] {
  let files: string[];
  try {
    files = walk(dir);
  } catch (error) {
    throw new UsageFailure(
      `css audit: cannot read the built output ${dir}: ${String(error)}`
    );
  }
  const read = files.map((path) => ({
    file: relative(dir, path),
    bytes: readFileSync(path),
  }));
  if (!read.some(({ file }) => file.endsWith('.css'))) {
    throw new UsageFailure(`css audit: ${dir} holds no .css file`);
  }
  return read;
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

  /** The edit that drops the selectors `drop` picks from every file. */
  without(drop: (selector: SheetSelector, rule: StyleRule) => boolean): Edit {
    const edit: Edit = { before: [], after: [] };
    for (const [file, css] of this.files) {
      const edited = withoutSelectors(this.sheet(file), drop);
      if (edited === null) continue;
      edit.before.push(css);
      edit.after.push(edited);
    }
    return edit;
  }
}

/** A declaration's property name. */
const propertyOf = (declaration: string): string =>
  declaration.slice(0, declaration.indexOf(':')).trim();

// --------------------------------------------------------------- sites

interface Site {
  file: string;
  attrs: UsageAttr[] | null;
  /** Matched by binding name, not by the engine's tag table. */
  byName: boolean;
}

/** Each component's JSX sites: by the engine's tag table where the manifest
 *  carries it, else by binding name. A `createElement` site has no attrs
 *  the audit can read. */
interface ComponentSites {
  sites: Map<string, Site[]>;
  evidence: 'component-id' | 'binding-name';
}

function componentSites(manifest: FullProjectManifest): ComponentSites {
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
  const add = (id: string, site: Site) => {
    const list = sites.get(id) ?? [];
    list.push(site);
    sites.set(id, list);
  };
  for (const [file, facts] of Object.entries(manifest.fileFacts)) {
    // SAFETY: `usage` is on the engine's per-file facts wire, which
    // `ExtractFileFacts` transcribes only in part.
    const usage = (facts as ExtractFileFacts & { usage?: UsageFact[] }).usage;
    for (const fact of usage ?? []) {
      const tag = fact.element
        ? (fact.element.tag.ident ?? fact.element.tag.member)
        : (fact.createElement?.ident ?? fact.createElement?.member);
      if (!tag || /^[a-z][^.]*$/.test(tag)) continue;
      const attrs = fact.element?.attrs ?? null;
      const resolved =
        tables?.[file]?.[tag] ??
        manifest.crossFile?.memberBindings?.[file]?.[tag];
      if (resolved !== undefined) {
        add(resolved, { file, attrs, byName: false });
        continue;
      }
      for (const id of byBinding.get(tag) ?? []) {
        add(id, { file, attrs, byName: true });
      }
    }
  }
  return { sites, evidence };
}

const coApplies = (site: Site): boolean =>
  site.attrs?.some(
    (attr) => attr.name === 'className' || attr.name === 'asChild'
  ) ?? false;

// ------------------------------------------------------------ delivery

async function deliveryReport(
  manifest: FullProjectManifest,
  measured: Measured,
  dist: DistFile[]
): Promise<DeliveryReport> {
  const sheets = [...measured.files.keys()].filter((file) =>
    /@layer\s+anm-[\w-]+\s*\{/.test(measured.files.get(file)!)
  );
  const single = sheets.length === 1;
  const texts = sheets.map((file) => measured.files.get(file)!);
  // A split cuts Animus's stylesheet into its slices, and the app's own CSS
  // the one file also held ships as a file of its own; a split sheet is
  // measured against its slices joined in link order.
  const slices = single
    ? sheets.flatMap((file) => {
        const css = measured.files.get(file)!;
        const [start, end] = animusRegion(measured.sheet(file));
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
    dist.map(({ file, bytes }): OutputFile => ({ fileName: file, bytes })),
    new Set(sheets)
  );
  let removalEdit: { components: number; edit: Edit } | null = null;
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
      ? { components: removalEdit.components, saving: removalSaving }
      : null;
  const net = single
    ? subtract(removal?.saving ?? zero(), splitCost)
    : (removal?.saving ?? zero());
  return {
    stylesheets: single ? 'single' : 'split',
    sheets,
    splitCost,
    removal,
    removalKept:
      unreadable === null
        ? null
        : `${unreadable} holds data the scan cannot read as text, which may name a class`,
    net,
    verdict: deliveryVerdict(single, splitCost, removal, net),
    preconditions,
  };
}

/**
 * Where Animus's stylesheet sits in a file that also holds the app's own
 * CSS: from its theme variables, the first top-level `:root` rule declaring
 * a custom property its layers read (else its first `@property` or
 * `@layer anm-…` block), to the end of its last `@layer anm-…` block.
 */
function animusRegion(sheet: Sheet): [number, number] {
  const top = sheet.rules;
  const layers = top.filter(
    (node) =>
      node.type === 'at' && node.name === 'layer' && /^anm-/.test(node.prelude)
  );
  if (layers.length === 0) return [0, sheet.css.length];
  const first = layers[0]!;
  const end = layers[layers.length - 1]!.end;
  const read = new Set(
    [...sheet.css.slice(first.start, end).matchAll(/var\(\s*(--[\w-]+)/g)].map(
      (match) => match[1]!
    )
  );
  const marker = top.find(
    (node) => node === first || (node.type === 'at' && node.name === 'property')
  )!;
  const variables = top.find(
    (node) =>
      node.start < marker.start &&
      node.type === 'style' &&
      node.selectors.length === 1 &&
      node.selectors[0]!.text === ':root' &&
      node.declarations.some((declaration) => read.has(propertyOf(declaration)))
  );
  return [(variables ?? marker).start, end];
}

/** Where a split file goes in link order: the slice most of it is, as
 *  `splitStylesheet` cuts it. */
function sliceRank(css: string): number {
  const sizes = splitStylesheet(css).map(({ css: slice }) => slice.length);
  return STYLESHEET_SLICES.findIndex(
    (_, index) => sizes[index] === Math.max(...sizes)
  );
}

function deliveryVerdict(
  single: boolean,
  splitCost: Saving,
  removal: DeliveryReport['removal'],
  net: Saving
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
    return saved > 0
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
  // A slot's rules name its class, or the class with a suffix after a `-`
  // (`{slot}-md`, `{slot}--keep-md`).
  const dropProps = (props: Iterable<string>): Promise<Saving> => {
    const classes = new Set(
      [...props].flatMap(
        (prop) => manifest.dynamic_props[prop]?.slotClass ?? []
      )
    );
    if (classes.size === 0) return Promise.resolve(zero());
    return measured.saving(
      measured.without((selector) =>
        selector.classes.some(
          (name) =>
            classes.has(name) ||
            [...name.matchAll(/-/g)].some(({ index }) =>
              classes.has(name.slice(0, index))
            )
        )
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
    ...[...rules.values()].map(({ props }) => dropProps(props)),
  ]);
  const groups = [...rules]
    .map(([rule, { props, only, owners }], index): SlotGroup => ({
      rule,
      props: props.size,
      only: only.size,
      saving: savings[index]!,
      owners: [...owners]
        .map(([owner, held]) => ({
          component: manifest.components[owner]?.binding ?? owner,
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

/** Where a slot opening applies: `file:line (detail)`. */
const placeOf = (opening: SlotOpening): string =>
  `${opening.file}${opening.line !== undefined ? `:${opening.line}` : ''}${opening.detail ? ` (${opening.detail})` : ''}`;

// --------------------------------------------------------- restructures

interface Candidate {
  finding: Omit<Restructure, 'saving' | 'belowFloor'>;
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

/** The variant axes of a component's runtime record, each with its
 *  options (from the record, or the cross-file facts where the record
 *  does not list them) and its default. */
function variantsOf(
  manifest: FullProjectManifest,
  component: ManifestComponentDescriptor
): Map<string, { options: string[]; default: string | null }> {
  const axes = new Map<string, { options: string[]; default: string | null }>();
  const key = '"variants":';
  const at = component.replacement.indexOf(key);
  const text =
    at < 0 ? null : jsonValueAt(component.replacement, at + key.length);
  if (text === null) return axes;
  let variants: Record<string, { options?: string[]; default?: string }>;
  try {
    // SAFETY: the record's variants object is JSON of this shape.
    variants = JSON.parse(text) as typeof variants;
  } catch {
    return axes;
  }
  const listed = manifest.crossFile?.variantOptions?.[component.binding] ?? {};
  for (const [axis, config] of Object.entries(variants)) {
    axes.set(axis, {
      options: config.options ?? listed[axis] ?? [],
      default: config.default ?? null,
    });
  }
  return axes;
}

function keptOptions(
  manifest: FullProjectManifest,
  classes: ReadonlySet<string>,
  sites: Map<string, Site[]>,
  refused: Refusal[]
): Candidate[] {
  const candidates: Candidate[] = [];
  const provenance = manifest.slot_provenance;
  for (const [id, component] of Object.entries(manifest.components)) {
    const used = sites.get(id) ?? [];
    const axes = variantsOf(manifest, component);
    if (axes.size === 0 || used.length === 0) continue;
    const kept: Array<{ axis: string; options: string[]; dynamic: number }> =
      [];
    for (const [axis, config] of axes) {
      const literal = new Set<string>();
      let dynamic = 0;
      for (const site of used) {
        const attr = site.attrs?.find(({ name }) => name === axis);
        if (site.attrs === null) dynamic += 1;
        else if (attr === undefined || attr.skip) {
          if (config.default !== null) literal.add(config.default);
        } else if (
          attr.staticValue !== null &&
          attr.staticValue !== undefined
        ) {
          literal.add(String(attr.staticValue));
        } else if (attr.enumerableValues?.length) {
          for (const value of attr.enumerableValues) literal.add(String(value));
          if (attr.dynamic) dynamic += 1;
        } else if (attr.dynamic) dynamic += 1;
      }
      if (dynamic === 0) continue;
      const options = config.options.filter(
        (option) =>
          !literal.has(option) &&
          option !== config.default &&
          classes.has(`${component.class_name}--${axis}-${option}`)
      );
      if (options.length > 0) kept.push({ axis, options, dynamic });
    }
    if (kept.length === 0) continue;
    const listed = kept
      .map(({ axis, options }) => `${axis}: ${options.join(', ')}`)
      .join('; ');
    const title = `${component.binding}: ${kept.reduce((n, { options }) => n + options.length, 0)} options with no literal use, kept by ${kept.reduce((n, { dynamic }) => n + dynamic, 0)} dynamic sites (${listed})`;
    const unproven = provenance?.owners[id] ?? [];
    const unseen = unproven.filter(
      ({ rule }) => rule === 'spread' || rule === 'create-element'
    );
    if (component.terminal === 'asClass') {
      refused.push({
        kind: 'kept-options',
        title,
        components: [id],
        rule: 'a class resolver: its uses are calls the audit does not read',
      });
      continue;
    }
    if (unseen.length > 0 || used.some((site) => site.attrs === null)) {
      refused.push({
        kind: 'kept-options',
        title,
        components: [id],
        rule: 'a site spreads props or calls createElement, so it may pass any option',
      });
      continue;
    }
    const caveats: string[] = [];
    const hidden = unproven.filter(
      ({ rule }) => rule !== 'not-module-confined'
    );
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
        suggestion:
          'At each dynamic site, narrow the value to literals the engine can enumerate (a ternary of literals, a lookup object), or delete the options the app never reaches.',
        confidence: confidenceOf(caveats, hidden.length > 0),
        caveats,
      },
      drop: (selector) => selector.classes.some((name) => dropped.has(name)),
    });
  }
  return candidates;
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
        ? `${leaf.binding} is ${parent.binding} with ${changed.join(', ')}`
        : `${leaf.binding} is a copy of ${parent.binding} under its own class`;
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
    const name = leaf.class_name;
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
        selector.classes.some((needed) => classStem(needed) === name),
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
  for (const { declarations, members } of groups.values()) {
    if (members.length < 2) continue;
    const blockProps = new Set(declarations.map(propertyOf));
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
            other.props.some((prop) => blockProps.has(prop))
        )
      ) {
        note("sets one of the block's properties in another rule", id);
      } else {
        kept.push(id);
      }
    }
    const names = (ids: string[]) =>
      ids.map((id) => manifest.components[id]!.binding);
    const title = (ids: string[]) =>
      `${ids.length} components repeat the base block ${truncate(block, 90)} (${truncate(names(ids).join(', '), 120)})`;
    for (const [reason, ids] of reasons) {
      refused.push({
        kind: 'repeated-base-block',
        title: `${truncate(names(ids).join(', '), 120)}, of ${members.length} components repeating the base block ${truncate(block, 90)}`,
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
          'Share it: one layout component whose base is the block, and each member written as `system.styles(rest)…asComponent(Layout)` with the rest of its styles. Each member sets none of the block’s properties anywhere else, so moving them is cascade-safe.',
        confidence: confidenceOf(caveats, tags.size > 1),
        caveats,
      },
      drop: (selector, rule) =>
        rules.has(rule) && shared.has(selector.text.slice(1)),
    });
  }
  return candidates;
}

function truncate(text: string, length: number): string {
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
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
      if ((saving.gzip ?? 0) >= floor && count < BROTLI_PER_KIND) {
        perKind.set(kind, count + 1);
        final = await measured.saving(
          measured.without(candidate.drop),
          'brotli'
        );
      }
      const deepest = final.brotli ?? final.gzip ?? final.raw;
      return {
        ...candidate.finding,
        saving: final,
        belowFloor: deepest < floor,
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

// --------------------------------------------------------------- audit

export interface CssAuditOptions {
  manifest: string;
  dist: string;
}

/** Reads a build's full manifest and its built output, and measures what
 *  each finding would save. Writes nothing. */
export async function runCssAudit(
  options: CssAuditOptions
): Promise<CssAuditReport> {
  const manifest = readManifest(options.manifest);
  const dist = readDist(options.dist);
  const measured = new Measured(
    new Map(
      dist
        .filter(({ file }) => file.endsWith('.css'))
        .map(({ file, bytes }) => [file, bytes.toString('utf8')])
    )
  );
  const total = await measured.sizes([...measured.files.values()], 'brotli');
  const floor = Math.round(total.brotli! * FLOOR_SHARE);
  const classes = new Set<string>();
  for (const file of measured.files.keys()) {
    eachStyleRule(measured.sheet(file).rules, (rule) => {
      for (const selector of rule.selectors) {
        for (const name of selector.classes) classes.add(name);
      }
    });
  }
  // A component ships where a rule names its class or one derived from it.
  const stems = new Set([...classes].map(classStem));
  const shipped = (className: string) => stems.has(className);
  const { sites, evidence } = componentSites(manifest);
  const refused: Refusal[] = [];
  const candidates = [
    ...keptOptions(manifest, classes, sites, refused),
    ...defaultsOnlyExtensions(manifest, sites, shipped, refused),
    ...repeatedBaseBlocks(manifest, measured, sites, refused),
  ];
  const [delivery, slots, findings] = await Promise.all([
    deliveryReport(manifest, measured, dist),
    slotReport(manifest, measured),
    measureCandidates(candidates, measured, floor),
  ]);
  return {
    manifest: options.manifest,
    dist: options.dist,
    css: {
      files: measured.files.size,
      sizes: { raw: total.raw, gzip: total.gzip!, brotli: total.brotli! },
    },
    components: Object.keys(manifest.components).length,
    delivery,
    slots,
    restructures: { floor, findings, refused, siteEvidence: evidence },
  };
}

// -------------------------------------------------------------- report

const zero = (): Saving => ({ raw: 0, gzip: 0, brotli: 0 });

const subtract = (a: Saving, b: Saving): Saving => ({
  raw: a.raw - b.raw,
  gzip: a.gzip === null || b.gzip === null ? null : a.gzip - b.gzip,
  brotli: a.brotli === null || b.brotli === null ? null : a.brotli - b.brotli,
});

const bytes = (n: number): string => `${n.toLocaleString('en-US')} B`;

const savingText = (saving: Saving): string =>
  `br ${saving.brotli ?? 'n/a'} · gz ${saving.gzip ?? 'n/a'} · raw ${saving.raw}`;

export function formatCssAudit(report: CssAuditReport): string {
  const { css, delivery, slots, restructures } = report;
  const lines: string[] = [
    `animus css audit: ${report.dist}`,
    `CSS ${css.files} files: raw ${bytes(css.sizes.raw)}, gzip ${bytes(css.sizes.gzip)}, Brotli ${bytes(css.sizes.brotli)}; ${report.components} components`,
    'Savings are measured: each edits the shipped CSS and recompresses each file alone (gzip -9, Brotli q11 lgwin 22); Brotli ranks them.',
    '',
    '1. Delivery',
    `  Now: ${delivery.stylesheets === 'single' ? 'one stylesheet' : `split, ${delivery.sheets.length} files`} (${delivery.sheets.join(', ')})`,
    `  Split costs: ${savingText(delivery.splitCost)}`,
    delivery.removal === null
      ? `  Removal keeps every component: ${delivery.removalKept}`
      : `  Removal: ${delivery.removal.components} of ${report.components} components no output file includes, saves ${savingText(delivery.removal.saving)}`,
    `  Verdict: ${delivery.verdict}`,
    '  Preconditions:',
    ...delivery.preconditions.map((line) => `    - ${line}`),
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
        `  ${group.rule}: keeps ${group.props} props (${group.only} kept by nothing else), whose slot rules weigh ${savingText(group.saving)}`
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
  const above = restructures.findings.filter((finding) => !finding.belowFloor);
  const below = restructures.findings.filter((finding) => finding.belowFloor);
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
      `  Below the floor: ${below.length} findings, ${bytes(raw)} raw together (${countBy(below.map(({ kind }) => kind))}); the largest:`
    );
    for (const finding of below.slice(0, BELOW_SHOWN)) {
      lines.push(
        `    ${savingText(finding.saving)}  [${finding.kind}] ${finding.confidence}: ${truncate(finding.title, 140)}`
      );
    }
  }
  if (restructures.refused.length > 0) {
    lines.push(`  Refused: ${restructures.refused.length}`);
    const byRule = new Map<string, Refusal[]>();
    for (const refusal of restructures.refused) {
      const key = `${refusal.kind}: ${refusal.rule}`;
      byRule.set(key, [...(byRule.get(key) ?? []), refusal]);
    }
    for (const [rule, list] of byRule) {
      lines.push(
        `    ${rule} (${list.length}), e.g. ${truncate(list[0]!.title, 140)}`
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

function countBy(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([value, n]) => `${value} ${n}`).join(', ');
}
