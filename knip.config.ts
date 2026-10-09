// knip follows the commands in package.json scripts and vite.config.ts tasks
// itself, but not into the shell scripts they run, nor to the files passed to
// those as arguments. Those entry points are derived here: every root task and
// package script is read for the files it names, and every shell script it
// runs is followed to the files that script names.
//
// Keep the name knip.config.ts, never knip.ts. Under `vp run`, PATH starts with
// Bun 1.3.13, whose `bunx --bun knip` runs a local knip.ts as a script instead
// of knip: knip analyzes nothing, and the hygiene run stops with "knip printed
// no report".
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import {
  type TaskGraphConfig,
  readManifest,
} from './scripts/verify/manifest-model';
import { discoverWorkspaceManifests } from './scripts/verify/workspace-graph';
import viteConfig from './vite.config';

import type { KnipConfig } from 'knip';

const ROOT = import.meta.dirname;

// A file a command names, between shell delimiters, with any leading
// `$VAR/` or `${VAR}/` stripped: `"$ROOT/scripts/x.ts"` names `scripts/x.ts`.
const NAMED_FILE = /[^\s'"`;&|<>()=]+\.(?:sh|[cm]?[jt]sx?)(?![\w.])/g;
const VARIABLE_PREFIX = /^\$\{?\w+\}?\//;
const SHELL_COMMENT = /^\s*#.*$/gm;

// knip's own entry defaults, kept for every workspace this config configures.
const DEFAULT_ENTRY = [
  '{index,cli,main}.{js,cjs,mjs,jsx,ts,cts,mts,tsx}',
  'src/{index,cli,main}.{js,cjs,mjs,jsx,ts,cts,mts,tsx}',
];

// Entry points no command names and no knip plugin reads.
const HAND_ENTRY = new Map([
  // The system module the animus plugin loads by path.
  ['packages/showcase', ['src/ds.ts']],
  ['e2e/next-app', ['src/ds.ts']],
  ['e2e/vite-app', ['src/ds.ts']],
  // Spawned as a subprocess by src/cli.ts.
  ['packages/_parity', ['src/engine-run.ts']],
  // The `build.ssr` input of vite.config.ts.
  ['e2e/svelte-app', ['src/ssr.ts']],
]);

// The repository's files, tracked or not yet added, but never ignored ones:
// a command can also name build output.
const SOURCES = new Set(
  execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    {
      cwd: ROOT,
      encoding: 'utf8',
    }
  )
    .split('\n')
    .map((path) => join(ROOT, path))
);

const workspaceManifests = [...discoverWorkspaceManifests(ROOT).values()];
const declared = new Set(
  workspaceManifests.map((workspace) => workspace.directory)
);
const packageDirectories = [
  ROOT,
  ...workspaceManifests.map((workspace) => join(ROOT, workspace.directory)),
];

/** The files `text` names, resolved against each of `bases` in turn. */
function namedFiles(text: string, bases: string[]): string[] {
  const files = new Set<string>();
  for (const [token] of text.matchAll(NAMED_FILE)) {
    const path = token.replace(VARIABLE_PREFIX, '');
    for (const base of bases) {
      const candidate = resolve(base, path);
      if (SOURCES.has(candidate)) files.add(candidate);
    }
  }
  return [...files];
}

// SAFETY: `vite.config.ts` declares `run.tasks`; TaskGraphConfig models that
// subset of the vite-plus config.
const tasks = (viteConfig as TaskGraphConfig).run?.tasks ?? {};
const commands = [
  ...Object.values(tasks).map((task) => ({
    command: task.command ?? '',
    from: ROOT,
  })),
  ...[
    { directory: '', manifest: readManifest(join(ROOT, 'package.json')) },
    ...workspaceManifests,
  ].flatMap(({ directory, manifest }) =>
    Object.values(manifest.scripts ?? {}).map((command) => ({
      command,
      from: join(ROOT, directory),
    }))
  ),
];

/**
 * Every file the commands name, following each shell script to the files it
 * names. A command resolves paths from where it runs or from the root; a
 * shell script may `cd` into any package first, so its paths also resolve
 * from each package.
 */
function runFiles(): string[] {
  const found = new Set<string>();
  const pending = commands.flatMap(({ command, from }) =>
    namedFiles(command, [from, ROOT])
  );
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (found.has(file)) continue;
    found.add(file);
    if (file.endsWith('.sh')) {
      const script = readFileSync(file, 'utf8').replace(SHELL_COMMENT, '');
      pending.push(
        ...namedFiles(script, [dirname(file), ...packageDirectories])
      );
    }
  }
  return [...found].filter((file) => !file.endsWith('.sh'));
}

/**
 * The package a file belongs to: the nearest directory with its own
 * package.json, so a package outside the workspaces, such as the packed-app
 * proof, is analyzed with its own plugins. `.` is the root.
 */
function packageOf(file: string): string {
  for (let directory = dirname(file); directory !== ROOT;) {
    if (SOURCES.has(join(directory, 'package.json'))) {
      return relative(ROOT, directory);
    }
    directory = dirname(directory);
  }
  return '.';
}

const entries = new Map(
  [...HAND_ENTRY].map(([workspace, files]) => [workspace, new Set(files)])
);
for (const file of runFiles()) {
  const workspace = packageOf(file);
  const files = entries.get(workspace) ?? new Set();
  files.add(relative(join(ROOT, workspace), file));
  entries.set(workspace, files);
}

const dependencyNames = (workspace: string): string[] => {
  const manifest = readManifest(join(ROOT, workspace, 'package.json'));
  return Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
};

// vinext serves Next's app and pages routes, so knip's Next plugin reads them.
const vinextWorkspaces = workspaceManifests
  .filter(({ directory }) => dependencyNames(directory).includes('vinext'))
  .map(({ directory }) => directory);

const workspaces: Record<
  string,
  {
    entry: string[];
    next?: true;
    ignoreDependencies?: string[];
    ignoreBinaries?: string[];
    vite?: false;
  }
> = {};
for (const workspace of new Set([...entries.keys(), ...vinextWorkspaces])) {
  workspaces[workspace] = {
    entry: [...DEFAULT_ENTRY, ...[...(entries.get(workspace) ?? [])].sort()],
    ...(vinextWorkspaces.includes(workspace) && { next: true }),
    // A package outside the declared workspaces installs its dependencies
    // outside the repository, as the packed-app proof does, so knip cannot
    // see them used, and its Vite plugin cannot load a vite.config.ts that
    // imports them. Unlisted imports are still reported.
    ...(workspace !== '.' &&
      !declared.has(workspace) && {
        ignoreDependencies: dependencyNames(workspace),
        ignoreBinaries: dependencyNames(workspace),
        vite: false,
      }),
  };
}

const config: KnipConfig = {
  ignore: ['legacy/**', '**/*.mdx'],
  ignoreFiles: [
    // Inputs that tests and the parity harness read from disk.
    'packages/_integration/fixtures/**',
    'packages/extract/tests/fixtures/**',
    'packages/_parity/corpus/**',
    'e2e/rollup-app/fixtures/**',
    // Sources the animus CLI build finds by walking the directory.
    'e2e/rollup-app/src/**',
    'packages/system/__tests__/types.test-d.tsx',
    'packages/test-ds/src/dev-types.ts',
  ],
  ignoreExportsUsedInFile: true,
  workspaces,
};

export default config;
