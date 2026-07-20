#!/usr/bin/env bun
// scripts/hygiene/reconcile-after-knip.ts
//
// Post-knip coordination pass. Knip 6.6.2's fixer is a single-pass text splice
// with no post-state reasoning (verified against knip's IssueFixer source).
// This script handles two coordination gaps:
//
//   1. 0-byte files. Knip strips all content but may not delete the file if
//      something still imports it. TS then reports TS2306 "not a module" on
//      consumers. Fix: write `export {};` so the file is a valid empty module.
//
//   2. Stale barrel re-exports. Knip removes a source export without rewriting
//      barrels that re-export it — TS2305 ("has no exported member") and
//      TS2459 ("declared locally but not exported") at the barrel's call sites.
//      Fix: parse each barrel, check target file's actual exports, strip named
//      re-exports for bindings no longer present.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
// typescript5: exact-pinned alias of typescript@5.x — the canonical
// typescript@7 (native) ships no JS compiler API. See delete-unused.ts.
import ts from 'typescript5';

import { emitReceipt } from './_receipts';

const SOURCE_ROOTS = ['packages', 'e2e'];
const EXTENSIONS = ['.ts', '.tsx'] as const;
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'target',
  '.next',
  '.turbo',
]);

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, out);
    } else if (EXTENSIONS.some((e) => name.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

// --- Pass 1: rewrite 0-byte files as valid empty modules ---------------------

export function fixEmptyModules(files: string[]): string[] {
  const fixed: string[] = [];
  for (const f of files) {
    let size;
    try {
      size = statSync(f).size;
    } catch {
      continue;
    }
    if (size === 0) {
      writeFileSync(f, 'export {};\n', 'utf-8');
      fixed.push(f);
      emitReceipt('D1', 'stub', f, 'empty-module');
    }
  }
  return fixed;
}

// --- Pass 2: strip stale barrel re-exports -----------------------------------

// Walk a BindingName (Identifier | ObjectBindingPattern | ArrayBindingPattern)
// and collect every local-binding name it introduces. Used by
// getExportsOfFile so destructured exports like
//   export const { system: ds, theme } = createSystem();
//   export const [first, , third] = tuple;
// register `ds`, `theme`, `first`, `third` as exports rather than slipping
// through as silent zero-export. This is the bug that caused D1 to delete
// `export { ds } from './system'` re-exports as "all-stale" (2026-04-26).
function collectBindingNames(name: ts.BindingName, out: Set<string>): void {
  if (ts.isIdentifier(name)) {
    out.add(name.text);
    return;
  }
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const el of name.elements) {
      // ArrayBindingPattern can hold OmittedExpression (e.g., `[a, , c]`)
      if (!ts.isBindingElement(el)) continue;
      collectBindingNames(el.name, out);
    }
  }
}

export function getExportsOfFile(filePath: string): Set<string> {
  const source = readFileSync(filePath, 'utf-8');
  const sf = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true
  );
  const exports = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (
      ts.isExportDeclaration(node) &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause)
    ) {
      for (const el of node.exportClause.elements) {
        exports.add(el.name.text);
      }
      return;
    }
    if (ts.isExportAssignment(node)) {
      exports.add('default');
      return;
    }
    const hasExportModifier =
      ts.canHaveModifiers(node) &&
      ts
        .getModifiers(node)
        ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!hasExportModifier) return;

    if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        collectBindingNames(d.name, exports);
      }
    } else if (
      (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node)) &&
      node.name
    ) {
      exports.add(node.name.text);
    }
  };

  for (const stmt of sf.statements) visit(stmt);
  return exports;
}

function resolveRelativeModule(
  fromFile: string,
  specifier: string
): string | undefined {
  if (!specifier.startsWith('./') && !specifier.startsWith('../'))
    return undefined;
  const dir = fromFile.substring(0, fromFile.lastIndexOf('/'));
  const base = resolve(dir, specifier);
  const candidates = [
    base, // explicit extension in specifier
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ];
  for (const c of candidates) {
    try {
      if (statSync(c).isFile()) return c;
    } catch {
      /* not found, try next */
    }
  }
  return undefined;
}

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return ts.getLineAndCharacterOfPosition(sf, node.getStart(sf)).line + 1;
}

function fullNodeRange(
  sf: ts.SourceFile,
  node: ts.Node
): { start: number; end: number } {
  const text = sf.getFullText();
  let start = node.getStart(sf);
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

// Computes deletion ranges for stale elements within a NamedExports clause,
// preserving every retained element's leading trivia (JSDoc, suppression
// directives, per-element `type` modifiers). Consecutive stale elements are
// grouped into one range to avoid overlapping deletions when the reverse-
// offset splice loop runs.
//
// Algorithm: walk left→right, group runs of consecutive stale elements:
//   - Run with a kept element AFTER it: delete [first-stale.start, next-kept.start)
//     — sweeps the run + its trailing comma + whitespace
//   - Run extending to the end of the clause: delete [prev-kept.end, last-stale.end)
//     — sweeps the leading comma + whitespace + the run
//
// "All-stale" cannot happen here (caller routes that to wholeRemovals).
export function computeStaleElementRanges(
  sf: ts.SourceFile,
  decl: ts.NamedExports,
  staleNames: Set<string>
): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  const elements = decl.elements;
  let i = 0;
  while (i < elements.length) {
    if (!staleNames.has(elements[i].name.text)) {
      i++;
      continue;
    }
    const runStart = i;
    let runEnd = i;
    while (
      runEnd + 1 < elements.length &&
      staleNames.has(elements[runEnd + 1].name.text)
    ) {
      runEnd++;
    }

    if (runEnd + 1 < elements.length) {
      const firstStale = elements[runStart];
      const nextKept = elements[runEnd + 1];
      ranges.push({
        start: firstStale.getStart(sf),
        end: nextKept.getStart(sf),
      });
    } else {
      const lastStale = elements[runEnd];
      if (runStart === 0) {
        // Defensive: caller should have routed all-stale to wholeRemovals.
        ranges.push({
          start: lastStale.getStart(sf),
          end: lastStale.end,
        });
      } else {
        const prevKept = elements[runStart - 1];
        ranges.push({ start: prevKept.end, end: lastStale.end });
      }
    }

    i = runEnd + 1;
  }
  return ranges;
}

