#!/usr/bin/env bun
// Deletes the dead top-level declarations and destructured parameters that
// oxlint's `--fix-suggestions` leaves behind, reading its JSON diagnostics.

import { readFileSync, writeFileSync } from 'node:fs';

import {
  type Node,
  type NodeField,
  type TextRange,
  childNode,
  childNodeList,
  childNodeSlots,
  identifierName,
  isNode,
  parseProgram,
  stringField,
} from './_ast';
import { emitReceipt } from './_receipts';
import {
  type OxlintDiagnostic,
  ToolReportError,
  classifyUnusedVar,
  decodeOxlintReport,
  readReportInput,
  unwrapCode,
} from './_tool-reports';

const SOURCE = 'Layer C deleter (delete-unused.ts)';

// Direct child nodes in source order. The `parent` link is non-enumerable, so
// it is never revisited as a child and the walk stays acyclic.
function childNodes(node: Node): Node[] {
  const out: Node[] = [];
  for (const value of Object.values<NodeField>(node)) {
    if (isNode(value)) {
      out.push(value);
    } else if (Array.isArray(value)) {
      for (const el of value) if (isNode(el)) out.push(el);
    }
  }
  return out;
}

function assignParents(root: Node): void {
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    for (const child of childNodes(node)) {
      Object.defineProperty(child, 'parent', {
        value: node,
        enumerable: false,
        configurable: true,
        writable: true,
      });
      stack.push(child);
    }
  }
}

// Where a `VariableDeclaration` is a statement, not a `for (…)` initializer.
const STATEMENT_CONTAINERS = new Set([
  'Program',
  'BlockStatement',
  'StaticBlock',
  'TSModuleBlock',
]);

// Widens to the export wrapper so a deletion takes the `export` keyword too.
function rangeNode(node: Node): Node {
  const parent = node.parent;
  if (
    parent &&
    (parent.type === 'ExportNamedDeclaration' ||
      parent.type === 'ExportDefaultDeclaration') &&
    childNode(parent, 'declaration') === node
  ) {
    return parent;
  }
  return node;
}

type Target =
  | { kind: 'top-level'; node: Node }
  | { kind: 'var-stmt-single'; stmt: Node }
  | {
      kind: 'var-decl-of-many';
      decl: Node;
      stmt: Node;
    }
  | { kind: 'binding-element'; elem: Node; pattern: Node };

type NormalizedDiag = {
  code: string; // bare rule name, eslint() wrapper unwrapped
  message: string;
  path: string;
  offset: number; // 0-indexed byte offset
  line: number; // 1-indexed
  column: number; // 1-indexed
};

function findNodeAtOffset(root: Node, offset: number): Node {
  function recurse(node: Node): Node {
    for (const child of childNodes(node)) {
      // Spans are trivia-exclusive.
      if (offset >= child.start && offset < child.end) {
        return recurse(child);
      }
    }
    return node;
  }
  return recurse(root);
}

function resolveTarget(node: Node): Target | undefined {
  let cur: Node | undefined = node;
  while (cur) {
    // A binding element is any element directly inside a destructuring pattern.
    const parent = cur.parent;
    if (
      parent &&
      (parent.type === 'ObjectPattern' || parent.type === 'ArrayPattern')
    ) {
      return { kind: 'binding-element', elem: cur, pattern: parent };
    }
    if (cur.type === 'VariableDeclarator') {
      // In ESTree a declarator's parent is the statement-level declaration.
      const stmt = cur.parent;
      if (
        stmt &&
        stmt.type === 'VariableDeclaration' &&
        stmt.parent &&
        STATEMENT_CONTAINERS.has(stmt.parent.type)
      ) {
        if (childNodeList(stmt, 'declarations').length === 1) {
          return { kind: 'var-stmt-single', stmt };
        }
        return { kind: 'var-decl-of-many', decl: cur, stmt };
      }
    }
    if (
      cur.type === 'FunctionDeclaration' ||
      cur.type === 'ClassDeclaration' ||
      cur.type === 'TSTypeAliasDeclaration' ||
      cur.type === 'TSInterfaceDeclaration' ||
      cur.type === 'TSEnumDeclaration' ||
      cur.type === 'TSModuleDeclaration'
    ) {
      return { kind: 'top-level', node: cur };
    }
    cur = cur.parent;
  }
  return undefined;
}

