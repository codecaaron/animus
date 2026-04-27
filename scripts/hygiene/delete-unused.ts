#!/usr/bin/env bun
// scripts/hygiene/delete-unused.ts
//
// Consumes biome `--reporter=json` diagnostic output on stdin, deletes dead
// declarations at the reported coordinates. Closes the intra-file gap biome
// does not cover — top-level `const` / `function` / `let` / `class` / `type` /
// `interface` / `enum` where biome either renames to `_`-prefix (rejected as
// maintainability poison) or offers no fix at all.
//
// Usage:
//   biome check --reporter=json <files> | bun run scripts/hygiene/delete-unused.ts
//   bun run scripts/hygiene/delete-unused.ts <biome-json-file>     (for tests)
//
// Exit:
//   0 = success (mutations applied OR no mutations needed)
//   1 = biome JSON parse error / missing `diagnostics` array
//   2 = internal error

import { readFileSync, writeFileSync } from 'node:fs';

import ts from 'typescript';

import { emitReceipt } from './_receipts';

type BiomeLoc = {
  path: string;
  start: { line: number; column: number };
  end: { line: number; column: number };
};
type BiomeDiagnostic = { category: string; location: BiomeLoc };
type BiomeReport = { diagnostics: BiomeDiagnostic[] };

type Target =
  | { kind: 'top-level'; node: ts.Node }
  | { kind: 'var-stmt-single'; stmt: ts.VariableStatement }
  | {
      kind: 'var-decl-of-many';
      decl: ts.VariableDeclaration;
      stmt: ts.VariableStatement;
    }
  | { kind: 'binding-element'; elem: ts.BindingElement };

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Uint8Array);
  return Buffer.concat(chunks).toString('utf-8');
}

function lineColToOffset(source: string, line: number, column: number): number {
  // biome 2.x: 1-indexed line, 1-indexed column
  let offset = 0;
  let curLine = 1;
  while (curLine < line && offset < source.length) {
    const nl = source.indexOf('\n', offset);
    if (nl === -1) return source.length;
    offset = nl + 1;
    curLine++;
  }
  return offset + (column - 1);
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
  // Biome flags only the implementation of an overloaded function as
  // `noUnusedVariables`; the signature-only overloads above it are not
  // separately flagged but become orphans if only the implementation is
  // deleted (TS2391). When `impl` has a body AND is preceded by same-named
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

// Biome 2.x emits category strings with a `lint/` prefix
// (e.g., "lint/correctness/noUnusedVariables"). Normalize so the deleter
// accepts both prefixed and unprefixed forms — defensive against a future
// biome version that drops the prefix.
const TARGET_CATEGORIES = new Set([
  'correctness/noUnusedVariables',
  'correctness/noUnusedFunctionParameters',
]);

function normalizeCategory(category: string): string {
  return category.replace(/^lint\//, '');
}

export function applyDeletions(
  filePath: string,
  source: string,
  diagnostics: BiomeDiagnostic[]
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
    category: string;
  }[] = [];

  for (const d of diagnostics) {
    const normalized = normalizeCategory(d.category);
    if (!TARGET_CATEGORIES.has(normalized)) continue;
    const offset = lineColToOffset(
      source,
      d.location.start.line,
      d.location.start.column
    );
    const narrow = findNodeAtOffset(srcFile, offset);
    const target = resolveTarget(narrow);
    if (!target) continue;

    // Filter noUnusedFunctionParameters to destructured-field (BindingElement) only
    if (
      normalized === 'correctness/noUnusedFunctionParameters' &&
      target.kind !== 'binding-element'
    ) {
      continue;
    }

    targets.push({
      range: rangeForTarget(srcFile, target),
      kind: kindForTarget(target),
      line: d.location.start.line,
      category: normalized,
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
      category: t.category,
    });
  }
  return out;
}

async function main(): Promise<void> {
  const input = process.argv[2]
    ? readFileSync(process.argv[2], 'utf-8')
    : await readStdin();

  let report: BiomeReport;
  try {
    report = JSON.parse(input);
  } catch (e) {
    console.error('ERROR: failed to parse biome JSON input:', e);
    process.exit(1);
  }

  if (!report.diagnostics || !Array.isArray(report.diagnostics)) {
    console.error(
      'ERROR: biome JSON missing `diagnostics` array (biome 2.x shape expected)'
    );
    process.exit(1);
  }

  // applyDeletions applies the category filter (with `lint/` prefix
  // normalization) internally. Keeping a parallel filter in main() diverged
  // from applyDeletions' filter in session 89 (2026-04-24) and silently
  // rejected every real biome diagnostic — delegate to the single source of
  // truth.
  const relevant = report.diagnostics;

  // Category-drift canary: collect raw distinct categories observed (pre-
  // normalization). If biome reports diagnostics but ZERO match the
  // normalized TARGET_CATEGORIES, emit a sentinel receipt so the presenter
  // can surface a WARN. Closes the session-89 silent-no-op class of
  // regression on biome version bumps.
  const categoriesSeen = new Set<string>();
  let anyMatch = false;
  for (const d of relevant) {
    if (d.category) categoriesSeen.add(d.category);
    if (TARGET_CATEGORIES.has(normalizeCategory(d.category))) anyMatch = true;
  }
  if (categoriesSeen.size > 0 && !anyMatch) {
    emitReceipt('C', 'drift-suspected', '<biome>', 'category-drift', {
      categoriesSeen: [...categoriesSeen].sort(),
    });
  }

  const byFile = new Map<string, BiomeDiagnostic[]>();
  for (const d of relevant) {
    const p = d.location?.path;
    if (!p) continue;
    const list = byFile.get(p) ?? [];
    list.push(d);
    byFile.set(p, list);
  }

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
