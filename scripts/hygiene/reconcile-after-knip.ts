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
// oxc-parser replaces the former `typescript5` alias — the canonical
// typescript@7 (native) ships no JS compiler API. See delete-unused.ts. This
// pass only needs the module's top-level export surface, which oxc's
// TS-ESTree `program.body` exposes directly.
import { parseSync } from 'oxc-parser';

import { emitReceipt } from './_receipts';

// Minimal structural view of an oxc ESTree node (see delete-unused.ts). This
// pass walks only top-level statements and export specifiers, so no parent
// back-links are needed here.
type Node = {
  type: string;
  start: number;
  end: number;
  // oxlint-disable-next-line no-explicit-any
  [key: string]: any;
};

// oxc deduces the dialect from the filename extension. Hygiene only ever sees
// TypeScript, and test fixtures use non-standard extensions (`*.ts.in`), so we
// pass `lang` explicitly: JSX-bearing files by extension, everything else as
// `ts`.
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

// Build a 0-indexed array of line-start offsets from `text`, used to recover a
// 1-indexed line number for a byte offset (replaces TS
// `getLineAndCharacterOfPosition`). Computed once per file.
function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) starts.push(i + 1);
  }
  return starts;
}

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
function collectBindingNames(name: Node, out: Set<string>): void {
  if (name.type === 'Identifier') {
    out.add(name.name);
    return;
  }
  // Default-valued bindings (`{ a = 1 }`, `[a = 1]`) wrap the binding in an
  // AssignmentPattern; the introduced local is on the left.
  if (name.type === 'AssignmentPattern') {
    collectBindingNames(name.left, out);
    return;
  }
  if (name.type === 'ObjectPattern') {
    for (const prop of name.properties as Node[]) {
      // `{ ...rest }` → RestElement; `{ key: local }` / `{ shorthand }` → Property
      if (prop.type === 'RestElement') {
        collectBindingNames(prop.argument, out);
      } else {
        collectBindingNames(prop.value, out);
      }
    }
    return;
  }
  if (name.type === 'ArrayPattern') {
    for (const el of name.elements as Array<Node | null>) {
      // ArrayPattern can hold `null` holes (e.g., `[a, , c]`)
      if (el == null) continue;
      if (el.type === 'RestElement') {
        collectBindingNames(el.argument, out);
      } else {
        collectBindingNames(el, out);
      }
    }
  }
}

// True for the declaration forms that introduce a single named binding we can
// register as an export directly (`export function/class/interface/type/enum
// X`). VariableDeclaration is handled separately (it may bind many names via
// destructuring — see collectBindingNames). Narrows `id` from the Node index
// signature's `any` to a present Node, so callers can read `decl.id.name`
// without a further null check. Mirrors the isReceipt() type-guard precedent.
function isNamedDeclaration(decl: Node): decl is Node & { id: Node } {
  return (
    (decl.type === 'FunctionDeclaration' ||
      decl.type === 'ClassDeclaration' ||
      decl.type === 'TSInterfaceDeclaration' ||
      decl.type === 'TSTypeAliasDeclaration' ||
      decl.type === 'TSEnumDeclaration') &&
    Boolean(decl.id)
  );
}

