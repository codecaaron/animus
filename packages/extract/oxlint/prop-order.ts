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
 * accepted props between them is ordered on its own. A fix
 * is offered only where moving props cannot change what the tag evaluates:
 * every value literal, no comment inside the tag, no repeated prop, and no
 * `as` or `asChild`. A missing, stale or unreadable prop-order file is
 * reported when that changes, and nothing is ordered until it is usable.
 */

import { defineRule } from '@oxlint/plugins';
import { readFileSync, statSync } from 'fs';
import { basename, dirname, join, relative, resolve } from 'path';

import { contentHash, firstChangedFile } from '../pipeline/content-hash';
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

const REFRESH =
  'Run `animus prop-order`, or a dev server with `propOrderFile: true`, to regenerate it; until then no props are ordered.';

const MISSING = `No Animus prop-order file (${ANIMUS_ARTIFACT_DIR}/${PROP_ORDER_ARTIFACT}) was found above this file. Set \`propOrderFile: true\` in the Animus plugin options so every build and dev server writes it, or run \`animus prop-order\`; until then no props are ordered.`;

/** How long a lint process trusts what it last saw of the disk: the
 *  prop-order file's location, and whether its recorded files still match.
 *  A lint run reads the disk once; a long-lived editor process sees edits
 *  within this. */
const RECHECK_MS = 1000;

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
/** Each problem's last report, by kind: a problem is reported again only
 *  when it changes, or after it was resolved. */
const reportedProblems = new Map<string, string>();

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
    ])
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

/** Tag as written → its component's ranks, for the file being linted;
 *  empty where nothing in it can be ordered. A prop its target receives as
 *  written is left out, so it stays where it is, as an unknown prop does:
 *  the target can see the order props are written in. */
function fileRanks(
  node: ESTree.JSXOpeningElement,
  context: Context
): Map<string, Map<string, number>> {
  const ranks = new Map<string, Map<string, number>>();
  const order = orderFor(node, context);
  if (order === null) return ranks;
  const file = posixPath(
    relative(order.root, resolve(context.cwd, context.filename))
  );
  const tags = order.file.tags[file];
  if (tags === undefined) return ranks;
  // The file has changed since the analysis read it, as an editor's buffer
  // does before the next analysis.
  if (contentHash(context.sourceCode.text) !== order.file.files[file]) {
    reportStale(
      order.path,
      `${file} changed since it was written`,
      node,
      context
    );
    return ranks;
  }
  for (const [tag, id] of Object.entries(tags)) {
    const props = order.file.components[id];
    if (props !== undefined) {
      const ordered = props.filter((prop) => prop.forwarded !== true);
      ranks.set(tag, new Map(ordered.map((prop) => [prop.name, prop.rank])));
    }
  }
  return ranks;
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

/** Why a tag's props may not be moved, or null when they may. */
function fixBlocker(
  node: ESTree.JSXOpeningElement,
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
  const nonLiteral = node.attributes.some(
    (attribute) =>
      attribute.type === 'JSXAttribute' && !isLiteralValue(attribute.value)
  );
  return nonLiteral ? 'a non-literal value' : null;
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
      description:
        "Order an Animus component's props by stage, then by the system's registration order.",
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
    let ranksByTag: Map<string, Map<string, number>> | null = null;
    return {
      before() {
        ranksByTag = null;
      },
      JSXOpeningElement(node) {
        const tag = tagText(node.name);
        // A lowercase name renders an element, never a component.
        if (tag === null || (/^[a-z]/.test(tag) && !tag.includes('.'))) return;
        ranksByTag ??= fileRanks(node, context);
        const ranks = ranksByTag.get(tag);
        if (ranks === undefined) return;
        const runs = unorderedRuns(node, ranks);
        if (runs.length === 0) return;
        const expected = runs
          .map((run) => run.ordered.map(({ name }) => name).join(', '))
          .join('; ');
        const message = `Order <${tag}>'s props by stage (variants, states, system, custom), then the system's order: ${expected}.`;
        const blocker = fixBlocker(node, context);
        if (blocker !== null) {
          context.report({
            node,
            message: `${message} Not fixed automatically: the tag has ${blocker}.`,
          });
          return;
        }
        context.report({
          node,
          message,
          fix: (fixer: Fixer) =>
            runs.map((run) =>
              fixer.replaceTextRange(
                [
                  run.written[0].attribute.range[0],
                  run.written[run.written.length - 1].attribute.range[1],
                ],
                orderedText(run, context)
              )
            ),
        });
      },
    };
  },
});
