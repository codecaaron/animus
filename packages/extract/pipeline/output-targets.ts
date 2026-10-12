/**
 * Where a bundler writes, as one model: the directories it fills and the
 * files it writes by exact name. Discovery excludes both, and the Rollup
 * family's render check reads both, so the two never classify output
 * differently.
 */
import { relative, resolve, sep } from 'path';

import { outputExclusion } from './core-options';
import { isPathWithinRoot } from './source-identity';

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
): string | null {
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
    : `[animus] this build ${parts.join('; and ')}.`;
}
