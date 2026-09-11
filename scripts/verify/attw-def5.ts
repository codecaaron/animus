#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

export interface Def5Tuple {
  file: string;
  specifier: string;
}

interface Def5Baseline {
  [packageName: string]: Def5Tuple[];
}

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

export const ESM_ONLY_IGNORED_RESOLUTIONS = new Set(['node10', 'node16-cjs']);

// 99 is TypeScript's ModuleKind.ESNext, the mode attw reports for ESM.
const MODULE_KIND_ESM = 99;

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

// `typeof` cannot separate a keyed block from a list or from null; the
// representation tag can.
function isAttwBlock(value: AttwValue): value is AttwBlock {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function isAttwText(value: AttwValue): value is string {
  return Object.prototype.toString.call(value) === '[object String]';
}

interface AttwProblem {
  kind?: AttwValue;
  resolutionKind?: AttwValue;
  resolutionOption?: AttwValue;
  resolutionMode?: AttwValue;
  fileName?: AttwValue;
  moduleSpecifier?: AttwValue;
  entrypoint?: AttwValue;
}

// A malformed entry reads as a problem with no fields, not as a dropped one,
// so it still reaches the verdict as an added non-resolution problem.
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
