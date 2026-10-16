/**
 * `animus/prop-order`: orders the props an Animus component tag is written
 * with by stage — variants and compounds, states, system props, custom
 * props — and within a stage by registration order, as the prop-order file
 * an analysis publishes records it. A readability convention: CSS emission
 * does not follow JSX attribute order.
 *
 * Only a tag the analysis resolved to exactly one component is checked, and
 * an attribute the component does not accept, a prop its target receives as
 * written (`data-*`, `aria-*`, a variant or state an `.asComponent()` target
 * is forwarded), or a spread stays where it is: each run of the other
 * accepted props between them is ordered on its own. A fix is offered only
 * where moving props cannot change what the tag evaluates: every value in
 * a run it reorders literal, no comment inside the tag, no repeated prop,
 * and no `as` or `asChild`. A missing, stale or unreadable prop-order file
 * is reported when that changes, and nothing is ordered until it is usable. A
 * file any of the rule's own fixes rewrote still matches the analysis that
 * read it: reordering those props changes nothing the analysis records.
 */

import { defineRule } from '@oxlint/plugins';
import { readFileSync, statSync } from 'fs';
import { basename, dirname, join, relative, resolve } from 'path';

import {
  contentHash,
  fileTextOrNull,
  firstChangedFile,
} from '../pipeline/content-hash';
import {
  decodePropOrderFile,
  posixPath,
  PROP_ORDER_SCHEMA_VERSION,
} from '../session/prop-order';
import {
  ANIMUS_ARTIFACT_DIR,
  PROP_ORDER_ARTIFACT,
  propOrderPath,
} from '../session/session-paths';

import type { PropOrderFile } from '../session/prop-order';
import type { Context, ESTree, Fixer } from '@oxlint/plugins';

/** The order the rule asks for, as its messages name it. */
const PROP_ORDER =
  "Animus's prop order (variants, then states, then system props, then custom props)";

/** How to get a usable file: `animus prop-order` ships only in the CLI
 *  package, which a project that builds through a plugin may not have. */
const REFRESH =
  'Set `propOrderFile: true` in the Animus plugin options so any build or dev server writes it, or run `animus prop-order` from `@animus-ui/cli`; until then no props are ordered.';

const MISSING = `No Animus prop-order file (${ANIMUS_ARTIFACT_DIR}/${PROP_ORDER_ARTIFACT}) was found above this file. ${REFRESH}`;

/** How long a lint process trusts what it last saw of the disk: the
 *  prop-order file's location, and whether its recorded files still match.
 *  A long-lived editor process sees edits within this; a long `--fix` run
 *  rechecks while it writes its fixes. */
const RECHECK_MS = 1000;

/** How often, and how far apart, a file this process fixed is read again
 *  before it counts as changed: Oxlint empties a file before it writes the
 *  fixes, and a read can land in between. */
const SETTLE_READS = 5;
const SETTLE_MS = 5;
const settleClock = new Int32Array(new SharedArrayBuffer(4));

/** A prop-order file whose recorded files all still match the disk. */
interface FreshOrder {
  path: string;
  /** The directory the file's paths are relative to. */
  root: string;
  file: PropOrderFile;
}

/** A prop-order file as read: usable, or why it is not. */
type ReadOrder = { fresh: FreshOrder } | { stale: string };

/** One read of one version of a prop-order file, and its last check. */
interface CachedOrder {
  version: string;
  /** The parsed file, or why it cannot be used whatever the disk holds. */
  file: PropOrderFile | string;
  checkedAt: number;
  read: ReadOrder;
}

/** Where the search from one directory last ended, and when. */
interface LocatedOrder {
  path: string | null;
  checkedAt: number;
}

/** The rule's options, as its schema admits them. */
interface PropOrderOptions {
  orderFile?: string;
}

/** By file path: an editor's long-lived process rereads a file that moved. */
const cachedOrders = new Map<string, CachedOrder>();
/** By directory: the prop-order file found from there, or none. */
const locatedOrders = new Map<string, LocatedOrder>();
/** A range of the source and the text that replaces it. */
type Edit = [range: [number, number], text: string];

/** The text a prop-order file recorded for one path, as this process read
 *  it, and every fix the rule offered on that text. */
