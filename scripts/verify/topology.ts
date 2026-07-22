#!/usr/bin/env bun
// scripts/verify/topology.ts
//
// Pure executable checker for the One-Way Dependency Rule (AGENTS.md §
// Workspace Topology). Dependencies flow top-down only:
//
//   packages/*  MUST NOT import  e2e/*   or  legacy/*
//   e2e/*       MUST NOT import  legacy/*
//   e2e/*       MAY     import  packages/*   (permitted consumer direction)
//
// legacy/* has no package.json anywhere in the tree, so it is unreachable by a
// live workspace name; but its historically-published names (@animus-ui/core,
// theming, runtime, ui) still resolve on the public registry, so a bare import
// of one is a real vector into archived code. The rule is enforced across three
// real vectors:
//
//   1. source imports  — import/export-from/require/dynamic-import specifiers
//                        in packages/* and e2e/* sources that resolve across a
//                        forbidden boundary (relative paths escaping the tree, a
//                        bare specifier naming an e2e workspace package, or a
//                        bare specifier naming an archived legacy package).
//   2. tsconfig paths  — compilerOptions.paths targets (own or inherited via the
//                        `extends` chain) that resolve across a forbidden
//                        boundary, keyed by the owning tsconfig's tree.
//   3. package deps    — a packages/* manifest declaring an e2e workspace
//                        package in any dependency map.
//
// REVISION 2026-07-20 (review-driven): specifier extraction is now an oxc-parser
// AST walk for the TS/JS family, replacing the archived change's design note D4
// ("regex, not AST", zero-dependency). Two review findings forced the change: a
// code-looking string literal (`const s = "require('../legacy/core')"`) was
// flagged as a false positive, and the comment-stripping blind spots were
// fragile. oxc gives us genuine syntactic specifiers (ImportDeclaration /
// ExportNamedDeclaration / ExportAllDeclaration `.source`, ImportExpression
// string args, and `require(...)` / `import x = require(...)` calls) with no
// string/comment ambiguity. Parse failures FAIL LOUD — a file the checker
// cannot parse is a file it cannot clear. The regex fallback survives only for
// .mdx, whose top-level ESM import lines oxc does not parse. The archived design
// record stays as-is; this comment is the dated correction of record.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
// oxc-parser is the repo's pinned in-process AST surface (same devDep and
// TS-ESTree `parseSync` → `{ program, errors, comments }` contract used by
// scripts/hygiene/delete-unused.ts). See langForParser() for the dialect pin.
import { parseSync } from 'oxc-parser';

export type Tree = 'packages' | 'e2e' | 'legacy' | 'other';
export type Vector = 'import' | 'tsconfig-path' | 'package-dependency';

export interface Violation {
  vector: Vector;
  file: string; // repo-relative
  from: Tree;
  to: Tree;
  detail: string;
}

// Directories that never hold authored, boundary-relevant source: build
// outputs, vendored code, and generated staging trees. Pruned during the walk.
const PRUNE_DIRS = new Set([
  '.animus',
  '.git',
  '.next',
  '.react-router',
  '.staging',
  '.turbo',
  '.vite',
  '.wrangler',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'target',
]);

// Excluded wholesale (dir prefixes) or by exact path (files). Preserved with
// prefix semantics: `rel === entry` matches a single file, `rel.startsWith(entry
// + sep)` matches a subtree.
//   - packages/_parity/corpus: byte-precise adversarial extraction/formatting
//     fixtures, not code subject to the topology rule.
//   - the extract-v2 napi loader + its typings are authored by `napi build`, not
//     by hand; excluded on the same rationale as the vite.config.ts fmt
//     ignorePatterns precedent (a generated file is not a topology source).
// (Build outputs — dist/build/target/node_modules/.staging — are pruned by
// PRUNE_DIRS during the walk, so they need no entry here.)
const EXCLUDE_PREFIXES = [
  'packages/_parity/corpus',
  'packages/extract/crates/extract-v2/index.js',
  'packages/extract/crates/extract-v2/index.d.ts',
];

