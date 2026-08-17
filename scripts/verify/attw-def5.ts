#!/usr/bin/env bun
// scripts/verify/attw-def5.ts
//
// Bounded DEF-5 type-resolution gate (design D5/DEF-2, guardrail G6, spec
// "Suppressed type diagnostics remain bounded"). Replaces the broad
// `attw --ignore-rules internal-resolution-error` allowlist with an exact-set
// validator: the ESM-only-visible InternalResolutionError diagnostics for
// @animus-ui/properties and @animus-ui/system must match the captured DEF-5 set
// EXACTLY. It fails closed on:
//   - an ADDITIONAL internal-resolution-error (a new declaration import that
//     fails node16-ESM resolution), OR
//   - a REMOVAL (an accepted DEF-5 diagnostic that now resolves — the exemption
//     is obsolete and must be trimmed), OR
//   - any OTHER esm-only-visible problem kind (a new failure of a different
//     shape must not slip through the narrowed gate).
//
// Empirical basis (attw 0.18.5, TypeScript 7.0.2 declaration emit): the DEF-5
// gap still reproduces — properties/system source uses extensionless relative
// imports under `moduleResolution: bundler`, which the compiler emits verbatim;
// those specifiers fail node16-ESM resolution. Migrating every specifier to
// explicit `.js` extensions is a cross-cutting source change out of this
// increment's scope, so the diagnostics are bounded exactly rather than removed.
//
// Set semantics: duplicate occurrences of the same (file, specifier) tuple
// collapse to one, so a repeated diagnostic never turns an exact-match baseline
// into a spurious addition; and problems whose resolution tag is node10 or
// node16-cjs are invisible to the gate regardless of kind, because the esm-only
// profile already ignores those two resolution kinds. A missing or non-object
// analysis (null, undefined, unparseable stdin) fails closed rather than passing
// vacuously — attw exits non-zero on findings, so a caller that forgets
// `|| true` would otherwise hand this validator an empty document.
//
// Usage (packed.sh pipes attw JSON in; attw exits non-zero on findings, so the
// caller captures its output with `|| true` and this validator owns the verdict):
//   bunx attw <tgz> --profile esm-only -f json | \
//     bun scripts/verify/attw-def5.ts check @animus-ui/<pkg>

import { readFileSync } from 'node:fs';

export interface Def5Tuple {
  file: string; // path relative to the package root, e.g. dist/index.d.ts
  specifier: string; // the unresolved module specifier, e.g. ./shorthands
}

/**
 * The accepted DEF-5 sets, keyed by published package name. Open by design: a
 * package enters the gate by gaining an entry here, and `main` rejects a
 * package name this map does not carry.
 */
interface Def5Baseline {
  [packageName: string]: Def5Tuple[];
}

// The exact accepted DEF-5 diagnostic set, captured from a fresh `build:ts`
// declaration emit + `bunx attw --profile esm-only -f json` (no ignored rule).
// Regenerate ONLY with a recorded rationale: any drift here is a real change in
// the published declaration surface. Keyed by published package name.
export const DEF5_BASELINE: Def5Baseline = {
  '@animus-ui/properties': [
    { file: 'dist/index.d.ts', specifier: './shorthands' },
    { file: 'dist/index.d.ts', specifier: './unitless' },
  ],
  '@animus-ui/system': [
    { file: 'dist/compose.d.ts', specifier: './types/component' },
    { file: 'dist/composeWithContext.d.ts', specifier: './types/component' },
    { file: 'dist/groups/index.d.ts', specifier: '..' },
    { file: 'dist/index.d.ts', specifier: './Animus' },
    { file: 'dist/index.d.ts', specifier: './AnimusExtended' },
    { file: 'dist/index.d.ts', specifier: './SystemBuilder' },
    { file: 'dist/index.d.ts', specifier: './compose' },
    { file: 'dist/index.d.ts', specifier: './keyframes' },
    { file: 'dist/index.d.ts', specifier: './runtime' },
    { file: 'dist/index.d.ts', specifier: './runtime/createClassResolver' },
    { file: 'dist/index.d.ts', specifier: './runtime/createComposedFamily' },
    { file: 'dist/index.d.ts', specifier: './scales/createScale' },
    { file: 'dist/index.d.ts', specifier: './selectors' },
    { file: 'dist/index.d.ts', specifier: './theme' },
    { file: 'dist/index.d.ts', specifier: './transforms/border' },
    { file: 'dist/index.d.ts', specifier: './transforms/createTransform' },
    { file: 'dist/index.d.ts', specifier: './transforms/grid' },
    { file: 'dist/index.d.ts', specifier: './transforms/size' },
    { file: 'dist/index.d.ts', specifier: './types/component' },
    { file: 'dist/index.d.ts', specifier: './types/config' },
    { file: 'dist/index.d.ts', specifier: './types/props' },
    { file: 'dist/index.d.ts', specifier: './types/scales' },
    { file: 'dist/index.d.ts', specifier: './types/shared' },
    { file: 'dist/index.d.ts', specifier: './types/theme' },
    { file: 'dist/runtime-entry.d.ts', specifier: './runtime' },
    {
      file: 'dist/runtime-entry.d.ts',
      specifier: './runtime/createClassResolver',
    },
    {
      file: 'dist/runtime-entry.d.ts',
      specifier: './runtime/createComposedFamily',
    },
  ],
};

