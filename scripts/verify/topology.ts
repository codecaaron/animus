#!/usr/bin/env bun

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { Visitor, parseSync } from 'oxc-parser';

import type { Argument, StringLiteral } from 'oxc-parser';

export type Tree = 'packages' | 'e2e' | 'legacy' | 'other';
export type Vector =
  | 'import'
  | 'tsconfig-path'
  | 'package-dependency'
  | 'fixture-sibling';

export interface Violation {
  vector: Vector;
  file: string; // repo-relative
  from: Tree;
  to: Tree;
  detail: string;
}

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

// Excluded by exact path or directory prefix: adversarial corpus fixtures, and
// the extract-v2 napi loader and typings, which `napi build` generates.
const EXCLUDE_PREFIXES = [
  'packages/_parity/corpus',
  'packages/extract/crates/extract-v2/index.js',
  'packages/extract/crates/extract-v2/index.d.ts',
];

// `.d.ts` matches (it ends in .ts), so generated typings need a path exclusion.
const SOURCE_EXT = /\.(?:tsx?|mts|cts|jsx?|mjs|cjs|mdx)$/;
const TSCONFIG_NAME = /^tsconfig.*\.json$/;
const MAX_EXTENDS_DEPTH = 32;
const DEPENDENCY_MAPS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

export function isForbidden(from: Tree, to: Tree): boolean {
  if (from === 'packages') return to === 'e2e' || to === 'legacy';
  if (from === 'e2e') return to === 'legacy';
  return false;
}

export function classifyTree(repoRoot: string, absPath: string): Tree {
  const rel = relative(repoRoot, absPath);
  if (rel === '' || rel.startsWith('..')) return 'other';
  const top = rel.split(sep)[0];
  if (top === 'packages') return 'packages';
  if (top === 'e2e') return 'e2e';
  if (top === 'legacy') return 'legacy';
  return 'other';
}

// Preserves string-literal contents, honouring escapes: import specifiers live
// inside strings.
export function stripTsComments(source: string): string {
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

// An unparseable file cannot be cleared: it may hide a forbidden edge.
export class TopologyParseError extends Error {
  constructor(filename: string, detail: string) {
    super(`topology: failed to parse ${filename}: ${detail}`);
    this.name = 'TopologyParseError';
  }
}

// oxc infers the dialect from the filename, so it is pinned here. The whole JS
// family parses as `jsx`: oxc's `js` dialect rejects JSX in an authored `.js`.
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

// oxc tags every literal kind as `Literal`, so the string kind is not in the
// tag; `String(value) === value` holds for a primitive string and nothing else.
function isStringLiteral(node: Argument): node is StringLiteral {
  return node.type === 'Literal' && String(node.value) === node.value;
}

// oxc does not parse MDX, so top-level ESM lines are matched by regex. Imports
// inside ``` or ~~~ fences are examples, not this document's dependencies.
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

// `filename` selects the extraction strategy and pins the oxc dialect.
export function extractSpecifiers(
  source: string,
  filename = 'inline.ts'
): Specifier[] {
  if (filename.endsWith('.mdx')) return extractMdxSpecifiers(source);

  const result = parseSync(filename, source, { lang: langForParser(filename) });
  const errors = result.errors.filter((e) => e.severity === 'Error');
  if (errors.length > 0) {
    throw new TopologyParseError(filename, errors[0].message);
  }

  // These visitors are the closed list of syntax that can name a module.
  const out: Specifier[] = [];
  new Visitor({
    ImportDeclaration(node) {
      out.push({ kind: 'import', value: node.source.value });
    },
    ExportNamedDeclaration(node) {
      if (node.source) out.push({ kind: 'export', value: node.source.value });
    },
    ExportAllDeclaration(node) {
      out.push({ kind: 'export', value: node.source.value });
    },
    ImportExpression(node) {
      if (isStringLiteral(node.source)) {
        out.push({ kind: 'dynamic-import', value: node.source.value });
      }
    },
    TSImportEqualsDeclaration(node) {
      const reference = node.moduleReference;
      if (reference.type === 'TSExternalModuleReference') {
        out.push({ kind: 'require', value: reference.expression.value });
      }
    },
    CallExpression(node) {
      const [first] = node.arguments;
      if (
        node.callee.type === 'Identifier' &&
        node.callee.name === 'require' &&
        first !== undefined &&
        isStringLiteral(first)
      ) {
        out.push({ kind: 'require', value: first.value });
      }
    },
  }).visit(result.program);
  return out;
}

// Resolves a specifier to the tree it targets, or null for an external
// dependency the rule does not track.
export function resolveSpecifierTree(
  repoRoot: string,
  fileAbs: string,
  spec: string,
  e2eNames: readonly string[],
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

// legacy/* has no package.json, but the @animus-ui/* names were published and
// still resolve on the registry, so a bare import reaches archived code.
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

// Not the shared `@animus-ui/assertions` vocabulary: this script runs under bun
// with no build step, so no workspace package's dist is reachable.
type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

interface JsonObject {
  [key: string]: JsonValue;
}

// Tag-based, not `typeof`: `typeof` admits arrays and null as objects.
function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function isJsonString(value: JsonValue | undefined): value is string {
  return Object.prototype.toString.call(value) === '[object String]';
}

function readJson(path: string): JsonValue | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

// tsconfig is JSONC: strip comments and trailing commas. Enough to reach
// compilerOptions.paths without a full parser.
function readJsonc(path: string): JsonValue | undefined {
  try {
    const stripped = stripTsComments(readFileSync(path, 'utf8')).replace(
      /,(\s*[}\]])/g,
      '$1'
    );
    return JSON.parse(stripped);
  } catch {
    return undefined;
  }
}

