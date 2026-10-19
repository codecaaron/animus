/**
 * Where a bundler writes, as one model: the directories it fills and the
 * files it writes by exact name. Discovery excludes both, and the Rollup
 * family's render check reads both, so the two never classify output
 * differently.
 */
import { relative, resolve, sep } from 'path';

import { outputExclusion, REPLACEABLE_DEFAULT_EXCLUDE } from './core-options';
import {
  ANALYSED_OUTPUT,
  hostFinding,
  OUTPUT_TREES,
} from './manifest-diagnostics';
import { isPathWithinRoot } from './source-identity';

import type { ManifestDiagnostic } from './manifest-diagnostics';

/** Absolute paths. A file target names only itself: an output written
 *  beside sources excludes none of them. */
export interface OutputTargets {
  dirs: string[];
  files: string[];
}

export function noOutputTargets(): OutputTargets {
  return { dirs: [], files: [] };
}

/** One bundler output's `dir` or `file`, against `base`. */
interface NamedOutput {
  dir?: string;
  file?: string;
}

/** Each output's named directory or file; one naming neither writes to
 *  `fallbackDir` when there is one. */
function targetsOf(
  base: string,
  outputs: readonly NamedOutput[],
  fallbackDir?: string
): OutputTargets {
  const targets = noOutputTargets();
  for (const output of outputs) {
    if (output.dir !== undefined) targets.dirs.push(resolve(base, output.dir));
    else if (output.file !== undefined)
      targets.files.push(resolve(base, output.file));
    else if (fallbackDir !== undefined)
      targets.dirs.push(resolve(base, fallbackDir));
  }
  return targets;
}

/** The targets of Rollup's or Rolldown's output options at render. */
export function rollupOutputTargets(output: NamedOutput): OutputTargets {
  return targetsOf(process.cwd(), [output]);
}

interface ViteBuildLike {
  outDir: string;
  rollupOptions?: { output?: NamedOutput | NamedOutput[] };
  rolldownOptions?: { output?: NamedOutput | NamedOutput[] };
}

/** Every Vite environment's outputs, as Vite's own `getResolvedOutDirs`
 *  reads them: each output's `dir`, else the environment's `outDir`. */
export function viteOutputTargets(config: {
  root: string;
  build: ViteBuildLike;
  environments?: Record<string, { build?: ViteBuildLike }>;
}): OutputTargets {
  const builds = [
    config.build,
    ...Object.values(config.environments ?? {}).flatMap((environment) =>
      environment.build === undefined ? [] : [environment.build]
    ),
  ];
  return mergeOutputTargets(
    builds.map((build) => {
      const output =
        build.rolldownOptions?.output ?? build.rollupOptions?.output;
      const outputs =
        output === undefined ? [{}] : Array.isArray(output) ? output : [output];
      return targetsOf(config.root, outputs, build.outDir);
    })
  );
}

/** esbuild's `outdir`, or its exact `outfile`. */
export function esbuildOutputTargets(options: {
  outdir?: string;
  outfile?: string;
  absWorkingDir?: string;
}): OutputTargets {
  return targetsOf(options.absWorkingDir ?? process.cwd(), [
    { dir: options.outdir, file: options.outfile },
  ]);
}

/** webpack's `output.path`, up to its first segment holding a template
 *  placeholder (`out/[fullhash]` writes under `out`). */
export function webpackOutputTargets(outputPath?: string): OutputTargets {
  if (outputPath === undefined) return noOutputTargets();
  const segments = outputPath.split(sep);
  const placeholder = segments.findIndex((segment) => segment.includes('['));
  const fixed =
    placeholder === -1 ? outputPath : segments.slice(0, placeholder).join(sep);
  return { dirs: fixed === '' ? [] : [fixed], files: [] };
}

export function mergeOutputTargets(all: OutputTargets[]): OutputTargets {
  return {
    dirs: [...new Set(all.flatMap((targets) => targets.dirs))],
    files: [...new Set(all.flatMap((targets) => targets.files))],
  };
}

/** The Session's structural exclusions: every target inside the root. A
 *  directory that is the root excludes nothing; its files still can. */
export function outputExclusions(
  root: string,
  targets: OutputTargets
): string[] {
  return [...targets.dirs, ...targets.files].flatMap((target) => {
    const exclusion = outputExclusion(root, target);
    return exclusion === null ? [] : [exclusion];
  });
}

/** The analysed files a build's targets hold, as the render check reports
 *  them: a file target the analysis read is the build's own earlier
 *  output; a file inside a directory target is earlier output or a source
 *  the bundler writes beside, which the check cannot tell apart. */
