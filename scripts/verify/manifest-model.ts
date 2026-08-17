// scripts/verify/manifest-model.ts
//
// Single owner for the DECLARATIVE REPOSITORY MANIFESTS that `scripts/verify`
// gates read: the `package.json` field subset, and the `vp` task graph
// declared in `vite.config.ts`.
//
// Before this module, `package.json` was modelled four times inside this one
// directory, with four disjoint field sets — `workspace-graph.ts`
// (name/main/module/types/exports/dependencies/optionalDependencies),
// `packed-graph.ts` (name/version/peerDependencies), `owner-graph.test.ts`
// (name/scripts), `workers-config.test.ts` (scripts) — and `readManifest`
// was declared twice with an identical body. No copy was wrong; collectively
// they meant nobody owned "which package.json fields this repo's verification
// gates depend on", so widening one gate's view did not widen the others'.
//
// NOT consolidated here, deliberately: `packed-graph.ts` keeps its own
// manifest type. See the comment at its declaration — it models a manifest
// read out of a built TARBALL, where `name` and `version` are guaranteed by
// the publish contract rather than optional-on-disk. Folding it in would
// force every packed-graph read site through a presence check for an
// invariant the publish step already establishes. Same file format, different
// question.

import { readFileSync } from 'node:fs';

type DependencyMap = Record<string, string>;

/**
 * The `package.json` fields read by verification gates in this directory.
 * Every field is optional: this models an arbitrary manifest found on disk,
 * so gates that REQUIRE a field check for it and fail with their own message
 * (see `discoverWorkspaceManifests`, which rejects a nameless workspace).
 */
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

/** The root manifest additionally declares the workspace globs. */
export type RootManifest = PackageManifest & {
  workspaces?: string[] | { packages?: string[] };
};

/** Read and parse a `package.json` at `path`. */
export function readManifest(path: string): PackageManifest {
  // SAFETY: JSON.parse of a package.json yields the declared field subset;
  // every field on PackageManifest is optional, so no key is asserted present.
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest;
}

/**
 * One entry of the `vp` task graph declared under `run.tasks` in
 * `vite.config.ts`. Modelled here (rather than in a package.json type)
 * because it is repo-level declared configuration read by the same gates:
 * `owner-graph.test.ts` walks `dependsOn` chains, `extract-test-enumeration
 * .test.ts` reads `command`.
 */
export type RootTask = {
  command?: string;
  dependsOn?: string[];
};

/** The `run.tasks` slice of `vite.config.ts`, as the gates consume it. */
export type TaskGraphConfig = {
  run?: { tasks?: Record<string, RootTask> };
};