export function readE2ePackageNames(repoRoot: string): string[] {
  return [...e2eMembersByName(repoRoot).keys()].sort();
}

// The e2e fixture directory name owning an absolute path.
export function e2eMember(
  repoRoot: string,
  absPath: string
): string | undefined {
  const rel = relative(repoRoot, absPath);
  if (rel === '' || rel.startsWith('..')) return undefined;
  const parts = rel.split(sep);
  return parts[0] === 'e2e' && parts.length > 1 ? parts[1] : undefined;
}

// Workspace package name -> owning e2e fixture directory.
export function e2eMembersByName(repoRoot: string): Map<string, string> {
  const byName = new Map<string, string>();
  for (const dir of topLevelDirs(repoRoot, 'e2e')) {
    const manifest = join(dir, 'package.json');
    if (!existsSync(manifest)) continue;
    const parsed = readJson(manifest);
    if (isJsonObject(parsed) && isJsonString(parsed.name) && parsed.name) {
      const member = e2eMember(repoRoot, dir);
      if (member !== undefined) byName.set(parsed.name, member);
    }
  }
  return byName;
}

// Each e2e fixture stays self-contained. Sibling and self are both e2e -> e2e,
// so the tree rule cannot express this edge and members are compared here.
export function scanFixtureSiblingImports(repoRoot: string): Violation[] {
  const membersByName = e2eMembersByName(repoRoot);
  const files: string[] = [];
  for (const dir of topLevelDirs(repoRoot, 'e2e')) {
    walk(dir, repoRoot, SOURCE_EXT, files);
  }
  files.sort();

  const violations: Violation[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const fromMember = e2eMember(repoRoot, file);
    if (fromMember === undefined) continue;
    for (const spec of extractSpecifiers(readFileSync(file, 'utf8'), file)) {
      let toMember: string | undefined;
      if (spec.value.startsWith('.')) {
        toMember = e2eMember(repoRoot, resolve(dirname(file), spec.value));
      } else {
        for (const [name, member] of membersByName) {
          if (spec.value === name || spec.value.startsWith(`${name}/`)) {
            toMember = member;
            break;
          }
        }
      }
      if (toMember === undefined || toMember === fromMember) continue;
      const rel = relative(repoRoot, file);
      const key = `${rel}::${spec.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      violations.push({
        vector: 'fixture-sibling',
        file: rel,
        from: 'e2e',
        to: 'e2e',
        detail: `imports e2e/${toMember} via '${spec.value}'`,
      });
    }
  }
  return violations;
}

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

// Applies tsc's resolution shortcuts: an exact file, a `.json`-appended file,
// or a directory's tsconfig.json. A missing target is skipped.
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

// Relative specifiers resolve against the extending config's directory;
// package-style ones walk node_modules upward, bounded at repoRoot.
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

interface EffectivePaths {
  // The winning `paths` map and the directory it was declared in.
  targets?: { map: JsonObject; dir: string };
  baseUrlDir?: string;
}

// Follows tsc override semantics: `extends` applies first (arrays left to
// right), own options win, and `paths` replaces wholesale rather than merging.
function computeEffectivePaths(
  file: string,
  repoRoot: string,
  seen: Set<string>,
  depth: number
): EffectivePaths {
  const resolved = resolveTsconfigFile(file);
  if (!resolved || seen.has(resolved) || depth > MAX_EXTENDS_DEPTH) return {};
  seen.add(resolved);

  const config = readJsonc(resolved);
  if (!isJsonObject(config)) return {};

  const eff: EffectivePaths = {};

  const ext = config.extends;
  const parents = Array.isArray(ext) ? ext : isJsonString(ext) ? [ext] : [];
  for (const parent of parents) {
    if (!isJsonString(parent)) continue;
    const parentFile = resolveExtendsSpecifier(
      parent,
      dirname(resolved),
      repoRoot
    );
    if (!parentFile) continue;
    const inherited = computeEffectivePaths(
      parentFile,
      repoRoot,
      new Set(seen),
      depth + 1
    );
    if (inherited.targets) eff.targets = inherited.targets;
    if (inherited.baseUrlDir) eff.baseUrlDir = inherited.baseUrlDir;
  }

  const options = config.compilerOptions;
  if (isJsonObject(options)) {
    const { baseUrl, paths } = options;
    if (isJsonString(baseUrl)) {
      eff.baseUrlDir = resolve(dirname(resolved), baseUrl);
    }
    if (isJsonObject(paths)) {
      eff.targets = { map: paths, dir: dirname(resolved) };
    }
  }

  return eff;
}

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
    const baseDir = eff.baseUrlDir ?? eff.targets.dir;

    for (const [alias, targets] of Object.entries(eff.targets.map)) {
      if (!Array.isArray(targets)) continue;
      for (const target of targets) {
        if (!isJsonString(target)) continue;
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

export function scanPackageDependencies(repoRoot: string): Violation[] {
  const e2eNames = new Set(readE2ePackageNames(repoRoot));
  const legacyNames = new Set(deriveArchivedNames(repoRoot));
  const violations: Violation[] = [];
  for (const tree of ['packages', 'e2e'] as const) {
    for (const dir of topLevelDirs(repoRoot, tree)) {
      const manifest = join(dir, 'package.json');
      if (!existsSync(manifest)) continue;
      const parsed = readJson(manifest);
      if (!isJsonObject(parsed)) continue;
      for (const mapName of DEPENDENCY_MAPS) {
        const map = parsed[mapName];
        if (!isJsonObject(map)) continue;
        for (const dep of Object.keys(map)) {
          const to = e2eNames.has(dep)
            ? 'e2e'
            : legacyNames.has(dep)
              ? 'legacy'
              : null;
          if (!to || !isForbidden(tree, to)) continue;
          violations.push({
            vector: 'package-dependency',
            file: relative(repoRoot, manifest),
            from: tree,
            to,
            detail: `${mapName}["${dep}"]`,
          });
        }
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
    ...scanFixtureSiblingImports(repoRoot),
  ];
}

export function formatReport(violations: Violation[]): string {
  const lines = [
    'ERROR: workspace topology violation(s) — forbidden cross-boundary dependency.',
    '  One-Way Dependency Rule (AGENTS.md § Workspace Topology): packages/* must',
    '  not import e2e/* or legacy/*; e2e/* must not import legacy/*. Each e2e',
    '  fixture stays self-contained: no imports from sibling e2e/* fixtures.',
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
      '[topology] workspace boundaries clean — no packages->e2e, packages->legacy, e2e->legacy, or e2e sibling-fixture imports'
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
