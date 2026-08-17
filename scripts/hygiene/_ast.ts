// scripts/hygiene/_ast.ts
//
// Shared oxc-parser view used by the two hygiene passes that walk source
// ASTs: `delete-unused.ts` (Layer C, intra-file dead declarations) and
// `reconcile-after-knip.ts` (Layer D1, stale barrel re-exports).
//
// oxc-parser replaces the former `typescript5` alias: the canonical toolchain
// (typescript@7, native) ships no JS compiler API, and these layers need an
// in-process AST surface. oxc-parser emits a TS-ESTree AST (`parseSync` →
// `{ program, errors, comments }`) with trivia-exclusive `start`/`end` spans.
//
// This module owns the whole re-view: the `Node`/`NodeField` vocabulary, the
// single boundary where oxc's own AST types become that vocabulary
// (`parseProgram`), and the field readers every pass navigates with. Both
// passes reach across syntax kinds by field name (`declarations`, `properties`,
// `specifiers`, `source`), which is why the view is structural rather than a
// restatement of oxc's node unions — but "structural" stops at the readers
// below. Nothing outside this file dereferences a raw field.

import { parseSync } from 'oxc-parser';

/**
 * Every value reachable from an oxc ESTree node field: a child node, a list of
 * fields (ESTree array positions may be `null` holes), or one of the scalar
 * leaves the AST carries (names, operators, flags, span numbers, `null`).
 * Naming the closed set is what lets the readers below decide about a field
 * instead of dereferencing it on faith.
 */
export type NodeField =
  | Node
  | NodeField[]
  | string
  | number
  | boolean
  | null
  | undefined;

/**
 * Minimal structural view of an oxc ESTree node. oxc nodes carry no `parent`
 * back-link (unlike the TS AST); passes that need one wire it themselves onto
 * a non-enumerable `parent` slot after parse.
 */
export type Node = {
  type: string;
  start: number;
  end: number;
  parent?: Node;
  // Children are navigated structurally; the index signature keeps that
  // ergonomic without enumerating every ESTree field. Read it through the
  // typed readers below, never directly.
  [key: string]: NodeField;
};

// Representation tag. `Object.prototype.toString` is how this file decides a
// field's shape — the same tag-based decision the repo's shared JSON
// vocabulary (`@animus-ui/assertions`) makes for a decoded document, and for
// the same reason: the AST arrives from a foreign decoder, so a value is
// classified once, here, rather than narrowed at every read site.
//
// The guards below are universally quantified over their subject because they
// answer the same question for two populations: a field read out of the
// structural view (`NodeField`), and oxc's own program object at the parse
// boundary, whose declared type this module deliberately does not restate.
function tagOf<Value>(value: Value): string {
  return Object.prototype.toString.call(value);
}

// A plain keyed record of node fields — the only shape that carries fields at
// all. Lists, scalars and holes are excluded by their own tags.
type FieldRecord = { [key: string]: NodeField };

function isFieldRecord<Value>(value: Value): value is Value & FieldRecord {
  return tagOf(value) === '[object Object]';
}

/**
 * True when `value` is an oxc AST node. The discriminators are the string
 * `type` and numeric `start` every ESTree node carries; they are also what
 * separates a child node from a scalar field (names, flags, regex
 * descriptors, `null` holes) during a structural walk.
 */
export function isNode<Value>(value: Value): value is Value & Node {
  return (
    isFieldRecord(value) &&
    tagOf(value.type) === '[object String]' &&
    tagOf(value.start) === '[object Number]'
  );
}

/** The child node at `key`, or `undefined` when the field is absent or is not a node. */
export function childNode(node: Node, key: string): Node | undefined {
  const field = node[key];
  return isNode(field) ? field : undefined;
}

/**
 * The child list at `key`, positions preserved: an ESTree array hole (`[a, ,
 * c]`) and any non-node entry read back as `null` so an index into the result
 * is an index into the source list.
 */
export function childNodeSlots(node: Node, key: string): (Node | null)[] {
  const field = node[key];
  if (!Array.isArray(field)) return [];
  return field.map((element) => (isNode(element) ? element : null));
}

/** The child list at `key` with holes dropped. Use where the syntax admits none. */
export function childNodeList(node: Node, key: string): Node[] {
  return childNodeSlots(node, key).filter(
    (element): element is Node => element !== null
  );
}

// A string leaf — identifier names, `const`/`let` kinds, literal values.
function isFieldString<Value>(value: Value): value is Value & string {
  return tagOf(value) === '[object String]';
}

/** The string field at `key`, or `undefined` when absent or not a string. */
export function stringField(node: Node, key: string): string | undefined {
  const field = node[key];
  return isFieldString(field) ? field : undefined;
}

/**
 * The identifier name bound at `key` — `node[key].name`. `undefined` when the
 * field is absent or is not an Identifier: ESTree puts a `Literal` in several
 * name positions (`export { x as "s" }`, ES2022 arbitrary module-export
 * names), and such an element carries no binding name for a pass to match on.
 */
export function identifierName(node: Node, key: string): string | undefined {
  const target = childNode(node, key);
  return target === undefined ? undefined : stringField(target, 'name');
}

/**
 * A half-open byte range `[start, end)` into a file's text. Every deletion the
 * hygiene passes compute is one of these, and the splice loops that apply them
 * sort and overlap-test on the same two fields.
 */
export interface TextRange {
  start: number;
  end: number;
}

/**
 * oxc deduces the dialect from the filename extension. Hygiene only ever sees
 * TypeScript, and test fixtures use non-standard extensions (`*.ts.in`), so
 * the dialect is passed explicitly: JSX-bearing files by extension,
 * everything else as `ts`. This guarantees TS syntax (overload signatures,
 * `namespace`, type annotations) parses regardless of the on-disk extension.
 *
 * `parseProgram` is the only caller — the dialect pin is not a decision a pass
 * gets to make separately. (`scripts/verify/topology.ts` documents this
 * function as the precedent for its own `langForParser`, but reaches nothing
 * across the two script trees.)
 */
function langFor(filename: string): 'ts' | 'tsx' | 'js' | 'jsx' {
  if (filename.endsWith('.tsx')) return 'tsx';
  if (filename.endsWith('.jsx')) return 'jsx';
  if (
    filename.endsWith('.js') ||
    filename.endsWith('.mjs') ||
    filename.endsWith('.cjs')
  ) {
    return 'js';
  }
  return 'ts';
}

/**
 * Parse `source` under the dialect its filename implies and hand back the
 * program as this module's structural view. The single crossing point from
 * oxc's own AST declarations into `Node`.
 */
export function parseProgram(filePath: string, source: string): Node {
  const { program } = parseSync(filePath, source, { lang: langFor(filePath) });
  // The crossing is a checked one, not an asserted one: `isNode` decides the
  // two discriminators on the real value, so an oxc release that stops
  // emitting them fails loud here instead of letting a pass walk an empty tree
  // and report "nothing to clean".
  if (!isNode(program)) {
    throw new TypeError(
      `${filePath}: oxc-parser returned no ESTree program node`
    );
  }
  return program;
}