interface FixBaseline {
  recorded: string;
  original: string;
  /** By range and text. A fix reorders its range, so keeps its length. */
  fixes: Map<string, Edit>;
  /** The hashes of texts already found to be its fixes. */
  accepted: Set<string>;
  /** The hash of the disk text last found not to be one, until another fix
   *  is kept: a file changed for good is not reread at every recheck. */
  rejected: string | null;
}

/** By path: what lets a run's fixes, any of them, leave the files it has
 *  yet to lint fresh. */
const fixBaselines = new Map<string, FixBaseline>();
/** Each problem's last report, by kind: a problem is reported again only
 *  when it changes, or after it was resolved. */
const reportedProblems = new Map<string, string>();

/** The fixes kept for `path`, where they are fixes of its recorded text. */
function baselineOf(path: string, recorded: string): FixBaseline | undefined {
  const baseline = fixBaselines.get(path);
  return baseline?.recorded === recorded ? baseline : undefined;
}

/** `text`, which hashes to `hash`, is the baseline's text with some of its
 *  fixes applied, each where it was offered: what Oxlint writes when a
 *  directive suppresses a fix, or an editor applies one. */
function isOwnFix(baseline: FixBaseline, text: string, hash: string): boolean {
  const { original, fixes, accepted } = baseline;
  if (text.length !== original.length) return false;
  if (accepted.has(hash)) return true;
  // The texts align, as each fix keeps its length. Fixes offered under two
  // orders can share or cross a range, so walk the fixes' bounds from the
  // start: each stretch is crossed as recorded, or by a fix whose text is
  // there.
  const bounds = new Set([0, text.length]);
  const fixedFrom = new Map<number, number[]>();
  for (const [[start, end], replacement] of fixes.values()) {
    bounds.add(start).add(end);
    if (text.slice(start, end) === replacement) {
      fixedFrom.set(start, [...(fixedFrom.get(start) ?? []), end]);
    }
  }
  const points = [...bounds].sort((a, b) => a - b);
  const reached = new Set([0]);
  for (const [index, at] of points.entries()) {
    if (!reached.has(at)) continue;
    const next = points[index + 1];
    if (
      next !== undefined &&
      text.slice(at, next) === original.slice(at, next)
    ) {
      reached.add(next);
    }
    for (const end of fixedFrom.get(at) ?? []) reached.add(end);
  }
  // More fixes only add texts, so one found stays found.
  if (!reached.has(text.length)) return false;
  accepted.add(hash);
  return true;
}

/** The file at `path` on disk, first read as `actual`, still matches. */
function diskMatchesRecorded(
  path: string,
  recorded: string,
  actual: string
): boolean {
  if (actual === recorded) return true;
  const baseline = baselineOf(path, recorded);
  if (baseline === undefined || actual === baseline.rejected) return false;
  if (baseline.accepted.has(actual)) return true;
  for (let read = 1; ; read++) {
    const text = fileTextOrNull(path) ?? '';
    const hash = contentHash(text);
    if (isOwnFix(baseline, text, hash)) return true;
    if (read === SETTLE_READS) {
      baseline.rejected = hash;
      return false;
    }
    Atomics.wait(settleClock, 0, 0, SETTLE_MS);
  }
}

/** The file being linted as it stands, read as the analysis reads it:
 *  Oxlint's source text leaves out a byte order mark. */
const sourceText = (context: Context): string =>
  (context.sourceCode.hasBOM ? '\uFEFF' : '') + context.sourceCode.text;

function reportChanged(
  key: string,
  node: ESTree.JSXOpeningElement,
  context: Context,
  message: string
): void {
  if (reportedProblems.get(key) === message) return;
  reportedProblems.set(key, message);
  context.report({ node, message });
}

function reportStale(
  path: string,
  reason: string,
  node: ESTree.JSXOpeningElement,
  context: Context
): void {
  reportChanged(
    `stale:${path}`,
    node,
    context,
    `The Animus prop-order file ${path} cannot be used: ${reason}. ${REFRESH}`
  );
}

