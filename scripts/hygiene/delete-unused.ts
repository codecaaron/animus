#!/usr/bin/env bun
// scripts/hygiene/delete-unused.ts
//
// Consumes oxlint `--format=json` diagnostic output on stdin, deletes dead
// declarations at the reported coordinates. Closes the intra-file gap
// oxlint's `--fix-suggestions` does not cover — top-level `const` /
// `function` / `let` / `class` / `type` / `interface` / `enum` /
// `namespace`, plus destructured-field unused parameters.
//
// Usage:
//   vp lint --format=json <files> | bun run scripts/hygiene/delete-unused.ts
//   bun run scripts/hygiene/delete-unused.ts <oxlint-json-file>     (for tests)
//
// Exit:
//   0 = success (mutations applied OR no mutations needed)
//   1 = oxlint JSON parse error / missing `diagnostics` array
//   2 = internal error

import { readFileSync, writeFileSync } from 'node:fs';
// oxc-parser replaces the former `typescript5` alias: the canonical toolchain
// (typescript@7, native) ships no JS compiler API, and this layer needs an
// in-process AST surface. oxc-parser emits a TS-ESTree AST (`parseSync` →
// `{ program, errors, comments }`) with trivia-exclusive `start`/`end` spans,
// which is all the intra-file dead-decl deleter needs.
import { parseSync } from 'oxc-parser';

import { emitReceipt } from './_receipts';

// Minimal structural view of an oxc ESTree node. oxc nodes carry no `parent`
// back-link (unlike the TS AST), so `assignParents` wires one on non-enumerable
// `parent` slots after parse; the recursive walkers below rely on it.
type Node = {
  type: string;
  start: number;
  end: number;
  parent?: Node;
  // Children are navigated structurally (see `childNodes`); the index
  // signature keeps that ergonomic without enumerating every ESTree field.
  // oxlint-disable-next-line no-explicit-any
  [key: string]: any;
};

// oxc deduces the dialect from the filename extension. Hygiene only ever sees
// TypeScript, and test fixtures use non-standard extensions (`*.ts.in`), so we
// pass `lang` explicitly: JSX-bearing files by extension, everything else as
// `ts`. This guarantees TS syntax (overload signatures, `namespace`, type
// annotations) parses regardless of the on-disk extension.
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

// A node is any object carrying a string `type` and numeric `start`. This is
// the discriminator `childNodes`/`assignParents` use to separate AST children
// from scalar fields (names, flags, regex descriptors, `null` holes).
function isNode(value: unknown): value is Node {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string' &&
    typeof (value as { start?: unknown }).start === 'number'
  );
}

// Direct child nodes of `node`, in source order. Iterates own enumerable
// values (arrays are flattened, `null` array holes skipped). The `parent`
// link written by `assignParents` is non-enumerable, so it is never revisited
// as a child — this is what keeps the walk acyclic.
function childNodes(node: Node): Node[] {
  const out: Node[] = [];
  for (const value of Object.values(node)) {
    if (isNode(value)) {
      out.push(value);
    } else if (Array.isArray(value)) {
      for (const el of value) if (isNode(el)) out.push(el);
    }
  }
  return out;
}

// Wire a non-enumerable `parent` back-link onto every node in the tree so the
// TS-style upward walks (`resolveTarget`, `findOverloadGroupStart`) work.
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

// Statement containers in which a `VariableDeclaration` sits at statement
// position (as opposed to a `for (…)` initializer). Mirrors the TS guard that
// required the declaration list's parent to be a `VariableStatement`.
const STATEMENT_CONTAINERS = new Set([
  'Program',
  'BlockStatement',
  'StaticBlock',
  'TSModuleBlock',
]);

// If `node` is the `.declaration` of an export wrapper, return the wrapper so
// the deletion range covers `export …` too; otherwise return `node` unchanged.
// (Mirrors the TS rule: deleting an exported declaration must remove the
// `export` keyword with it.)
function rangeNode(node: Node): Node {
  const parent = node.parent;
  if (
    parent &&
    (parent.type === 'ExportNamedDeclaration' ||
      parent.type === 'ExportDefaultDeclaration') &&
    parent.declaration === node
  ) {
    return parent;
  }
  return node;
}