// Authored source across the whole ESM-import surface: TS family (ts/tsx/mts/
// cts), JS family (js/jsx/mjs/cjs — packages/extract/index-v2.js is hand-written
// and MDX carries ESM imports), and MDX. .d.ts is included (it ends in .ts) so
// generated typings must be excluded by path above, not by extension.
const SOURCE_EXT = /\.(?:tsx?|mts|cts|jsx?|mjs|cjs|mdx)$/;
const TSCONFIG_NAME = /^tsconfig.*\.json$/;
// Bound on `extends` chain traversal — cycle/pathological-depth guard.
const MAX_EXTENDS_DEPTH = 32;
const DEPENDENCY_MAPS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

// The forbidden edges of the one-way rule. Every other edge — notably
// e2e -> packages, and anything from/to 'other' (repo root, tooling) — is
// permitted.
export function isForbidden(from: Tree, to: Tree): boolean {
  if (from === 'packages') return to === 'e2e' || to === 'legacy';
  if (from === 'e2e') return to === 'legacy';
  return false;
}

// Classifies an absolute path by its top-level segment relative to the repo
// root. Paths outside the repo (or at its root) are 'other' and cannot
// participate in a forbidden edge.
export function classifyTree(repoRoot: string, absPath: string): Tree {
  const rel = relative(repoRoot, absPath);
  if (rel === '' || rel.startsWith('..')) return 'other';
  const top = rel.split(sep)[0];
  if (top === 'packages') return 'packages';
  if (top === 'e2e') return 'e2e';
  if (top === 'legacy') return 'legacy';
  return 'other';
}