/** The nearest `.animus/prop-order.json` at or above `directory`. */
function locateOrder(directory: string, now: number): string | null {
  const known = locatedOrders.get(directory);
  if (known !== undefined && now - known.checkedAt < RECHECK_MS) {
    return known.path;
  }
  const candidate = propOrderPath(directory);
  const parent = dirname(directory);
  let found: string | null;
  try {
    statSync(candidate);
    found = candidate;
  } catch {
    found = parent === directory ? null : locateOrder(parent, now);
  }
  locatedOrders.set(directory, { path: found, checkedAt: now });
  return found;
}

/** The file at `path` as the rule reads it, or why it cannot be used. */
function parseOrder(path: string): PropOrderFile | string {
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch (error) {
    return `it cannot be read (${String(error)})`;
  }
  const file = decodePropOrderFile(text);
  if (file === null) return 'its contents are not a prop-order file';
  if (file.schemaVersion !== PROP_ORDER_SCHEMA_VERSION) {
    return `another Animus version wrote it (schema ${file.schemaVersion}; this rule reads ${PROP_ORDER_SCHEMA_VERSION})`;
  }
  return file;
}

/** The parsed file, checked against the disk. */
function checkOrder(path: string, file: PropOrderFile | string): ReadOrder {
  if (!(file instanceof Object)) return { stale: file };
  // `<root>/.animus/prop-order.json`
  const root = dirname(dirname(path));
  const changed = firstChangedFile(
    Object.entries(file.files).map(([recorded, hash]) => [
      join(root, recorded),
      hash,
    ]),
    diskMatchesRecorded
  );
  if (changed !== undefined) {
    return {
      stale: `${posixPath(relative(root, changed))} changed since it was written`,
    };
  }
  return { fresh: { path, root, file } };
}

/** The file at `path`, parsed again only when it changed, and checked
 *  against the disk again once `RECHECK_MS` has passed. */
function loadOrder(path: string, now: number): ReadOrder {
  let version: string;
  try {
    const stats = statSync(path);
    version = `${stats.mtimeMs}:${stats.size}`;
  } catch {
    version = 'absent';
  }
  const cached = cachedOrders.get(path);
  if (cached?.version === version && now - cached.checkedAt < RECHECK_MS) {
    return cached.read;
  }
  const file = cached?.version === version ? cached.file : parseOrder(path);
  const read = checkOrder(path, file);
  cachedOrders.set(path, { version, file, checkedAt: now, read });
  return read;
}

/** A configured file read anywhere but `<root>/.animus/prop-order.json`
 *  would take its paths against the wrong directory. */
function misplacedOrderFile(path: string): boolean {
  return (
    basename(path) !== PROP_ORDER_ARTIFACT ||
    basename(dirname(path)) !== ANIMUS_ARTIFACT_DIR
  );
}

/** The prop-order file for the file being linted, or null after
 *  reporting why there is none to use. */
function orderFor(
  node: ESTree.JSXOpeningElement,
  context: Context
): FreshOrder | null {
  const now = Date.now();
  // SAFETY: the rule's schema admits only an object with an optional
  // string `orderFile`, and Oxlint validates options against it.
  const options = (context.options[0] ?? {}) as PropOrderOptions;
  const path =
    options.orderFile === undefined
      ? locateOrder(dirname(resolve(context.cwd, context.filename)), now)
      : resolve(context.cwd, options.orderFile);
  if (path === null) {
    reportChanged('missing', node, context, MISSING);
    return null;
  }
  reportedProblems.delete('missing');
  if (misplacedOrderFile(path)) {
    reportChanged(
      `misplaced:${path}`,
      node,
      context,
      `The \`orderFile\` ${path} is not a ${ANIMUS_ARTIFACT_DIR}/${PROP_ORDER_ARTIFACT}: its paths are relative to the directory that holds ${ANIMUS_ARTIFACT_DIR}, so the rule reads it only there; until then no props are ordered.`
    );
    return null;
  }
  const read = loadOrder(path, now);
  if ('stale' in read) {
    reportStale(path, read.stale, node, context);
    return null;
  }
  reportedProblems.delete(`stale:${path}`);
  return read.fresh;
}

/** The file being linted, as the rule reads it at its first component
 *  tag. */