function expandToLineBounds(text: string, node: Node): TextRange {
  let start = node.start;
  let end = node.end;

  if (text.charAt(end) === '\r' && text.charAt(end + 1) === '\n') end += 2;
  else if (text.charAt(end) === '\n') end += 1;

  const prevNl = text.lastIndexOf('\n', start - 1);
  const lineStart = prevNl + 1;
  if (text.substring(lineStart, start).trim() === '') {
    start = lineStart;
  }

  return { start, end };
}

function rangeForVarDeclOfMany(decl: Node, stmt: Node): TextRange {
  const decls = childNodeList(stmt, 'declarations');
  const idx = decls.indexOf(decl);
  if (idx === -1) return { start: decl.start, end: decl.end };

  if (idx < decls.length - 1) {
    // Not last: sweep to the next declarator, taking the trailing comma.
    return {
      start: decl.start,
      end: decls[idx + 1].start,
    };
  }
  // Last: sweep from the previous declarator, taking the preceding comma.
  const prev = decls[idx - 1];
  return { start: prev.end, end: decl.end };
}

function rangeForBindingElement(elem: Node, pattern: Node): TextRange {
  // ObjectPattern holds `properties`, ArrayPattern `elements` with holes.
  // A hole has no span, so the neighbor search falls through to the other side.
  const elements: Array<Node | null> =
    pattern.type === 'ObjectPattern'
      ? childNodeList(pattern, 'properties')
      : childNodeSlots(pattern, 'elements');
  const idx = elements.indexOf(elem);

  const next = idx >= 0 && idx + 1 < elements.length ? elements[idx + 1] : null;
  if (next !== null) {
    return { start: elem.start, end: next.start };
  }
  const prev = idx > 0 ? elements[idx - 1] : null;
  if (prev !== null) {
    return { start: prev.end, end: elem.end };
  }
  return { start: elem.start, end: elem.end };
}

function findOverloadGroupStart(impl: Node): Node {
  // Oxlint flags only an overload's implementation; deleting it alone orphans
  // the signature-only overloads above it (TS2391), so the group goes together.
  const implName = identifierName(impl, 'id');
  if (childNode(impl, 'body') === undefined || implName === undefined) {
    return impl;
  }
  const parent = impl.parent;
  if (parent === undefined) return impl;
  const statements = childNodeList(parent, 'body');
  const idx = statements.indexOf(impl);
  let groupStart: Node = impl;
  for (let i = idx - 1; i >= 0; i--) {
    const s = statements[i];
    if (
      s.type === 'TSDeclareFunction' &&
      identifierName(s, 'id') === implName
    ) {
      groupStart = s;
    } else {
      break;
    }
  }
  return groupStart;
}

function varDeclKind(stmt: Node): string {
  const kind = stringField(stmt, 'kind');
  if (kind === 'const') return 'const-decl';
  if (kind === 'let') return 'let-decl';
  return 'var-decl';
}

function kindForTarget(target: Target): string {
  switch (target.kind) {
    case 'top-level': {
      const n = target.node;
      if (n.type === 'FunctionDeclaration') return 'function-decl';
      if (n.type === 'ClassDeclaration') return 'class-decl';
      if (n.type === 'TSTypeAliasDeclaration') return 'type-alias';
      if (n.type === 'TSInterfaceDeclaration') return 'interface';
      if (n.type === 'TSEnumDeclaration') return 'enum';
      if (n.type === 'TSModuleDeclaration') return 'namespace';
      return 'top-level';
    }
    case 'var-stmt-single':
      return varDeclKind(target.stmt);
    case 'var-decl-of-many':
      return varDeclKind(target.stmt);
    case 'binding-element':
      return 'destructured-field';
  }
}

function rangeForTarget(text: string, target: Target): TextRange {
  switch (target.kind) {
    case 'top-level': {
      if (target.node.type === 'FunctionDeclaration') {
        const groupStart = findOverloadGroupStart(target.node);
        if (groupStart !== target.node) {
          const groupRange = expandToLineBounds(text, rangeNode(groupStart));
          const implRange = expandToLineBounds(text, rangeNode(target.node));
          return { start: groupRange.start, end: implRange.end };
        }
      }
      return expandToLineBounds(text, rangeNode(target.node));
    }
    case 'var-stmt-single':
      return expandToLineBounds(text, rangeNode(target.stmt));
    case 'var-decl-of-many':
      return rangeForVarDeclOfMany(target.decl, target.stmt);
    case 'binding-element':
      return rangeForBindingElement(target.elem, target.pattern);
  }
}