// esm-only profile ignores exactly these two resolution kinds (attw 0.18.5). A
// problem tagged with either is invisible to the gate; everything else counts.
export const ESM_ONLY_IGNORED_RESOLUTIONS = new Set(['node10', 'node16-cjs']);

// TypeScript ModuleKind: 99 = ESNext (ESM), 1 = CommonJS. attw reports the mode
// a fine-grained problem was observed under.
const MODULE_KIND_ESM = 99;

/**
 * A value read out of `attw -f json`. attw owns and versions that schema
 * (0.18.5 here) and this gate reads seven fields of it, so the document is
 * admitted as a value domain and decided field by field rather than restated.
 */
type AttwValue =
  | undefined
  | null
  | boolean
  | number
  | string
  | AttwValue[]
  | AttwBlock;

interface AttwBlock {
  [key: string]: AttwValue;
}

// Decided by representation tag rather than by `typeof`: `[object Object]` is
// what separates a keyed block from a list, and the tag also rejects everything
// `JSON.parse` cannot produce.
function isAttwBlock(value: AttwValue): value is AttwBlock {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function isAttwText(value: AttwValue): value is string {
  return Object.prototype.toString.call(value) === '[object String]';
}

/** The seven fields of one `analysis.problems` entry that this gate reads. */
interface AttwProblem {
  kind?: AttwValue;
  resolutionKind?: AttwValue; // entrypoint-level problems: node10 | node16-cjs | ...
  resolutionOption?: AttwValue; // fine-grained problems: node10 | node16 | bundler
  resolutionMode?: AttwValue; // fine-grained problems: 99 (ESM) | 1 (CJS)
  fileName?: AttwValue;
  moduleSpecifier?: AttwValue;
  entrypoint?: AttwValue;
}

// A problems entry that is not a keyed block reads as a problem with no fields
// — NOT as a dropped entry. It then carries the 'unknown' resolution tag, stays
// esm-only-visible, and is reported as an added non-resolution problem, which
// is the fail-closed verdict a malformed entry must produce.
function readProblem(entry: AttwValue): AttwProblem {
  const block = isAttwBlock(entry) ? entry : {};
  return {
    kind: block.kind,
    resolutionKind: block.resolutionKind,
    resolutionOption: block.resolutionOption,
    resolutionMode: block.resolutionMode,
    fileName: block.fileName,
    moduleSpecifier: block.moduleSpecifier,
    entrypoint: block.entrypoint,
  };
}

// Normalizes a problem's resolution to the tag esm-only filters on. Entrypoint
// problems carry `resolutionKind` directly; fine-grained ones carry
// option+mode, where node16 splits into esm/cjs by module kind.
export function resolutionTag(p: AttwProblem): string {
  if (isAttwText(p.resolutionKind)) return p.resolutionKind;
  const opt = p.resolutionOption;
  if (opt === 'node16') {
    return p.resolutionMode === MODULE_KIND_ESM ? 'node16-esm' : 'node16-cjs';
  }
  if (isAttwText(opt)) return opt;
  return 'unknown';
}

export function isEsmOnlyVisible(p: AttwProblem): boolean {
  return !ESM_ONLY_IGNORED_RESOLUTIONS.has(resolutionTag(p));
}

function stripPackagePrefix(fileName: string, packageName: string): string {
  return fileName.replace(new RegExp(`^/node_modules/${packageName}/`), '');
}

function tupleKey(t: Def5Tuple): string {
  return `${t.file}\t${t.specifier}`;
}

export interface Def5Result {
  ok: boolean;
  messages: string[];
}

// Evaluates one package's attw analysis against its DEF-5 baseline. `analysis`
// is the `.analysis` object from `attw -f json`.
export function evaluateDef5(
  analysis: AttwValue,
  packageName: string
): Def5Result {
  const messages: string[] = [];
  if (!isAttwBlock(analysis)) {
    return {
      ok: false,
      messages: [
        `ERROR: attw analysis for ${packageName} is missing or malformed.`,
        '  Run: bunx attw <tgz> --profile esm-only -f json (from repo root).',
      ],
    };
  }
  const problemsRaw = analysis.problems;
  const problems = Array.isArray(problemsRaw)
    ? problemsRaw.map(readProblem)
    : [];

  const baseline = DEF5_BASELINE[packageName] ?? [];
  const baselineKeys = new Set(baseline.map(tupleKey));

  const visible = problems.filter(isEsmOnlyVisible);

  // 1. esm-only-visible problems that are NOT internal-resolution-error: the
  //    narrowed gate must not let a differently-shaped failure through.
  const otherVisible = visible.filter(
    (p) => p.kind !== 'InternalResolutionError'
  );
  for (const p of otherVisible) {
    const where = isAttwText(p.entrypoint)
      ? p.entrypoint
      : isAttwText(p.fileName)
        ? p.fileName
        : '<unknown>';
    messages.push(
      `ADDED non-resolution problem: ${String(p.kind)} at ${where} (${resolutionTag(p)})`
    );
  }

  // 2. Observed internal-resolution-error tuples (distinct file+specifier).
  const observedKeys = new Set<string>();
  for (const p of visible) {
    if (p.kind !== 'InternalResolutionError') continue;
    if (!isAttwText(p.fileName) || !isAttwText(p.moduleSpecifier)) continue;
    observedKeys.add(
      tupleKey({
        file: stripPackagePrefix(p.fileName, packageName),
        specifier: p.moduleSpecifier,
      })
    );
  }

  const additions = [...observedKeys]
    .filter((k) => !baselineKeys.has(k))
    .sort();
  const removals = [...baselineKeys].filter((k) => !observedKeys.has(k)).sort();

  for (const k of additions) {
    const [file, specifier] = k.split('\t');
    messages.push(
      `ADDED internal-resolution-error: ${file} imports '${specifier}' (fails node16-ESM resolution)`
    );
  }
  for (const k of removals) {
    const [file, specifier] = k.split('\t');
    messages.push(
      `REMOVED (now resolves): ${file} imports '${specifier}' — trim the DEF-5 baseline`
    );
  }

  const ok = messages.length === 0;
  if (ok) {
    messages.push(
      `[attw-def5] ${packageName}: ${observedKeys.size} bounded DEF-5 diagnostic(s), exact match`
    );
  }
  return { ok, messages };
}

function main(argv: string[]): number {
  const [mode, packageName] = argv;
  if (mode !== 'check' || !packageName) {
    console.error(
      'Usage: bun scripts/verify/attw-def5.ts check @animus-ui/<pkg>  (attw JSON on stdin)'
    );
    return 2;
  }
  if (!(packageName in DEF5_BASELINE)) {
    console.error(
      `ERROR: no DEF-5 baseline for ${packageName}. Known: ${Object.keys(DEF5_BASELINE).join(', ')}`
    );
    return 2;
  }
  const raw = readFileSync(0, 'utf8');
  let parsed: AttwValue;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(
      `ERROR: could not parse attw JSON for ${packageName} on stdin.`
    );
    console.error(
      '  attw exits non-zero on findings — capture its output with `|| true` and still pipe the JSON.'
    );
    return 2;
  }
  const analysis = isAttwBlock(parsed) ? parsed.analysis : undefined;
  const result = evaluateDef5(analysis, packageName);
  if (result.ok) {
    for (const line of result.messages) console.log(line);
    return 0;
  }
  console.error(
    `ERROR: DEF-5 bounded type-resolution gate failed for ${packageName} (G6 / bounded diagnostics).`
  );
  for (const line of result.messages) console.error(`  ${line}`);
  console.error(
    '  The published declarations changed the accepted internal-resolution-error set.'
  );
  console.error(
    '  Fix the declaration imports, or regenerate DEF5_BASELINE in scripts/verify/attw-def5.ts with a recorded rationale.'
  );
  return 1;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