interface LintedFile {
  /** Tag as written → its component's ranks; empty where nothing in the
   *  file can be ordered. */
  ranks: Map<string, Map<string, number>>;
  /** Its recorded hash, where its text is the recorded one: only fixes
   *  offered on that text are kept, so each is a fix of it. */
  recorded: string | null;
}

/** The file being linted. A prop its target receives as written is left
 *  out of its ranks, so it stays where it is, as an unknown prop does: the
 *  target can see the order props are written in. */
function lintedFile(
  node: ESTree.JSXOpeningElement,
  context: Context
): LintedFile {
  const ranks = new Map<string, Map<string, number>>();
  const unordered = { ranks, recorded: null };
  const order = orderFor(node, context);
  if (order === null) return unordered;
  const path = resolve(context.cwd, context.filename);
  const file = posixPath(relative(order.root, path));
  const tags = order.file.tags[file];
  const recorded = order.file.files[file];
  if (tags === undefined) return unordered;
  const text = sourceText(context);
  const hash = contentHash(text);
  const exact = hash === recorded;
  const baseline =
    exact || recorded === undefined ? undefined : baselineOf(path, recorded);
  // The file has changed since the analysis read it, as an editor's buffer
  // does before the next analysis.
  if (!exact && (baseline === undefined || !isOwnFix(baseline, text, hash))) {
    reportStale(
      order.path,
      `${file} changed since it was written`,
      node,
      context
    );
    return unordered;
  }
  for (const [tag, id] of Object.entries(tags)) {
    const props = order.file.components[id];
    if (props !== undefined) {
      const ordered = props.filter((prop) => prop.forwarded !== true);
      ranks.set(tag, new Map(ordered.map((prop) => [prop.name, prop.rank])));
    }
  }
  return { ranks, recorded: exact ? hash : null };
}

/** Keeps `fixes`, offered on the linted file's recorded text, as its own. */
function keepFixes(
  recorded: string,
  fixes: readonly Edit[],
  context: Context
): void {
  const path = resolve(context.cwd, context.filename);
  let baseline = baselineOf(path, recorded);
  if (baseline === undefined) {
    baseline = {
      recorded,
      original: sourceText(context),
      fixes: new Map(),
      accepted: new Set(),
      rejected: null,
    };
    fixBaselines.set(path, baseline);
  }
  baseline.rejected = null;
  // The baseline holds the byte order mark the fixes' ranges leave out.
  const shift = context.sourceCode.hasBOM ? 1 : 0;
  for (const [[start, end], replacement] of fixes) {
    const range: [number, number] = [start + shift, end + shift];
    baseline.fixes.set(`${range}:${replacement}`, [range, replacement]);
  }
}

/** The tag as written (`Box`, `ui.Box`, `Card.Body`); null for a namespaced
 *  name, which no component is. */
function tagText(name: ESTree.JSXElementName): string | null {
  if (name.type === 'JSXIdentifier') return name.name;
  if (name.type === 'JSXNamespacedName') return null;
  const object = tagText(name.object);
  return object === null ? null : `${object}.${name.property.name}`;
}

function attributeName(attribute: ESTree.JSXAttributeItem): string | null {
  return attribute.type === 'JSXAttribute' &&
    attribute.name.type === 'JSXIdentifier'
    ? attribute.name.name
    : null;
}

/** A value whose evaluation nothing can observe or reorder. */
function isLiteralValue(value: ESTree.JSXAttributeValue | null): boolean {
  if (value === null || value.type === 'Literal') return true;
  if (value.type !== 'JSXExpressionContainer') return false;
  const expression = value.expression;
  if (expression.type === 'Literal') return true;
  if (expression.type === 'TemplateLiteral') {
    return expression.expressions.length === 0;
  }
  // `-1`, `+1`: a sign on a number literal. Coercing anything else, a
  // RegExp's `Symbol.toPrimitive` for one, can run user code.
  return (
    expression.type === 'UnaryExpression' &&
    (expression.operator === '-' || expression.operator === '+') &&
    expression.argument.type === 'Literal' &&
    Number.isFinite(expression.argument.value)
  );
}