export function getExportsOfFile(filePath: string): Set<string> {
  const source = readFileSync(filePath, 'utf-8');
  const program = parseSync(filePath, source, { lang: langFor(filePath) })
    .program as unknown as Node;
  const exports = new Set<string>();

  const visit = (node: Node): void => {
    if (node.type === 'ExportNamedDeclaration') {
      // `export { a, b as c }` and `export { a } from './x'` — both carry
      // specifiers; register the exported-side names either way (matches the
      // former `NamedExports.elements[].name.text`).
      if (node.specifiers && node.specifiers.length > 0) {
        for (const spec of node.specifiers as Node[]) {
          exports.add(spec.exported.name);
        }
        return;
      }
      // `export const/function/class/... ` — the declaration is wrapped.
      const decl: Node | null = node.declaration ?? null;
      if (!decl) return;
      if (decl.type === 'VariableDeclaration') {
        for (const d of decl.declarations as Node[]) {
          collectBindingNames(d.id, exports);
        }
      } else if (isNamedDeclaration(decl)) {
        exports.add(decl.id.name);
      }
      return;
    }
    // `export default …` and TS `export = …` both surface as the `default`
    // export symbol.
    if (
      node.type === 'ExportDefaultDeclaration' ||
      node.type === 'TSExportAssignment'
    ) {
      exports.add('default');
      return;
    }
    // `export * from './x'` (ExportAllDeclaration) contributes no named
    // exports of this file — left untouched, as before.
  };

  for (const stmt of program.body as Node[]) visit(stmt);
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

function lineOf(lineStarts: number[], pos: number): number {
  // 1-indexed line for byte offset `pos` (binary search over line starts).
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function fullNodeRange(
  text: string,
  node: Node
): { start: number; end: number } {
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

// Computes deletion ranges for stale specifiers within a named-exports clause
// (`export { … }`), preserving every retained element's leading trivia (JSDoc,
// suppression directives, per-element `type` modifiers). Consecutive stale
// elements are grouped into one range to avoid overlapping deletions when the
// reverse-offset splice loop runs.
//
// Algorithm: walk left→right, group runs of consecutive stale elements:
//   - Run with a kept element AFTER it: delete [first-stale.start, next-kept.start)
//     — sweeps the run + its trailing comma + whitespace
//   - Run extending to the end of the clause: delete [prev-kept.end, last-stale.end)
//     — sweeps the leading comma + whitespace + the run
//
// "All-stale" cannot happen here (caller routes that to wholeRemovals).
export function computeStaleElementRanges(
  specifiers: Node[],
  staleNames: Set<string>
): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  const elements = specifiers;
  let i = 0;
  while (i < elements.length) {
    if (!staleNames.has(elements[i].exported.name)) {
      i++;
      continue;
    }
    const runStart = i;
    let runEnd = i;
    while (
      runEnd + 1 < elements.length &&
      staleNames.has(elements[runEnd + 1].exported.name)
    ) {
      runEnd++;
    }

    if (runEnd + 1 < elements.length) {
      const firstStale = elements[runStart];
      const nextKept = elements[runEnd + 1];
      ranges.push({
        start: firstStale.start,
        end: nextKept.start,
      });
    } else {
      const lastStale = elements[runEnd];
      if (runStart === 0) {
        // Defensive: caller should have routed all-stale to wholeRemovals.
        ranges.push({
          start: lastStale.start,
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

    const program = parseSync(file, source, { lang: langFor(file) })
      .program as unknown as Node;
    const lineStarts = computeLineStarts(source);
    const wholeRemovals: { start: number; end: number }[] = [];
    const partialRemovals: {
      specifiers: Node[];
      names: Set<string>;
    }[] = [];

    for (const stmt of program.body as Node[]) {
      // Re-exports with a module specifier: `export { … } from '…'`
      // (ExportNamedDeclaration with a `source`) and `export * from '…'`
      // (ExportAllDeclaration). Everything else — including local re-exports
      // like `export { X }` with no source — is skipped.
      const isNamedFrom =
        stmt.type === 'ExportNamedDeclaration' && stmt.source != null;
      const isStarFrom = stmt.type === 'ExportAllDeclaration';
      if (!isNamedFrom && !isStarFrom) continue;

      const spec = stmt.source.value as string;
      const isRelative = spec.startsWith('./') || spec.startsWith('../');
      if (!isRelative) continue;

      const target = resolveRelativeModule(file, spec);
      const stmtLine = lineOf(lineStarts, stmt.start);

      if (!target) {
        // Relative target deleted — whole declaration is dead
        wholeRemovals.push(fullNodeRange(source, stmt));
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
      if (isStarFrom) {
        if (targetExports.size === 0) {
          wholeRemovals.push(fullNodeRange(source, stmt));
          emitReceipt('D1', 'delete', `${file}:${stmtLine}`, 'export-clause', {
            reason: 'target-empty',
            spec,
            form: 'export-star',
          });
        }
        continue;
      }

      const specifiers = stmt.specifiers as Node[];
      const stale = new Set<string>();
      for (const el of specifiers) {
        // `.local` is the source-side name to check against the target's
        // exports; `.exported` is how it appears in this barrel's clause.
        const originalName = el.local.name;
        if (!targetExports.has(originalName)) {
          stale.add(el.exported.name);
        }
      }
      if (stale.size === 0) continue;

      if (stale.size === specifiers.length) {
        wholeRemovals.push(fullNodeRange(source, stmt));
        emitReceipt('D1', 'delete', `${file}:${stmtLine}`, 'export-clause', {
          reason: 'all-stale',
          spec,
          staleNames: [...stale],
        });
      } else {
        partialRemovals.push({ specifiers, names: stale });
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
      const ranges = computeStaleElementRanges(p.specifiers, p.names);
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