export function analysedOutputs(
  root: string,
  targets: OutputTargets,
  analyzed: readonly string[]
): ManifestDiagnostic | null {
  const earlier = analyzed.filter((file) => targets.files.includes(file));
  const inside = targets.dirs.flatMap((dir) => {
    const exclusion = outputExclusion(root, dir);
    const held = analyzed.filter(
      (file) => !earlier.includes(file) && isPathWithinRoot(dir, file)
    );
    return exclusion === null || held.length === 0 ? [] : [{ exclusion, held }];
  });
  const rel = (file: string) => relative(root, file);
  const parts = [
    ...(earlier.length === 0
      ? []
      : [
          `it analysed its own earlier output: ${earlier.map(rel).join(', ')}. ` +
            `Add ${earlier.map((file) => `'${rel(file)}'`).join(', ')} to the ` +
            `plugin's \`exclude\` option`,
        ]),
    ...inside.map(
      ({ exclusion, held }) =>
        `it analysed files inside its output directory '${exclusion}': ` +
        `${held.map(rel).join(', ')}. If they are earlier output, add ` +
        `'${exclusion}' to the plugin's \`exclude\` option; if they are ` +
        `sources, write the output outside the source tree`
    ),
  ];
  return parts.length === 0
    ? null
    : hostFinding(
        ANALYSED_OUTPUT,
        'output',
        'this build',
        parts.join('; and ')
      );
}

/** Directory names build tools write into, which source rarely uses. */
const OUTPUT_DIR_NAMES: ReadonlySet<string> = new Set([
  'dist',
  'build',
  'out',
  '.output',
  '.publish',
  '.turbo',
  'coverage',
  'storybook-static',
  '.vercel',
  '.netlify',
  '.svelte-kit',
  '.nuxt',
  '.docusaurus',
  '.expo',
  '.parcel-cache',
  '.cache',
]);

/** The share of the analysed source, by bytes, output-named trees must hold
 *  to report, and the least they must hold: startup cost follows bytes, and
 *  a build's minified bundles are few files and most of the bytes. A tree
 *  holding less than a quarter of that least, such as a small source folder
 *  named `build`, is not counted. */
const OUTPUT_TREE_SHARE = 0.25;
const OUTPUT_TREE_BYTES = 256 * 1024;
const OUTPUT_TREE_LEAST_BYTES = OUTPUT_TREE_BYTES / 4;

/**
 * Why a build's analysed set looks dominated by build output, or null: the
 * trees under a directory named as build tools name their output (the first
 * such directory on each path), each holding 64 KiB, that together hold a
 * quarter of the analysed source and 256 KiB. Read from the paths and
 * sources discovery already holds. `exclude` is the user's list, which the
 * suggested one extends; with none, the message names the defaults a list
 * replaces. Reported about the largest tree.
 */
export function outputTreesDiagnostic(
  entries: ReadonlyArray<{ path: string; source: string }>,
  exclude: readonly string[] | undefined
): ManifestDiagnostic | null {
  let total = 0;
  const trees = new Map<string, { files: number; bytes: number }>();
  for (const { path, source } of entries) {
    total += source.length;
    const segments = path.split(/[\\/]/);
    const at = segments.findIndex(
      (segment, index) =>
        index < segments.length - 1 && OUTPUT_DIR_NAMES.has(segment)
    );
    if (at === -1) continue;
    const dir = segments.slice(0, at + 1).join('/');
    const tree = trees.get(dir) ?? { files: 0, bytes: 0 };
    tree.files += 1;
    tree.bytes += source.length;
    trees.set(dir, tree);
  }
  const largest = [...trees]
    .filter(([, tree]) => tree.bytes >= OUTPUT_TREE_LEAST_BYTES)
    .sort(([, a], [, b]) => b.bytes - a.bytes);
  const held = largest.reduce((sum, [, tree]) => sum + tree.bytes, 0);
  if (held < OUTPUT_TREE_BYTES || held < total * OUTPUT_TREE_SHARE) return null;
  const named = largest.slice(0, 5);
  const files = largest.reduce((sum, [, tree]) => sum + tree.files, 0);
  const more = largest.length - named.length;
  const listed =
    named.map(([dir, tree]) => `${dir} (${tree.files} files)`).join(', ') +
    (more > 0 ? `, and ${more} more` : '');
  const suggested = [
    ...(exclude ?? []),
    ...named.map(([dir]) => `${dir}/**`),
  ].map((pattern) => `'${pattern}'`);
  const defaults = REPLACEABLE_DEFAULT_EXCLUDE.map((pattern) => `'${pattern}'`);
  return hostFinding(
    OUTPUT_TREES,
    named[0][0],
    'discovery',
    `${Math.floor((held / total) * 100)}% of the analysed source ` +
      `(${(held / 1024 / 1024).toFixed(1)} MB in ${files} files) sits under ` +
      `directories that look like build output: ${listed}. Analysing them ` +
      `slows every build; if they are output, exclude them with ` +
      `exclude: [${suggested.join(', ')}]` +
      (exclude === undefined
        ? ` (a list replaces the default excludes ${defaults.join(', ')}; ` +
          'add those it should keep).'
        : '.')
  );
}
