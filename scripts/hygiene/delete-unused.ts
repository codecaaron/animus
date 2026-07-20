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
// typescript5 is an exact-pinned alias of typescript@5.x: the canonical
// toolchain (typescript@7, native) ships no JS compiler API, and this layer
// needs the TS5 AST surface (forEachChild/createSourceFile/is*Declaration).
import ts from 'typescript5';

import { emitReceipt } from './_receipts';

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
  | { kind: 'top-level'; node: ts.Node }
  | { kind: 'var-stmt-single'; stmt: ts.VariableStatement }
  | {
      kind: 'var-decl-of-many';
      decl: ts.VariableDeclaration;
      stmt: ts.VariableStatement;
    }
  | { kind: 'binding-element'; elem: ts.BindingElement };

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

function findNodeAtOffset(source: ts.SourceFile, offset: number): ts.Node {
  function recurse(node: ts.Node): ts.Node {
    let found: ts.Node | undefined;
    ts.forEachChild(node, (child) => {
      if (offset >= child.getStart(source) && offset < child.getEnd()) {
        found = recurse(child);
        return true;
      }
      return undefined;
    });
    return found ?? node;
  }
  return recurse(source);
}

function resolveTarget(node: ts.Node): Target | undefined {
  let cur: ts.Node | undefined = node;
  while (cur) {
    if (ts.isBindingElement(cur)) {
      return { kind: 'binding-element', elem: cur };
    }
    if (ts.isVariableDeclaration(cur)) {
      const list = cur.parent;
      const stmt = list?.parent;
      if (
        list &&
        ts.isVariableDeclarationList(list) &&
        stmt &&
        ts.isVariableStatement(stmt)
      ) {
        if (list.declarations.length === 1) {
          return { kind: 'var-stmt-single', stmt };
        }
        return { kind: 'var-decl-of-many', decl: cur, stmt };
      }
    }
    if (
      ts.isFunctionDeclaration(cur) ||
      ts.isClassDeclaration(cur) ||
      ts.isTypeAliasDeclaration(cur) ||
      ts.isInterfaceDeclaration(cur) ||
      ts.isEnumDeclaration(cur) ||
      ts.isModuleDeclaration(cur)
    ) {
      return { kind: 'top-level', node: cur };
    }
    cur = cur.parent;
  }
  return undefined;
}

function expandToLineBounds(
  source: ts.SourceFile,
  node: ts.Node
): { start: number; end: number } {
  const text = source.getFullText();
  let start = node.getStart(source);
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
  source: ts.SourceFile,
  decl: ts.VariableDeclaration,
  stmt: ts.VariableStatement
): { start: number; end: number } {
  const decls = stmt.declarationList.declarations;
  const idx = decls.indexOf(decl);
  if (idx === -1) return { start: decl.getStart(source), end: decl.end };

  if (idx < decls.length - 1) {
    // Not last: delete from this declarator's start to the next's start
    // (consumes trailing comma + whitespace)
    return {
      start: decl.getStart(source),
      end: decls[idx + 1].getStart(source),
    };
  }
  // Last: delete from previous declarator's end to this declarator's end
  // (consumes preceding comma)
  const prev = decls[idx - 1];
  return { start: prev.end, end: decl.end };
}

function rangeForBindingElement(
  source: ts.SourceFile,
  elem: ts.BindingElement
): { start: number; end: number } {
  const pattern = elem.parent;
  const elements = pattern.elements;
  const idx = elements.indexOf(elem);

  if (idx < elements.length - 1) {
    return {
      start: elem.getStart(source),
      end: elements[idx + 1].getStart(source),
    };
  }
  if (idx > 0) {
    const prev = elements[idx - 1];
    return { start: prev.end, end: elem.end };
  }
  // Only element: delete just the element (caller must decide about the pattern itself)
  return { start: elem.getStart(source), end: elem.end };
}

function findOverloadGroupStart(impl: ts.FunctionDeclaration): ts.Node {
  // Oxlint flags only the implementation of an overloaded function as
  // unused; the signature-only overloads above it are not separately
  // flagged but become orphans if only the implementation is deleted
  // (TS2391). When `impl` has a body AND is preceded by same-named
  // signature-only FunctionDeclarations, expand the range to the first
  // signature so the whole group is removed atomically.
  if (!impl.body || !impl.name) return impl;
  const parent = impl.parent as ts.SourceFile | undefined;
  const statements = parent?.statements;
  if (!statements) return impl;
  const idx = statements.indexOf(impl);
  let groupStart: ts.Node = impl;
  for (let i = idx - 1; i >= 0; i--) {
    const s = statements[i];
    if (
      ts.isFunctionDeclaration(s) &&
      !s.body &&
      s.name?.text === impl.name.text
    ) {
      groupStart = s;
    } else {
      break;
    }
  }
  return groupStart;
}

function varDeclKind(stmt: ts.VariableStatement): string {
  const f = stmt.declarationList.flags;
  if (f & ts.NodeFlags.Const) return 'const-decl';
  if (f & ts.NodeFlags.Let) return 'let-decl';
  return 'var-decl';
}

function kindForTarget(target: Target): string {
  switch (target.kind) {
    case 'top-level': {
      const n = target.node;
      if (ts.isFunctionDeclaration(n)) return 'function-decl';
      if (ts.isClassDeclaration(n)) return 'class-decl';
      if (ts.isTypeAliasDeclaration(n)) return 'type-alias';
      if (ts.isInterfaceDeclaration(n)) return 'interface';
      if (ts.isEnumDeclaration(n)) return 'enum';
      if (ts.isModuleDeclaration(n)) return 'namespace';
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
  source: ts.SourceFile,
  target: Target
): { start: number; end: number } {
  switch (target.kind) {
    case 'top-level': {
      // Handle function overload groups: expand backwards to include all
      // signature-only overloads preceding an implementation.
      if (ts.isFunctionDeclaration(target.node)) {
        const groupStart = findOverloadGroupStart(target.node);
        if (groupStart !== target.node) {
          const groupRange = expandToLineBounds(source, groupStart);
          const implRange = expandToLineBounds(source, target.node);
          return { start: groupRange.start, end: implRange.end };
        }
      }
      return expandToLineBounds(source, target.node);
    }
    case 'var-stmt-single':
      return expandToLineBounds(source, target.stmt);
    case 'var-decl-of-many':
      return rangeForVarDeclOfMany(source, target.decl, target.stmt);
    case 'binding-element':
      return rangeForBindingElement(source, target.elem);
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
  const srcFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true
  );
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

    const narrow = findNodeAtOffset(srcFile, norm.offset);
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
      range: rangeForTarget(srcFile, target),
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