// Bare rule names; incoming codes arrive wrapped as `eslint(<rule>)`.
const TARGET_CODES = new Set(['no-unused-vars']);

function normalizeDiagnostic(d: OxlintDiagnostic): NormalizedDiag | undefined {
  if (!d.labels || d.labels.length === 0) return undefined;
  const span = d.labels[0].span;
  return {
    code: unwrapCode(d.code),
    message: d.message,
    path: d.filename,
    offset: span.offset,
    line: span.line,
    column: span.column,
  };
}

export function applyDeletions(
  filePath: string,
  source: string,
  diagnostics: OxlintDiagnostic[]
): string {
  const program = parseProgram(filePath, source);
  assignParents(program);
  const targets: {
    range: TextRange;
    kind: string;
    line: number;
    code: string;
  }[] = [];

  for (const d of diagnostics) {
    const norm = normalizeDiagnostic(d);
    if (!norm) continue;
    if (!TARGET_CODES.has(norm.code)) continue;

    const klass = classifyUnusedVar(norm.message);
    if (klass === 'unknown') continue;
    // Unused imports are the linter's own fix; skipping them here keeps the
    // two passes from colliding on the same span.
    if (klass === 'import') continue;

    const narrow = findNodeAtOffset(program, norm.offset);
    const target = resolveTarget(narrow);
    if (!target) continue;

    // Only destructured parameters are deleted: removing a positional one
    // would change the function's arity, so the linter renames those instead.
    if (klass === 'param' && target.kind !== 'binding-element') {
      continue;
    }

    targets.push({
      range: rangeForTarget(source, target),
      kind: kindForTarget(target),
      line: norm.line,
      code: norm.code,
    });
  }

  if (targets.length === 0) return source;

  // Highest offset first so earlier ranges stay valid. A receipt is emitted per
  // applied splice only: receipts record what happened, not what was attempted.
  targets.sort((a, b) => b.range.start - a.range.start);
  let lastStart = Infinity;
  let out = source;
  for (const t of targets) {
    if (t.range.end > lastStart) continue;
    out = out.slice(0, t.range.start) + out.slice(t.range.end);
    lastStart = t.range.start;
    emitReceipt('C', 'delete', `${filePath}:${t.line}`, t.kind, {
      code: t.code,
    });
  }
  return out;
}

// Diagnostics that match no target code mean oxlint's rule names moved; the
// receipt keeps a version bump from reading as a clean, empty run.
function detectCodeDrift(diagnostics: OxlintDiagnostic[]): void {
  const codesSeen = new Set<string>();
  let anyMatch = false;
  for (const d of diagnostics) {
    if (d.code) codesSeen.add(d.code);
    if (TARGET_CODES.has(unwrapCode(d.code))) anyMatch = true;
  }
  if (codesSeen.size > 0 && !anyMatch) {
    emitReceipt('C', 'drift-suspected', '<oxlint>', 'code-drift', {
      codesSeen: [...codesSeen].sort(),
    });
  }
}

function groupByFile(
  diagnostics: OxlintDiagnostic[]
): Map<string, OxlintDiagnostic[]> {
  const byFile = new Map<string, OxlintDiagnostic[]>();
  for (const d of diagnostics) {
    const p = d.filename;
    if (!p) continue;
    const list = byFile.get(p) ?? [];
    list.push(d);
    byFile.set(p, list);
  }
  return byFile;
}

async function main(): Promise<void> {
  const input = await readReportInput(process.argv[2]);
  const relevant = decodeOxlintReport(input, SOURCE).diagnostics;

  detectCodeDrift(relevant);
  const byFile = groupByFile(relevant);

  let filesChanged = 0;
  for (const [path, diags] of byFile) {
    let source: string;
    try {
      source = readFileSync(path, 'utf-8');
    } catch (e) {
      console.error(`WARN: could not read ${path}:`, e);
      continue;
    }
    const updated = applyDeletions(path, source, diags);
    if (updated !== source) {
      writeFileSync(path, updated, 'utf-8');
      filesChanged++;
    }
  }

  console.log(`delete-unused: modified ${filesChanged} file(s)`);
}

if (import.meta.main) {
  main().catch((e) => {
    if (e instanceof ToolReportError) {
      console.error(e.message);
      process.exit(1);
    }
    console.error('INTERNAL ERROR:', e);
    process.exit(2);
  });
}