type OxlintSpan = {
  offset: number;
  length: number;
  line: number;
  column: number;
};
type OxlintLabel = { label: string; span: OxlintSpan };
type OxlintDiagnostic = {
  message: string;
  code: string;
  filename: string;
  labels: OxlintLabel[];
  // Other oxlint fields (severity, causes, related, url, help) are ignored.
};
type OxlintReport = { diagnostics: OxlintDiagnostic[] };

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
  offset: number; // 0-indexed byte offset (oxlint's labels[0].span.offset)
  line: number; // 1-indexed
  column: number; // 1-indexed
};

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Uint8Array);
  return Buffer.concat(chunks).toString('utf-8');
}

function findNodeAtOffset(root: Node, offset: number): Node {
  function recurse(node: Node): Node {
    for (const child of childNodes(node)) {
      // Spans are trivia-exclusive, same as TS `getStart`/`getEnd`.
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
    // A binding element is any element sitting directly inside a destructuring
    // pattern: an ObjectPattern `Property`/`RestElement`, or an ArrayPattern
    // element. (In the TS AST this was a dedicated `BindingElement`; ESTree
    // collapses it into the pattern's child.)
    const parent = cur.parent;
    if (
      parent &&
      (parent.type === 'ObjectPattern' || parent.type === 'ArrayPattern')
    ) {
      return { kind: 'binding-element', elem: cur, pattern: parent };
    }
    if (cur.type === 'VariableDeclarator') {
      // ESTree collapses TS's VariableStatement→declarationList→declarations
      // into VariableDeclaration→declarations, so the declarator's parent IS
      // the statement-level declaration.
      const stmt = cur.parent;
      if (
        stmt &&
        stmt.type === 'VariableDeclaration' &&
        stmt.parent &&
        STATEMENT_CONTAINERS.has(stmt.parent.type)
      ) {
        if (stmt.declarations.length === 1) {
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

function expandToLineBounds(
  text: string,
  node: Node
): { start: number; end: number } {
  let start = node.start;
  let end = node.end;

  // Consume trailing newline(s) so the deletion collapses the whole line
  if (text.charAt(end) === '\r' && text.charAt(end + 1) === '\n') end += 2;
  else if (text.charAt(end) === '\n') end += 1;

  // Consume leading indentation on the start line (if line is otherwise blank
  // before the node — i.e., this is a standalone statement line)
  const prevNl = text.lastIndexOf('\n', start - 1);
  const lineStart = prevNl + 1;
  if (text.substring(lineStart, start).trim() === '') {
    start = lineStart;
  }

  return { start, end };
}

function rangeForVarDeclOfMany(
  decl: Node,
  stmt: Node
): { start: number; end: number } {
  const decls: Node[] = stmt.declarations;
  const idx = decls.indexOf(decl);
  if (idx === -1) return { start: decl.start, end: decl.end };

  if (idx < decls.length - 1) {
    // Not last: delete from this declarator's start to the next's start
    // (consumes trailing comma + whitespace)
    return {
      start: decl.start,
      end: decls[idx + 1].start,
    };
  }
  // Last: delete from previous declarator's end to this declarator's end
  // (consumes preceding comma)
  const prev = decls[idx - 1];
  return { start: prev.end, end: decl.end };
}

function rangeForBindingElement(
  elem: Node,
  pattern: Node
): { start: number; end: number } {
  // ObjectPattern holds `properties`; ArrayPattern holds `elements` (which may
  // contain `null` holes). The neighbor-based comma-slicing math carries over
  // on spans either way.
  const elements: Array<Node | null> =
    pattern.type === 'ObjectPattern' ? pattern.properties : pattern.elements;
  const idx = elements.indexOf(elem);

  if (idx < elements.length - 1) {
    return {
      start: elem.start,
      end: (elements[idx + 1] as Node).start,
    };
  }
  if (idx > 0) {
    const prev = elements[idx - 1] as Node;
    return { start: prev.end, end: elem.end };
  }
  // Only element: delete just the element (caller must decide about the pattern itself)
  return { start: elem.start, end: elem.end };
}

function findOverloadGroupStart(impl: Node): Node {
  // Oxlint flags only the implementation of an overloaded function as
  // unused; the signature-only overloads above it are not separately
  // flagged but become orphans if only the implementation is deleted
  // (TS2391). When `impl` has a body AND is preceded by same-named
  // signature-only overloads (ESTree `TSDeclareFunction`), expand the range
  // to the first signature so the whole group is removed atomically.
  if (!impl.body || !impl.id) return impl;
  const parent = impl.parent;
  const statements: Node[] | undefined = parent?.body;
  if (!statements || !Array.isArray(statements)) return impl;
  const idx = statements.indexOf(impl);
  let groupStart: Node = impl;
  for (let i = idx - 1; i >= 0; i--) {
    const s = statements[i];
    if (s.type === 'TSDeclareFunction' && s.id?.name === impl.id.name) {
      groupStart = s;
    } else {
      break;
    }
  }
  return groupStart;
}

function varDeclKind(stmt: Node): string {
  if (stmt.kind === 'const') return 'const-decl';
  if (stmt.kind === 'let') return 'let-decl';
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

function rangeForTarget(
  text: string,
  target: Target
): { start: number; end: number } {
  switch (target.kind) {
    case 'top-level': {
      // Handle function overload groups: expand backwards to include all
      // signature-only overloads preceding an implementation.
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

// Oxlint emits codes wrapped as `eslint(<rule-name>)`. Strip the wrapper
// so the deleter operates on bare rule names internally.
const TARGET_CODES = new Set(['no-unused-vars']);

function unwrapCode(code: string): string {
  const m = code.match(/^eslint\((.+)\)$/);
  return m ? m[1] : code;
}

// Discriminator for oxlint's `no-unused-vars` rule, which folds biome 2.x's
// noUnusedVariables + noUnusedFunctionParameters + noUnusedImports into one
// rule. The class is recovered from the diagnostic message prefix (verified
// empirically against the live binary; live-integration test pins drift
// detection).
function classifyUnusedVar(
  message: string
): 'decl' | 'import' | 'param' | 'unknown' {
  if (/^Identifier '[^']+' is imported/.test(message)) return 'import';
  if (/^Parameter '/.test(message)) return 'param';
  if (/^(Variable|Function|Class|Type alias|Interface|Enum) '/.test(message)) {
    return 'decl';
  }
  return 'unknown';
}

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
  const program = parseSync(filePath, source, { lang: langFor(filePath) })
    .program as unknown as Node;
  assignParents(program);
  const targets: {
    range: { start: number; end: number };
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
    // Layer A handles unused imports via `vp lint --fix-suggestions`.
    // Layer C must skip them so the layers do not collide.
    if (klass === 'import') continue;

    const narrow = findNodeAtOffset(program, norm.offset);
    const target = resolveTarget(narrow);
    if (!target) continue;

    // For `no-unused-vars` of class `param`: only delete destructured
    // binding-elements. Positional parameter rename is the linter's job
    // (arity-preserving). If a `param`-classified diagnostic resolves to
    // anything other than a BindingElement, skip.
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

  // Sort descending by start, drop overlapping ranges, emit receipt per
  // actually-applied splice (overlapping drops do NOT emit — receipts
  // record what happened, not what was attempted).
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

// Code-drift canary: collect raw distinct codes observed (pre-unwrap). If
// oxlint reports diagnostics but ZERO match the unwrapped TARGET_CODES,
// emit a sentinel receipt so the presenter can surface a WARN. Closes the
// session-89 silent-no-op class of regression on linter version bumps.
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
  const input = process.argv[2]
    ? readFileSync(process.argv[2], 'utf-8')
    : await readStdin();

  let report: OxlintReport;
  try {
    report = JSON.parse(input);
  } catch (e) {
    console.error('ERROR: failed to parse oxlint JSON input:', e);
    process.exit(1);
  }

  if (!report.diagnostics || !Array.isArray(report.diagnostics)) {
    console.error(
      'ERROR: oxlint JSON missing `diagnostics` array (oxlint --format=json shape expected)'
    );
    process.exit(1);
  }

  const relevant = report.diagnostics;

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
    console.error('INTERNAL ERROR:', e);
    process.exit(2);
  });
}