/** Why a tag's `runs` may not be reordered, or null when they may. */
function fixBlocker(
  node: ESTree.JSXOpeningElement,
  runs: readonly Run[],
  context: Context
): string | null {
  if (context.sourceCode.getCommentsInside(node).length > 0) {
    return 'a comment';
  }
  const names = node.attributes.map(attributeName);
  if (names.includes('as')) return '`as`';
  if (names.includes('asChild')) return '`asChild`';
  const written = names.filter((name) => name !== null);
  if (new Set(written).size !== written.length) return 'a repeated prop';
  // Moving a value past another expression can change the order they
  // evaluate in, so any non-literal in a run the fix reorders blocks it; one
  // that stays put, or sits in a run already in order, cannot.
  const moving = runs.some((run) =>
    run.written.some(({ attribute }) => !isLiteralValue(attribute.value))
  );
  return moving
    ? 'a non-literal value among the props the fix would move'
    : null;
}

/** One accepted prop as written. */
interface WrittenProp {
  attribute: ESTree.JSXAttribute;
  name: string;
}

/** A run of accepted props, as written and in order. */
interface Run {
  written: WrittenProp[];
  ordered: WrittenProp[];
}

/** The runs of accepted props between the attributes that stay put that
 *  are written out of order. */
function unorderedRuns(
  node: ESTree.JSXOpeningElement,
  ranks: Map<string, number>
): Run[] {
  const runs: WrittenProp[][] = [[]];
  for (const attribute of node.attributes) {
    const name = attributeName(attribute);
    if (attribute.type === 'JSXAttribute' && name !== null && ranks.has(name)) {
      runs[runs.length - 1].push({ attribute, name });
    } else {
      runs.push([]);
    }
  }
  const rank = (name: string): number => ranks.get(name) ?? 0;
  return runs
    .map((written) => ({
      written,
      ordered: written.toSorted((a, b) => rank(a.name) - rank(b.name)),
    }))
    .filter(({ written, ordered }) =>
      ordered.some((prop, index) => prop !== written[index])
    );
}

/** The run rewritten in order, each gap between attributes kept where it
 *  was. */
function orderedText(run: Run, context: Context): string {
  const { written, ordered } = run;
  const text = context.sourceCode.text;
  return ordered
    .map(({ attribute }, index) => {
      const gap =
        index + 1 < written.length
          ? text.slice(
              written[index].attribute.range[1],
              written[index + 1].attribute.range[0]
            )
          : '';
      return context.sourceCode.getText(attribute) + gap;
    })
    .join('');
}

export const propOrderRule = defineRule({
  meta: {
    type: 'layout',
    fixable: 'code',
    docs: {
      description: `Order an Animus component's props in ${PROP_ORDER}.`,
    },
    schema: [
      {
        type: 'object',
        properties: { orderFile: { type: 'string' } },
        additionalProperties: false,
      },
    ],
  },
  createOnce(context) {
    /** Per file, resolved at its first component tag. */
    let linted: LintedFile | null = null;
    return {
      before() {
        linted = null;
      },
      JSXOpeningElement(node) {
        const tag = tagText(node.name);
        // A lowercase name renders an element, never a component.
        if (tag === null || (/^[a-z]/.test(tag) && !tag.includes('.'))) return;
        linted ??= lintedFile(node, context);
        const ranks = linted.ranks.get(tag);
        if (ranks === undefined) return;
        const runs = unorderedRuns(node, ranks);
        if (runs.length === 0) return;
        const expected = runs
          .map((run) => run.ordered.map(({ name }) => name).join(', '))
          .join('; ');
        const message = `Order <${tag}>'s props in ${PROP_ORDER}: ${expected}.`;
        const blocker = fixBlocker(node, runs, context);
        if (blocker !== null) {
          context.report({
            node,
            message: `${message} Not fixed automatically: the tag has ${blocker}.`,
          });
          return;
        }
        const fixes = runs.map((run): Edit => [
          [
            run.written[0].attribute.range[0],
            run.written[run.written.length - 1].attribute.range[1],
          ],
          orderedText(run, context),
        ]);
        if (linted.recorded !== null) {
          keepFixes(linted.recorded, fixes, context);
        }
        context.report({
          node,
          message,
          fix: (fixer: Fixer) =>
            fixes.map(([range, text]) => fixer.replaceTextRange(range, text)),
        });
      },
    };
  },
});
