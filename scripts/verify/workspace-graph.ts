import { existsSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import {
  type PackageManifest,
  type RootManifest,
  readManifest,
} from './manifest-model';

export type WorkspaceEntry = {
  name: string;
  directory: string;
  manifest: PackageManifest;
  distEntries: string[];
};

function workspacePatterns(manifest: RootManifest): string[] {
  if (Array.isArray(manifest.workspaces)) return manifest.workspaces;
  return manifest.workspaces?.packages ?? [];
}

function expandWorkspacePattern(root: string, pattern: string): string[] {
  if (!pattern.includes('*')) return [pattern];
  if (!pattern.endsWith('/*') || pattern.slice(0, -2).includes('*')) {
    throw new Error(`unsupported workspace pattern ${pattern}`);
  }

  const parent = pattern.slice(0, -2);
  const parentPath = join(root, parent);
  if (!existsSync(parentPath)) return [];
  return readdirSync(parentPath, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(parentPath, entry.name, 'package.json'))
    )
    .map((entry) => `${parent}/${entry.name}`);
}

type EntryPointValue =
  | null
  | boolean
  | number
  | string
  | EntryPointValue[]
  | { [condition: string]: EntryPointValue };

function isEntryPointText(value: EntryPointValue): value is string {
  return Object.prototype.toString.call(value) === '[object String]';
}

function isConditionBlock(
  value: EntryPointValue
): value is { [condition: string]: EntryPointValue } {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function collectStringLeaves(
  value: EntryPointValue | undefined,
  entries: string[]
): void {
  if (value === undefined) return;
  if (isEntryPointText(value)) {
    entries.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringLeaves(item, entries);
    return;
  }
  if (isConditionBlock(value)) {
    for (const item of Object.values(value)) {
      collectStringLeaves(item, entries);
    }
  }
}

function distEntries(manifest: PackageManifest): string[] {
  const candidates: string[] = [];
  collectStringLeaves(manifest.main, candidates);
  collectStringLeaves(manifest.module, candidates);
  collectStringLeaves(manifest.types, candidates);
  // SAFETY: `readManifest` produces every manifest by `JSON.parse`, so
  // `exports`, declared `unknown`, holds only what `EntryPointValue` names.
  collectStringLeaves(manifest.exports as EntryPointValue, candidates);
  return [
    ...new Set(candidates.filter((entry) => /(^|\/)dist(\/|$)/.test(entry))),
  ];
}

export function discoverWorkspaceManifests(
  root: string
): Map<string, WorkspaceEntry> {
  const absoluteRoot = resolve(root);
  const rootManifest: RootManifest = readManifest(
    join(absoluteRoot, 'package.json')
  );
  const workspace = new Map<string, WorkspaceEntry>();

  for (const pattern of workspacePatterns(rootManifest)) {
    for (const declaredDirectory of expandWorkspacePattern(
      absoluteRoot,
      pattern
    )) {
      const absoluteDirectory = join(absoluteRoot, declaredDirectory);
      const manifest = readManifest(join(absoluteDirectory, 'package.json'));
      if (!manifest.name) {
        throw new Error(
          `${declaredDirectory}/package.json has no package name`
        );
      }
      if (workspace.has(manifest.name)) {
        throw new Error(`duplicate workspace package name ${manifest.name}`);
      }
      workspace.set(manifest.name, {
        name: manifest.name,
        directory: relative(absoluteRoot, absoluteDirectory),
        manifest,
        distEntries: distEntries(manifest),
      });
    }
  }

  return workspace;
}

function productionWorkspaceEdges(entry: WorkspaceEntry): string[] {
  return [
    ...Object.entries(entry.manifest.dependencies ?? {}),
    ...Object.entries(entry.manifest.optionalDependencies ?? {}),
  ]
    .filter(([, version]) => version.startsWith('workspace:'))
    .map(([name]) => name);
}

export function resolveDistDependencyClosure(
  workspace: ReadonlyMap<string, WorkspaceEntry>,
  ownerName: string
): WorkspaceEntry[] {
  const owner = workspace.get(ownerName);
  if (!owner) throw new Error(`workspace package ${ownerName} not found`);

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const closure: WorkspaceEntry[] = [];

  function visit(entry: WorkspaceEntry): void {
    if (visited.has(entry.name)) return;
    if (visiting.has(entry.name)) {
      throw new Error(`workspace dependency cycle reaches ${entry.name}`);
    }
    visiting.add(entry.name);

    for (const dependencyName of productionWorkspaceEdges(entry)) {
      const dependency = workspace.get(dependencyName);
      if (!dependency) {
        throw new Error(
          `${entry.name} declares unknown workspace dependency ${dependencyName}`
        );
      }
      visit(dependency);
      if (
        dependency.name !== ownerName &&
        dependency.distEntries.length > 0 &&
        !closure.some((candidate) => candidate.name === dependency.name)
      ) {
        closure.push(dependency);
      }
    }

    visiting.delete(entry.name);
    visited.add(entry.name);
  }

  visit(owner);
  return closure;
}

function main(args: readonly string[]): number {
  const [command, ownerName] = args;
  if (command !== 'closure' || !ownerName || args.length !== 2) {
    console.error('ERROR: usage: workspace-graph.ts closure <owner-package>');
    return 2;
  }

  try {
    for (const entry of resolveDistDependencyClosure(
      discoverWorkspaceManifests(process.cwd()),
      ownerName
    )) {
      console.log(`${entry.name}\t${entry.directory}`);
    }
    return 0;
  } catch (error) {
    // SAFETY: every throw reachable here is an Error — the explicit throws in
    // this file plus `readManifest`'s `node:fs` and `JSON.parse` failures.
    console.error(`ERROR: ${(error as Error).message}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