// Removes JS/TS line and block comments while preserving string-literal
// contents (import specifiers live inside strings). String scanning honours
// backslash escapes so a quote inside a string cannot terminate it early.
export function stripComments(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    if (c === '"' || c === "'" || c === '`') {
      out += c;
      i += 1;
      while (i < n) {
        if (source[i] === '\\') {
          out += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += source[i];
        if (source[i] === c) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    const two = source.slice(i, i + 2);
    if (two === '//') {
      const nl = source.indexOf('\n', i);
      if (nl === -1) break;
      i = nl;
      continue;
    }
    if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      out += ' ';
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

export interface Specifier {
  kind: 'import' | 'export' | 'require' | 'dynamic-import';
  value: string;
}

// Thrown when oxc cannot parse an in-scope source file. FAIL LOUD: a file the
// checker cannot parse is a file it cannot clear (it may hide a real edge).
export class TopologyParseError extends Error {
  constructor(filename: string, detail: string) {
    super(`topology: failed to parse ${filename}: ${detail}`);
    this.name = 'TopologyParseError';
  }
}

// oxc deduces the dialect from the filename, but fixtures and the broadened
// scan hand it non-canonical names, so we pin `lang` (mirrors delete-unused.ts's
// langFor). Deviation from that precedent: authored `.js` in this React design
// system can carry JSX, and oxc's `js` dialect rejects JSX — so the whole JS
// family parses as `jsx` (a superset that also accepts plain JS/CJS) to avoid a
// fail-loud false positive on a legitimate JSX-bearing `.js`.
function langForParser(filename: string): 'ts' | 'tsx' | 'jsx' {
  if (filename.endsWith('.tsx')) return 'tsx';
  if (
    filename.endsWith('.jsx') ||
    filename.endsWith('.js') ||
    filename.endsWith('.mjs') ||
    filename.endsWith('.cjs')
  ) {
    return 'jsx';
  }
  return 'ts';
}

// A minimal structural node view — oxc emits a TS-ESTree AST whose nodes carry a
// string `type`; children are reached by walking own enumerable values.
type OxcNode = { type?: unknown; [key: string]: unknown };

function isOxcNode(value: unknown): value is OxcNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

function literalStringValue(node: unknown): string | undefined {
  if (isOxcNode(node) && node.type === 'Literal') {
    const { value } = node as { value?: unknown };
    if (typeof value === 'string') return value;
  }
  return undefined;
}

// Collects every genuine syntactic module specifier from an oxc AST. Only real
// specifier positions count — a code-looking string or template literal never
// does, because it is a Literal/TemplateLiteral, not one of these nodes.
function collectSpecifiers(node: unknown, out: Specifier[]): void {
  if (Array.isArray(node)) {
    for (const el of node) collectSpecifiers(el, out);
    return;
  }
  if (!isOxcNode(node)) return;

  switch (node.type) {
    case 'ImportDeclaration': {
      // Covers `import x from 'y'` and side-effect `import 'y'` alike.
      const v = literalStringValue(node.source);
      if (v !== undefined) out.push({ kind: 'import', value: v });
      break;
    }
    case 'ExportNamedDeclaration':
    case 'ExportAllDeclaration': {
      // `export … from 'y'` / `export * from 'y'`; a bare export has no source.
      const v = literalStringValue(node.source);
      if (v !== undefined) out.push({ kind: 'export', value: v });
      break;
    }
    case 'ImportExpression': {
      // `import('y')` — only a static string arg is a resolvable specifier;
      // `import(expr)` / `import(`…`)` cannot be, and are skipped.
      const v = literalStringValue(node.source);
      if (v !== undefined) out.push({ kind: 'dynamic-import', value: v });
      break;
    }
    case 'TSImportEqualsDeclaration': {
      // `import x = require('y')` — CJS via a TS external module reference.
      const mr = node.moduleReference;
      if (isOxcNode(mr) && mr.type === 'TSExternalModuleReference') {
        const v = literalStringValue(
          (mr as { expression?: unknown }).expression
        );
        if (v !== undefined) out.push({ kind: 'require', value: v });
      }
      break;
    }
    case 'CallExpression': {
      // `require('y')` — a call to the bare `require` identifier.
      const callee = node.callee;
      const args = node.arguments;
      if (
        isOxcNode(callee) &&
        callee.type === 'Identifier' &&
        (callee as { name?: unknown }).name === 'require' &&
        Array.isArray(args) &&
        args.length >= 1
      ) {
        const v = literalStringValue(args[0]);
        if (v !== undefined) out.push({ kind: 'require', value: v });
      }
      break;
    }
    default:
      break;
  }

  for (const key of Object.keys(node)) {
    if (key === 'type') continue;
    collectSpecifiers(node[key], out);
  }
}

// MDX is not JS — oxc does not parse it — so its top-level ESM import/export
// lines are matched with a narrow regex. Only column-0 statements outside fenced
// code blocks count: real MDX imports (rendered components) live at the module
// top level, while `import`/`export` lines inside ``` / ~~~ fences are
// illustrative examples, not this document's dependencies.
function extractMdxSpecifiers(source: string): Specifier[] {
  const out: Specifier[] = [];
  let inFence = false;
  const fromClause = /^(import|export)\b.*?\bfrom\s*['"]([^'"]+)['"]/;
  const sideEffect = /^import\s+['"]([^'"]+)['"]/;
  for (const line of source.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const fm = fromClause.exec(line);
    if (fm) {
      out.push({
        kind: fm[1] === 'export' ? 'export' : 'import',
        value: fm[2],
      });
      continue;
    }
    const sm = sideEffect.exec(line);
    if (sm) out.push({ kind: 'import', value: sm[1] });
  }
  return out;
}

// Extracts every module specifier from a source file. `filename` selects the
// extraction strategy and pins the oxc dialect; it defaults to a TS dialect so
// callers holding only a source string (e.g. unit tests) parse as TypeScript.
// FAIL LOUD on a parse error for the AST family; MDX stays regex.
export function extractSpecifiers(
  source: string,
  filename = 'inline.ts'
): Specifier[] {
  if (filename.endsWith('.mdx')) return extractMdxSpecifiers(source);

  const result = parseSync(filename, source, { lang: langForParser(filename) });
  const errors = (result.errors ?? []).filter(
    (e) => (e as { severity?: unknown }).severity === 'Error'
  );
  if (errors.length > 0) {
    const detail =
      (errors[0] as { message?: unknown }).message?.toString() ??
      'unknown parse error';
    throw new TopologyParseError(filename, detail);
  }
  const out: Specifier[] = [];
  collectSpecifiers((result as { program?: unknown }).program, out);
  return out;
}

// Resolves a specifier to the tree it targets, or null when it is an external
// dependency the rule does not track. Relative specifiers resolve against the
// importing file; a bare specifier matters when it names an e2e workspace
// package (resolves to e2e) or an archived legacy package (resolves to legacy).
export function resolveSpecifierTree(
  repoRoot: string,
  fileAbs: string,
  spec: string,
  e2eNames: readonly string[],
  // Archived legacy package names (see deriveArchivedNames). Defaults empty so
  // callers that predate the archived-name vector keep their old behavior.
  legacyNames: readonly string[] = []
): Tree | null {
  if (spec.startsWith('.')) {
    return classifyTree(repoRoot, resolve(dirname(fileAbs), spec));
  }
  for (const name of e2eNames) {
    if (spec === name || spec.startsWith(`${name}/`)) return 'e2e';
  }
  for (const name of legacyNames) {
    if (spec === name || spec.startsWith(`${name}/`)) return 'legacy';
  }
  return null;
}

// Derives the archived-package name set from the legacy/* directory layout.
//
// Rationale (registry resolution, not workspace resolution): legacy/* has no
// package.json, so these names are unreachable as *workspace* packages — but
// @animus-ui/core, @animus-ui/theming, @animus-ui/runtime, and @animus-ui/ui
// were historically published and still resolve on the public registry. A bare
// import of one pulls archived code back into the active graph, which the
// One-Way Rule forbids ("the active graph must not depend on archived code").
// The set is derived dynamically from the on-disk legacy/* directory names
// (prefixed @animus-ui/) rather than hardcoded: the arch-workspace-topology spec
// does not literally enumerate the archived packages, so the directory layout is
// the authoritative source. legacy/** itself is never scanned as a source (the
// walk roots are packages/* and e2e/* only), so it cannot self-trigger.
export function deriveArchivedNames(repoRoot: string): string[] {
  const base = join(repoRoot, 'legacy');
  if (!existsSync(base)) return [];
  let entries;
  try {
    entries = readdirSync(base, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => `@animus-ui/${entry.name}`)
    .sort();
}

function isExcludedPath(rel: string): boolean {
  return EXCLUDE_PREFIXES.some(
    (prefix) => rel === prefix || rel.startsWith(`${prefix}${sep}`)
  );
}

function walk(
  dir: string,
  repoRoot: string,
  match: RegExp,
  acc: string[]
): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (isExcludedPath(relative(repoRoot, full))) continue;
    if (entry.isDirectory()) {
      if (PRUNE_DIRS.has(entry.name)) continue;
      walk(full, repoRoot, match, acc);
    } else if (entry.isFile() && match.test(entry.name)) {
      acc.push(full);
    }
  }
}

function topLevelDirs(repoRoot: string, tree: 'packages' | 'e2e'): string[] {
  const base = join(repoRoot, tree);
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(base, entry.name));
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

// tsconfig files are JSONC: comment-strip, then drop trailing commas before
// JSON.parse. Good enough to reach compilerOptions.paths without a full parser.
function readJsonc(path: string): unknown {
  try {
    const stripped = stripComments(readFileSync(path, 'utf8')).replace(
      /,(\s*[}\]])/g,
      '$1'
    );
    return JSON.parse(stripped);
  } catch {
    return undefined;
  }
}

// Reads the workspace package name of every e2e/* member that has a manifest.
export function readE2ePackageNames(repoRoot: string): string[] {
  const base = join(repoRoot, 'e2e');
  if (!existsSync(base)) return [];
  const names: string[] = [];
  for (const dir of topLevelDirs(repoRoot, 'e2e')) {
    const manifest = join(dir, 'package.json');
    if (!existsSync(manifest)) continue;
    const parsed = readJson(manifest) as { name?: unknown } | undefined;
    if (parsed && typeof parsed.name === 'string' && parsed.name) {
      names.push(parsed.name);
    }
  }
  return names.sort();
}

// Vector 1 — source imports across a forbidden boundary.
export function scanSourceImports(repoRoot: string): Violation[] {
  const e2eNames = readE2ePackageNames(repoRoot);
  const legacyNames = deriveArchivedNames(repoRoot);
  const files: string[] = [];
  for (const tree of ['packages', 'e2e'] as const) {
    for (const dir of topLevelDirs(repoRoot, tree)) {
      walk(dir, repoRoot, SOURCE_EXT, files);
    }
  }
  files.sort();

  const violations: Violation[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const from = classifyTree(repoRoot, file);
    if (from !== 'packages' && from !== 'e2e') continue;
    // extractSpecifiers FAILs LOUD on an unparseable AST-family file; the throw
    // propagates so the checker cannot silently clear a file it cannot read.
    for (const spec of extractSpecifiers(readFileSync(file, 'utf8'), file)) {
      const to = resolveSpecifierTree(
        repoRoot,
        file,
        spec.value,
        e2eNames,
        legacyNames
      );
      if (to === null || !isForbidden(from, to)) continue;
      const rel = relative(repoRoot, file);
      const key = `${rel}::${spec.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      violations.push({
        vector: 'import',
        file: rel,
        from,
        to,
        detail: `${spec.kind} '${spec.value}'`,
      });
    }
  }
  return violations;
}

// Normalizes an `extends` target (or a walk-found tsconfig path) to a concrete
// file, applying tsc's resolution shortcuts: an exact file, a `.json`-appended
// file, or a directory's `tsconfig.json`. Returns undefined when nothing exists
// (a missing parent is skipped silently, as this checker treats it).
function resolveTsconfigFile(p: string): string | undefined {
  if (existsSync(p)) {
    if (statSync(p).isFile()) return p;
    if (statSync(p).isDirectory()) {
      const nested = join(p, 'tsconfig.json');
      return existsSync(nested) ? nested : undefined;
    }
  }
  const withJson = p.endsWith('.json') ? p : `${p}.json`;
  return existsSync(withJson) ? withJson : undefined;
}

// Resolves one `extends` specifier to a concrete config file. Relative
// specifiers resolve against the extending config's directory; package-style
// specifiers resolve node_modules upward from that directory, bounded at
// repoRoot so resolution never escapes the repo. Missing → undefined (skipped).
function resolveExtendsSpecifier(
  spec: string,
  fromDir: string,
  repoRoot: string
): string | undefined {
  if (spec.startsWith('.')) {
    return resolveTsconfigFile(resolve(fromDir, spec));
  }
  let dir = fromDir;
  for (;;) {
    const candidate = resolveTsconfigFile(join(dir, 'node_modules', spec));
    if (candidate) return candidate;
    if (dir === repoRoot) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

// The subset of effective compilerOptions the topology rule needs, resolved
// down an `extends` chain with exact TypeScript semantics.
interface EffectivePaths {
  // The winning `paths` map and the directory it was declared in (its anchor
  // when no baseUrl overrides it).
  targets?: { map: Record<string, unknown>; dir: string };
  // The directory an explicit `baseUrl` resolves to, if any config set one.
  baseUrlDir?: string;
}

// Computes effective `paths`/`baseUrl` for a config file, following `extends`
// with TypeScript override semantics:
//   - extends is applied first (arrays left-to-right, later entries override
//     earlier), then the config's own options override the inherited result;
//   - `paths` REPLACES wholesale (a config declaring its own `paths` discards
//     the inherited map entirely — there is no per-alias merge);
//   - `baseUrl` is tracked independently, so a `paths` inherited from one config
//     and a `baseUrl` set in another compose the way tsc resolves them.
// Missing parents are skipped silently; depth and a per-branch visited set guard
// against cycles and pathological chains.
function computeEffectivePaths(
  file: string,
  repoRoot: string,
  seen: Set<string>,
  depth: number
): EffectivePaths {
  const resolved = resolveTsconfigFile(file);
  if (!resolved || seen.has(resolved) || depth > MAX_EXTENDS_DEPTH) return {};
  seen.add(resolved);

  const config = readJsonc(resolved) as
    | {
        extends?: unknown;
        compilerOptions?: { baseUrl?: unknown; paths?: unknown };
      }
    | undefined;
  if (!config || typeof config !== 'object') return {};

  const eff: EffectivePaths = {};

  // 1. Inherit from extends (arrays: later overrides earlier).
  const ext = config.extends;
  const parents = Array.isArray(ext)
    ? ext
    : typeof ext === 'string'
      ? [ext]
      : [];
  for (const parent of parents) {
    if (typeof parent !== 'string') continue;
    const parentFile = resolveExtendsSpecifier(
      parent,
      dirname(resolved),
      repoRoot
    );
    if (!parentFile) continue; // missing parent skipped silently
    const inherited = computeEffectivePaths(
      parentFile,
      repoRoot,
      new Set(seen),
      depth + 1
    );
    if (inherited.targets) eff.targets = inherited.targets;
    if (inherited.baseUrlDir) eff.baseUrlDir = inherited.baseUrlDir;
  }

  // 2. Own options override inherited.
  const options = config.compilerOptions;
  if (options && typeof options === 'object') {
    if (typeof options.baseUrl === 'string') {
      eff.baseUrlDir = resolve(dirname(resolved), options.baseUrl);
    }
    if (options.paths && typeof options.paths === 'object') {
      eff.targets = {
        map: options.paths as Record<string, unknown>,
        dir: dirname(resolved),
      };
    }
  }

  return eff;
}

// Vector 2 — tsconfig compilerOptions.paths aliases across a forbidden boundary.
// Effective paths include those inherited via the `extends` chain, not just the
// physically-present ones (TypeScript override semantics — see
// computeEffectivePaths).
export function scanTsconfigPaths(repoRoot: string): Violation[] {
  const files: string[] = [];
  for (const tree of ['packages', 'e2e'] as const) {
    for (const dir of topLevelDirs(repoRoot, tree)) {
      walk(dir, repoRoot, TSCONFIG_NAME, files);
    }
  }
  files.sort();

  const violations: Violation[] = [];
  for (const file of files) {
    const owner = classifyTree(repoRoot, file);
    if (owner !== 'packages' && owner !== 'e2e') continue;
    const eff = computeEffectivePaths(file, repoRoot, new Set(), 0);
    if (!eff.targets) continue;
    // Path targets resolve against baseUrl when any config in the chain set one,
    // otherwise against the directory of the config that declared `paths`.
    const baseDir = eff.baseUrlDir ?? eff.targets.dir;

    for (const [alias, targets] of Object.entries(eff.targets.map)) {
      if (!Array.isArray(targets)) continue;
      for (const target of targets) {
        if (typeof target !== 'string') continue;
        const abs = resolve(baseDir, target.replace(/\*/g, ''));
        const to = classifyTree(repoRoot, abs);
        if (!isForbidden(owner, to)) continue;
        violations.push({
          vector: 'tsconfig-path',
          file: relative(repoRoot, file),
          from: owner,
          to,
          detail: `paths["${alias}"] -> "${target}"`,
        });
      }
    }
  }
  return violations;
}

// Vector 3 — a packages/* manifest declaring an e2e workspace dependency.
export function scanPackageDependencies(repoRoot: string): Violation[] {
  const e2eNames = new Set(readE2ePackageNames(repoRoot));
  const violations: Violation[] = [];
  for (const dir of topLevelDirs(repoRoot, 'packages')) {
    const manifest = join(dir, 'package.json');
    if (!existsSync(manifest)) continue;
    const parsed = readJson(manifest) as Record<string, unknown> | undefined;
    if (!parsed) continue;
    for (const mapName of DEPENDENCY_MAPS) {
      const map = parsed[mapName];
      if (!map || typeof map !== 'object') continue;
      for (const dep of Object.keys(map as Record<string, unknown>)) {
        if (!e2eNames.has(dep)) continue;
        violations.push({
          vector: 'package-dependency',
          file: relative(repoRoot, manifest),
          from: 'packages',
          to: 'e2e',
          detail: `${mapName}["${dep}"]`,
        });
      }
    }
  }
  return violations;
}

export function collectViolations(repoRoot: string): Violation[] {
  return [
    ...scanSourceImports(repoRoot),
    ...scanTsconfigPaths(repoRoot),
    ...scanPackageDependencies(repoRoot),
  ];
}

export function formatReport(violations: Violation[]): string {
  const lines = [
    'ERROR: workspace topology violation(s) — forbidden cross-boundary dependency.',
    '  One-Way Dependency Rule (AGENTS.md § Workspace Topology): packages/* must',
    '  not import e2e/* or legacy/*; e2e/* must not import legacy/*.',
  ];
  for (const v of violations) {
    lines.push(`  ${v.file}: [${v.vector}] ${v.from} -> ${v.to}: ${v.detail}`);
  }
  lines.push(
    '  Run: remove the offending reference(s) so dependencies flow top-down only',
    '  (e2e/* -> packages/*); shared helpers belong in packages/_assertions.'
  );
  return lines.join('\n');
}

export function main(repoRoot: string): number {
  const violations = collectViolations(repoRoot);
  if (violations.length === 0) {
    console.log(
      '[topology] workspace boundaries clean — no packages->e2e, packages->legacy, or e2e->legacy edges'
    );
    return 0;
  }
  console.error(formatReport(violations));
  return 1;
}

if (import.meta.main) {
  const arg = process.argv[2];
  const root = arg ? resolve(arg) : resolve(import.meta.dirname, '../..');
  if (!statSync(root).isDirectory()) {
    console.error(`ERROR: not a directory: ${root}`);
    process.exit(2);
  }
  process.exit(main(root));
}