export function fixStaleBarrelReExports(files: string[]): string[] {
  const fixed: string[] = [];

  for (const file of files) {
    let source: string;
    try {
      source = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    // Cheap pre-filter: must contain both `export` and `from`
    if (!source.includes('export') || !source.includes('from')) continue;

    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const wholeRemovals: { start: number; end: number }[] = [];
    const partialRemovals: {
      decl: ts.ExportDeclaration;
      names: Set<string>;
    }[] = [];

    for (const stmt of sf.statements) {
      if (!ts.isExportDeclaration(stmt) || !stmt.moduleSpecifier) continue;
      const spec = (stmt.moduleSpecifier as ts.StringLiteral).text;
      const isRelative = spec.startsWith('./') || spec.startsWith('../');
      if (!isRelative) continue;

      const target = resolveRelativeModule(file, spec);
      const stmtLine = lineOf(sf, stmt);

      if (!target) {
        // Relative target deleted — whole declaration is dead
        wholeRemovals.push(fullNodeRange(sf, stmt));
        emitReceipt('D1', 'delete', `${file}:${stmtLine}`, 'export-clause', {
          reason: 'target-deleted',
          spec,
        });
        continue;
      }

      let targetSize: number;
      try {
        targetSize = statSync(target).size;
      } catch {
        continue;
      }

      if (targetSize === 0) {
        // Pass 1 will write `export {};` here on the same run. `export *`
        // against an empty module is a no-op (legal TS). Leave it alone.
        continue;
      }

      let targetExports: Set<string>;
      try {
        targetExports = getExportsOfFile(target);
      } catch {
        continue;
      }

      // `export * from './bar'` — only strip if target has zero exports
      if (!stmt.exportClause) {
        if (targetExports.size === 0) {
          wholeRemovals.push(fullNodeRange(sf, stmt));
          emitReceipt('D1', 'delete', `${file}:${stmtLine}`, 'export-clause', {
            reason: 'target-empty',
            spec,
            form: 'export-star',
          });
        }
        continue;
      }

      if (!ts.isNamedExports(stmt.exportClause)) continue;

      const stale = new Set<string>();
      for (const el of stmt.exportClause.elements) {
        const originalName = el.propertyName?.text ?? el.name.text;
        if (!targetExports.has(originalName)) {
          stale.add(el.name.text);
        }
      }
      if (stale.size === 0) continue;

      if (stale.size === stmt.exportClause.elements.length) {
        wholeRemovals.push(fullNodeRange(sf, stmt));
        emitReceipt('D1', 'delete', `${file}:${stmtLine}`, 'export-clause', {
          reason: 'all-stale',
          spec,
          staleNames: [...stale],
        });
      } else {
        partialRemovals.push({ decl: stmt, names: stale });
        for (const name of stale) {
          emitReceipt(
            'D1',
            'delete',
            `${file}:${stmtLine}:${name}`,
            'export-clause',
            { spec, removedName: name }
          );
        }
      }
    }

    if (wholeRemovals.length === 0 && partialRemovals.length === 0) continue;

    let updated = source;
    // Span-preserving deletion strategy: every edit is a delete-range against
    // the ORIGINAL source. wholeRemovals contributes its full statement range;
    // partialRemovals contribute one range per consecutive run of stale
    // elements, computed so retained elements' leading trivia (JSDoc,
    // suppression directives, per-element type modifiers) survives intact.
    // Reverse-offset application keeps later ranges' indices stable.
    const edits: { start: number; end: number }[] = [];
    for (const w of wholeRemovals) {
      edits.push({ start: w.start, end: w.end });
    }
    for (const p of partialRemovals) {
      const named = p.decl.exportClause as ts.NamedExports;
      const ranges = computeStaleElementRanges(sf, named, p.names);
      for (const r of ranges) edits.push(r);
    }
    edits.sort((a, b) => b.start - a.start);
    for (const e of edits) {
      updated = updated.slice(0, e.start) + updated.slice(e.end);
    }

    writeFileSync(file, updated, 'utf-8');
    fixed.push(file);
  }

  return fixed;
}

export function collectSourceFiles(root: string): string[] {
  const out: string[] = [];
  for (const r of SOURCE_ROOTS) {
    const abs = join(root, r);
    try {
      if (statSync(abs).isDirectory()) walk(abs, out);
    } catch {
      /* root not present */
    }
  }
  return out;
}

function main(): void {
  const root = process.cwd();
  const files = collectSourceFiles(root);

  const empty = fixEmptyModules(files);
  // After writing `export {};` to empty files, barrel pass sees them as
  // zero-export modules — which is the correct cue to skip `export * from`
  // them (the `export *` is harmless). `export { X } from` them WOULD strip
  // X since the target now has zero named exports.
  const barrels = fixStaleBarrelReExports(files);

  console.log(
    `reconcile-after-knip: wrote export {} to ${empty.length} empty file(s); pruned stale re-exports in ${barrels.length} barrel(s)`
  );
}

if (import.meta.main) {
  main();
}
