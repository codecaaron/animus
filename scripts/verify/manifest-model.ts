import { readFileSync } from 'node:fs';

type DependencyMap = Record<string, string>;

export type PackageManifest = {
  name?: string;
  version?: string;
  main?: string;
  module?: string;
  types?: string;
  exports?: unknown;
  scripts?: Record<string, string>;
  dependencies?: DependencyMap;
  devDependencies?: DependencyMap;
  optionalDependencies?: DependencyMap;
  peerDependencies?: DependencyMap;
};

export type RootManifest = PackageManifest & {
  workspaces?: string[] | { packages?: string[] };
};

export function readManifest(path: string): PackageManifest {
  // SAFETY: JSON.parse yields the declared field subset, and every field is
  // optional, so no key is asserted present.
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest;
}

export type RootTask = {
  command?: string;
  dependsOn?: string[];
};

export type TaskGraphConfig = {
  run?: { tasks?: Record<string, RootTask> };
};
