#!/usr/bin/env bun
// Knip's fixer is a single-pass text splice with no post-state reasoning, so it
// leaves 0-byte modules (TS2306) and stale barrel re-exports (TS2305).

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  type Node,
  type TextRange,
  childNode,
  childNodeList,
  childNodeSlots,
  identifierName,
  parseProgram,
  stringField,
} from './_ast';
import { emitReceipt } from './_receipts';

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

// Collects every local name a binding pattern introduces. A destructured export
// that registers none reads as zero-export and loses its re-exports.
function collectBindingNames(name: Node, out: Set<string>): void {
  if (name.type === 'Identifier') {
    const local = stringField(name, 'name');
    if (local !== undefined) out.add(local);
    return;
  }
  // `{ a = 1 }` and `[a = 1]` wrap the binding in an AssignmentPattern.
  if (name.type === 'AssignmentPattern') {
    const left = childNode(name, 'left');
    if (left !== undefined) collectBindingNames(left, out);
    return;
  }
  if (name.type === 'ObjectPattern') {
    for (const prop of childNodeList(name, 'properties')) {
      // `{ ...rest }` → RestElement; `{ key: local }` → Property.
      const bound =
        prop.type === 'RestElement'
          ? childNode(prop, 'argument')
          : childNode(prop, 'value');
      if (bound !== undefined) collectBindingNames(bound, out);
    }
    return;
  }
  if (name.type === 'ArrayPattern') {
    for (const el of childNodeSlots(name, 'elements')) {
      // ArrayPattern can hold `null` holes (e.g., `[a, , c]`)
      if (el === null) continue;
      if (el.type === 'RestElement') {
        const rest = childNode(el, 'argument');
        if (rest !== undefined) collectBindingNames(rest, out);
      } else {
        collectBindingNames(el, out);
      }
    }
  }
}

// VariableDeclaration is absent: it may bind many names via destructuring.
const NAMED_DECLARATION_TYPES = new Set([
  'FunctionDeclaration',
  'ClassDeclaration',
  'TSInterfaceDeclaration',
  'TSTypeAliasDeclaration',
  'TSEnumDeclaration',
]);

export function getExportsOfFile(filePath: string): Set<string> {
  const source = readFileSync(filePath, 'utf-8');
  const program = parseProgram(filePath, source);
  const exports = new Set<string>();

  const visit = (node: Node): void => {
    if (node.type === 'ExportNamedDeclaration') {
      const specifiers = childNodeList(node, 'specifiers');
      if (specifiers.length > 0) {
        for (const spec of specifiers) {
          const exportedName = identifierName(spec, 'exported');
          if (exportedName !== undefined) exports.add(exportedName);
        }
        return;
      }
      const decl = childNode(node, 'declaration');
      if (decl === undefined) return;
      if (decl.type === 'VariableDeclaration') {
        for (const d of childNodeList(decl, 'declarations')) {
          const id = childNode(d, 'id');
          if (id !== undefined) collectBindingNames(id, exports);
        }
      } else if (NAMED_DECLARATION_TYPES.has(decl.type)) {
        const declaredName = identifierName(decl, 'id');
        if (declaredName !== undefined) exports.add(declaredName);
      }
      return;
    }
    // TS `export = …` and `export default` both surface as `default`.
    if (
      node.type === 'ExportDefaultDeclaration' ||
      node.type === 'TSExportAssignment'
    ) {
      exports.add('default');
      return;
    }
    // `export * from './x'` contributes no named exports of this file.
  };

  for (const stmt of childNodeList(program, 'body')) visit(stmt);
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
    // Declaration files are live targets: an unresolvable target counts as
    // deleted, so omitting `.d.ts` would strip live re-exports.
    `${base}.d.ts`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.d.ts`,
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
  // 1-indexed line for byte offset `pos`.
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function fullNodeRange(text: string, node: Node): TextRange {
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

// Groups consecutive stale elements into one range so retained elements keep
// their leading trivia and the splice ranges never overlap. Never all-stale.
export function computeStaleElementRanges(
  specifiers: Node[],
  staleNames: Set<string>
): TextRange[] {
  const ranges: TextRange[] = [];
  const elements = specifiers;
  const isStale = (element: Node): boolean => {
    const exportedName = identifierName(element, 'exported');
    return exportedName !== undefined && staleNames.has(exportedName);
  };
  let i = 0;
  while (i < elements.length) {
    if (!isStale(elements[i])) {
      i++;
      continue;
    }
    const runStart = i;
    let runEnd = i;
    while (runEnd + 1 < elements.length && isStale(elements[runEnd + 1])) {
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
    if (!source.includes('export') || !source.includes('from')) continue;

    const program = parseProgram(file, source);
    const lineStarts = computeLineStarts(source);
    const wholeRemovals: TextRange[] = [];
    const partialRemovals: {
      specifiers: Node[];
      names: Set<string>;
    }[] = [];

    for (const stmt of childNodeList(program, 'body')) {
      const sourceNode = childNode(stmt, 'source');
      const isNamedFrom =
        stmt.type === 'ExportNamedDeclaration' && sourceNode !== undefined;
      const isStarFrom = stmt.type === 'ExportAllDeclaration';
      if (!isNamedFrom && !isStarFrom) continue;

      const spec =
        sourceNode === undefined ? undefined : stringField(sourceNode, 'value');
      if (spec === undefined) continue;
      const isRelative = spec.startsWith('./') || spec.startsWith('../');
      if (!isRelative) continue;

      const target = resolveRelativeModule(file, spec);
      const stmtLine = lineOf(lineStarts, stmt.start);

      if (!target) {
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
        // Pass 1 writes `export {};` here on the same run, and `export *`
        // against an empty module is legal, so the statement stays.
        continue;
      }

      let targetExports: Set<string>;
      try {
        targetExports = getExportsOfFile(target);
      } catch {
        continue;
      }

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

      const specifiers = childNodeList(stmt, 'specifiers');
      const stale = new Set<string>();
      for (const el of specifiers) {
        // `local` is the target-side name to check; `exported` is the name
        // this barrel publishes. A string name has neither, so it stays.
        const exportedName = identifierName(el, 'exported');
        const originalName = identifierName(el, 'local');
        if (exportedName === undefined || originalName === undefined) continue;
        if (!targetExports.has(originalName)) {
          stale.add(exportedName);
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
    // Every edit is a range against the original source, so they are applied
    // from the highest offset down to keep the remaining offsets valid.
    const edits: TextRange[] = [];
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
  // Order matters: once `export {};` is written, the barrel pass sees a
  // zero-export module and strips named re-exports of it.
  const barrels = fixStaleBarrelReExports(files);

  console.log(
    `reconcile-after-knip: wrote export {} to ${empty.length} empty file(s); pruned stale re-exports in ${barrels.length} barrel(s)`
  );
}

if (import.meta.main) {
  main();
}
