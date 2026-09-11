// The canonical typescript@7 toolchain ships no JS compiler API, so the AST
// surface is oxc-parser: a TS-ESTree tree with trivia-exclusive spans.

import { parseSync } from 'oxc-parser';

/** A value at a node field: a child, a list with `null` holes, or a leaf. */
export type NodeField =
  | Node
  | NodeField[]
  | string
  | number
  | boolean
  | null
  | undefined;

/**
 * Structural view of an oxc ESTree node. oxc supplies no `parent`; a pass that
 * needs one wires it onto the non-enumerable slot after parse.
 */
export type Node = {
  type: string;
  start: number;
  end: number;
  parent?: Node;
  // Read through the typed readers below, never directly.
  [key: string]: NodeField;
};

// Representation tag, not `typeof`: `typeof` admits arrays and null as objects.
function tagOf<Value>(value: Value): string {
  return Object.prototype.toString.call(value);
}

type FieldRecord = { [key: string]: NodeField };

function isFieldRecord<Value>(value: Value): value is Value & FieldRecord {
  return tagOf(value) === '[object Object]';
}

export function isNode<Value>(value: Value): value is Value & Node {
  return (
    isFieldRecord(value) &&
    tagOf(value.type) === '[object String]' &&
    tagOf(value.start) === '[object Number]'
  );
}

export function childNode(node: Node, key: string): Node | undefined {
  const field = node[key];
  return isNode(field) ? field : undefined;
}

/**
 * The child list at `key` with positions preserved: holes and non-node entries
 * read back as `null`, so an index into the result indexes the source list.
 */
export function childNodeSlots(node: Node, key: string): (Node | null)[] {
  const field = node[key];
  if (!Array.isArray(field)) return [];
  return field.map((element) => (isNode(element) ? element : null));
}

/** The child list at `key` with holes dropped. */
export function childNodeList(node: Node, key: string): Node[] {
  return childNodeSlots(node, key).filter(
    (element): element is Node => element !== null
  );
}

function isFieldString<Value>(value: Value): value is Value & string {
  return tagOf(value) === '[object String]';
}

export function stringField(node: Node, key: string): string | undefined {
  const field = node[key];
  return isFieldString(field) ? field : undefined;
}

/**
 * The identifier name bound at `key`. `undefined` when the position holds a
 * `Literal` instead — `export { x as "s" }` binds no name to match on.
 */
export function identifierName(node: Node, key: string): string | undefined {
  const target = childNode(node, key);
  return target === undefined ? undefined : stringField(target, 'name');
}

/** A half-open byte range `[start, end)` into a file's text. */
export interface TextRange {
  start: number;
  end: number;
}

/**
 * oxc deduces the dialect from the extension, but fixtures use non-standard
 * ones (`*.ts.in`), so it is pinned here and defaults to `ts`.
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
 * The only crossing point from oxc's own AST declarations into `Node`.
 */
export function parseProgram(filePath: string, source: string): Node {
  const { program } = parseSync(filePath, source, { lang: langFor(filePath) });
  // Checked, not asserted: an oxc release that stops emitting the
  // discriminators fails here instead of reporting "nothing to clean".
  if (!isNode(program)) {
    throw new TypeError(
      `${filePath}: oxc-parser returned no ESTree program node`
    );
  }
  return program;
}
