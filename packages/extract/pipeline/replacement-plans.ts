import { contentHash } from './content-hash';

/**
 * File-plan snapshot/diff — the invalidation candidate source shared by
 * every analysis path (openspec: dev-transform-coherence,
 * dev-served-transform-coherence). A file's plan is the keyed, ordered set
 * of (component id, replacement) pairs the manifest holds for it. A file
 * with NO entries is ABSENT from the snapshot — a distinct state from a
 * present entry whose replacement is empty, so raw↔extracted transitions
 * are plan changes like any other.
 *
 * Lives in the shared pipeline package so the Vite diff consumer and the
 * Next (webpack/Turbopack) epoch consumers share ONE semantic definition
 * (design D5, next-webpack-served-transform-coherence).
 */
export type FilePlanSnapshot = Map<string, string>;

// Per-manifest memo: manifests are parsed fresh per analysis (identity moves
// with every publication), and every consumer treats the snapshot as
// read-only — deriving it once per manifest is free of aliasing hazards.
const snapshotByManifest = new WeakMap<object, FilePlanSnapshot>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function snapshotFilePlans(manifest: any): FilePlanSnapshot {
  const memoKey: object | null =
    manifest !== null && typeof manifest === 'object'
      ? (manifest as object)
      : null;
  if (memoKey) {
    const cached = snapshotByManifest.get(memoKey);
    if (cached) return cached;
  }
  const entriesByFile = new Map<string, Array<[string, string]>>();
  for (const [id, desc] of Object.entries(manifest?.components ?? {})) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const file = (desc as any).file as string | undefined;
    if (!file) continue;
    const list = entriesByFile.get(file) ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    list.push([id, (desc as any).replacement ?? '']);
    entriesByFile.set(file, list);
  }
  const snapshot: FilePlanSnapshot = new Map();
  for (const [file, entries] of entriesByFile) {
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    // JSON keeps component identity and membership visible — two components
    // 'x'+'y' can never serialize equal to one component 'xy'.
    snapshot.set(file, JSON.stringify(entries));
  }
  if (memoKey) snapshotByManifest.set(memoKey, snapshot);
  return snapshot;
}

/**
 * Rel paths whose plan changed between two snapshots: absent→present,
 * present→absent, and any change to membership or replacement content.
 * `exclude` drops one path (the changed file itself on the edit path — its
 * own modules are already in the update set).
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

/** Domain prefix keeping the epoch hash disjoint from every other
 *  contentHash use in the pipeline (design D5). */
const REPLACEMENT_PLANS_DOMAIN = 'animus-replacement-plans-v1\0';

/** Section marker for the served-dependency witness. Leads with NUL: every
 *  plan entry ends `…\0` and neither file paths nor plan JSON contain NUL,
 *  so `\0\0` is unreachable from entry serialization alone — a snapshot can
 *  never forge the witness section. */
const SERVED_DEPENDENCY_DOMAIN = '\0animus-served-dependency-v1\0';

/**
 * Canonical replacement epoch: contentHash over the domain-prefixed, sorted
 * canonical serialization of a file-plan snapshot — each entry contributes
 * `file + '\0' + plan + '\0'` (unambiguous: neither file paths nor the
 * JSON plan strings contain NUL). Byte-identical plans → identical epoch;
 * any membership/replacement/absent↔present change moves it.
 *
 * `servedDependencyWitness` extends the epoch to content the plans cannot
 * see but restored modules depend on: transformed modules import the
 * session's served system-props artifact, so a consumer passes that
 * artifact's content here and an offline change to it moves the epoch —
 * invalidating persistent-cache snapshots that reference the old epoch
 * artifact. Absence and empty-string are distinct values.
 *
 * This is THE epoch definition — integrations consume this hash (or the
 * snapshot diff) and never define their own. Epoch values compare only for
 * equality (a moved value invalidates), so the serialization is free to
 * evolve with a domain bump: sessions running different serializations
 * simply disagree once and rebuild.
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
