import { contentHash } from './content-hash';

import type { ProjectManifest } from './manifest-schema';

/**
 * A file's plan: the ordered (component id, replacement) pairs the manifest
 * holds for it. A file with no entries is ABSENT, never an empty entry.
 */
export type FilePlanSnapshot = Map<string, string>;

// Per-manifest memo: each analysis parses a fresh manifest (a new identity)
// and every consumer treats the snapshot as read-only.
const snapshotByManifest = new WeakMap<object, FilePlanSnapshot>();

/** `null` (a context before its first analysis) snapshots to the empty plan
 *  set — the same state as an empty universe. */
export function snapshotFilePlans(
  manifest: Pick<ProjectManifest, 'components'> | null
): FilePlanSnapshot {
  if (manifest === null) return new Map();
  const cached = snapshotByManifest.get(manifest);
  if (cached) return cached;
  const entriesByFile = new Map<string, Array<[string, string]>>();
  for (const [id, desc] of Object.entries(manifest.components)) {
    const list = entriesByFile.get(desc.file) ?? [];
    list.push([id, desc.replacement]);
    entriesByFile.set(desc.file, list);
  }
  const snapshot: FilePlanSnapshot = new Map();
  for (const [file, entries] of entriesByFile) {
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    // The serialization is injective: components 'x'+'y' can never serialize
    // equal to one component 'xy'.
    snapshot.set(file, JSON.stringify(entries));
  }
  snapshotByManifest.set(manifest, snapshot);
  return snapshot;
}

/**
 * Paths whose plan changed: absent↔present, membership, or content.
 * `exclude` drops one path whose own modules are already being updated.
 */
export function diffFilePlans(
  prev: FilePlanSnapshot,
  next: FilePlanSnapshot,
  opts?: { exclude?: string }
): string[] {
  const changed = new Set<string>();
  for (const [file, plan] of next) {
    if (prev.get(file) !== plan) changed.add(file);
  }
  for (const file of prev.keys()) {
    if (!next.has(file)) changed.add(file);
  }
  if (opts?.exclude) changed.delete(opts.exclude);
  return [...changed].sort();
}

/** Domain prefix keeping this hash disjoint from every other `contentHash`
 *  use in the pipeline. */
const REPLACEMENT_PLANS_DOMAIN = 'animus-replacement-plans-v1\0';

/** Leads with NUL: entries end with `\0` and contain none, so `\0\0` is
 *  unreachable from entries alone and the section cannot be forged. */
const SERVED_DEPENDENCY_DOMAIN = '\0animus-served-dependency-v1\0';

/**
 * THE replacement epoch: integrations consume this hash, never their own.
 * `servedDependencyWitness` folds in content the plans cannot see.
 */
export function hashReplacementPlans(
  snapshot: FilePlanSnapshot,
  servedDependencyWitness?: string
): string {
  const entries = [...snapshot.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  );
  let serialized = REPLACEMENT_PLANS_DOMAIN;
  for (const [file, plan] of entries) {
    serialized += file + '\0' + plan + '\0';
  }
  if (servedDependencyWitness !== undefined) {
    serialized += SERVED_DEPENDENCY_DOMAIN + servedDependencyWitness;
  }
  return contentHash(serialized);
}
