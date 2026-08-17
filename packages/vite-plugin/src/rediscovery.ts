import {
  contentHash,
  discoverFiles,
  isPathWithinRoot,
  isUnresolvedParentDrop,
  resolveAbsolutePathSpecifier,
  unresolvedParentName,
} from '@animus-ui/extract/pipeline';
import { readFileSync } from 'fs';
import { dirname, extname, relative, resolve } from 'path';

import type { PluginContext } from './context';
import type { ProjectManifest } from '@animus-ui/extract/pipeline';

interface UnresolvedParentDrop {
  /** rootDir-relative consumer file the diagnostic names. */
  file: string;
  /** The dropped child component binding. */
  component: string;
  /** The parent binding as written in the consumer. */
  parent: string;
}

/** The current manifest's unresolved-parent drops, parsed from diagnostics
 *  (shared Rust-mirror matcher — the regex lives in manifest-diagnostics). */
export function unresolvedParentDrops(
  ctx: PluginContext
): UnresolvedParentDrop[] {
  const drops: UnresolvedParentDrop[] = [];
  const manifest = ctx.storedManifest;
  if (!manifest) return drops;
  for (const d of manifest.diagnostics) {
    const parent = unresolvedParentName(d);
    if (parent !== null) {
      drops.push({ file: d.file, component: d.component, parent });
    }
  }
  return drops;
}

const EMPTY_DROP_FILES: ReadonlySet<string> = new Set();

// Per-manifest memo for the hot-path membership checks below — transform's
// raw-serve check and stabilize's trigger run per served file, and a full
// diagnostics scan per call is wasted work when the manifest hasn't moved.
const dropFilesByManifest = new WeakMap<ProjectManifest, ReadonlySet<string>>();

/** Files carrying an unresolved-parent drop in the CURRENT manifest —
 *  derived once per manifest publication, then a set lookup. */
export function unresolvedDropFiles(ctx: PluginContext): ReadonlySet<string> {
  const manifest = ctx.storedManifest;
  if (!manifest) return EMPTY_DROP_FILES;
  let files = dropFilesByManifest.get(manifest);
  if (!files) {
    const derived = new Set<string>();
    for (const d of manifest.diagnostics) {
      if (isUnresolvedParentDrop(d)) derived.add(d.file);
    }
    files = derived;
    dropFilesByManifest.set(manifest, files);
  }
  return files;
}

/**
 * Reconcile the discoverable on-disk source universe before an
 * unresolved-parent result is acted on (openspec: dev-transform-coherence,
 * "Source-universe reconciliation precedes unresolved-parent fallbacks").
 *
 * Drop-triggered: runs only when the current manifest reports `chain
 * dropped: could not resolve parent component`. One discovery walk (the
 * same walk and policy the server start uses) folds every eligible on-disk
 * file the cache does not know, then one re-analysis resolves the whole
 * extension graph — dependency depth never requires iteration depth, so the
 * loop re-enters only when a re-analysis leaves NEW drops and the previous
 * walk actually folded something (a changed discovery domain). The
 * iteration cap is containment, not semantics.
 *
 * Returns whether any re-analysis ran (callers diff plans across the WHOLE
 * transaction, so a fold-and-reanalyze is invisible to them beyond the
 * final manifest).
 */
export async function stabilizeSourceUniverse(
  ctx: PluginContext
): Promise<boolean> {
  if (ctx.isProd) return false;

  let reanalyzed = false;
  for (let iteration = 0; iteration < 3; iteration++) {
    // Cheap trigger first (per-manifest set); full drop details only parsed
    // on the drop path.
    if (unresolvedDropFiles(ctx).size === 0) {
      // Drops resolved — future occurrences of the same conditions warn anew.
      warnedVerdicts.get(ctx)?.clear();
      return reanalyzed;
    }
    const drops = unresolvedParentDrops(ctx);

    // Barren-walk memo (approved log/walk-frequency change): a walk over an
    // UNCHANGED drop tuple-set with no cache movement since the last barren
    // walk cannot fold anything new — skip it (its verdicts already warned
    // once). "No movement" is the cache's mutation generation, never its size:
    // a delete plus an unrelated create restores the size while the contents
    // differ, and skipping there strands the lost-event file as a raw fallback
    // for the session.
    const dropKey = drops
      .map((d) => `${d.file}\0${d.component}\0${d.parent}`)
      .sort()
      .join('\n');
    const memo = barrenWalkMemos.get(ctx);
    if (
      memo &&
      memo.dropKey === dropKey &&
      memo.cacheGeneration === ctx.fileCacheGeneration
    ) {
      return reanalyzed;
    }

    const folded = foldUndiscoveredFiles(ctx);
    if (folded.length === 0) {
      // The walk is complete and the parents are still unresolvable —
      // genuinely absent, or resolvable-but-inadmissible. Teach the reason
      // where resolution succeeds on disk; the documented runtime fallback
      // stands.
      barrenWalkMemos.set(ctx, {
        dropKey,
        cacheGeneration: ctx.fileCacheGeneration,
      });
      warnInadmissibleParents(ctx, drops);
      return reanalyzed;
    }
    barrenWalkMemos.delete(ctx);

    ctx.log(
      `rediscovery: folded ${folded.length} on-disk file(s) after unresolved-parent drop`
    );
    reanalyzed = true;
    // Roll the fold back unless the analysis PUBLISHED. Keeping the entries
    // looked harmless — they are real on-disk sources — but it strands the
    // retry: the next call folds 0, reads that as a barren walk, memoizes it,
    // and short-circuits every later call, so stabilize never runs again.
    // `runAnalysis` also throws in every mode on error diagnostics (the
    // escalation sits outside its non-strict catch), and strict-mode
    // ingestion diagnostics throw from `surfaceSourceDiagnostics` — hence
    // `finally`.
    let published = false;
    try {
      published = (await ctx.analyzeIngested()).ok;
    } finally {
      if (!published) {
        ctx.mutateFileCache((cache) => {
          for (const key of folded) cache.delete(key);
        });
      }
    }
    if (!published) {
      // Previous manifest is still current; the cache is back to its
      // pre-fold state, so the next event genuinely retries.
      return reanalyzed;
    }
  }

  if (unresolvedDropFiles(ctx).size > 0) {
    ctx.warn(
      'source-universe rediscovery did not stabilize after bounded retries'
    );
  }
  return reanalyzed;
}

/**
 * One discovery walk over the project root with the server-start policy;
 * folds every eligible file `fileCache` does not hold. Returns the fold
 * count.
 */
/** Returns the cache keys this fold ADDED, so a failed analysis can roll
 *  them back — `runAnalysis` requires callers that advanced the file cache to
 *  restore it, or the content-hash gate suppresses the equal-content retry
 *  forever. */
function foldUndiscoveredFiles(ctx: PluginContext): string[] {
  const excludeMatcher = ctx.excludeMatcher;
  const filePaths = discoverFiles(
    ctx.rootDir,
    ctx.rootDir,
    excludeMatcher,
    ctx.extensionsSet
  );
  const folded: string[] = [];
  const pending: Array<[string, { hash: string; source: string }]> = [];
  for (const filePath of filePaths) {
    // `.mdx` sources are not folded here (they ingest on their first
    // watcher edit): with the optional MDX peer absent, a folded `.mdx`
    // would be re-quarantined on every stabilize pass — wasted walks and
    // repeated warns for a file that can never resolve a parent anyway.
    if (extname(filePath) === '.mdx') continue;
    const relPath = relative(ctx.rootDir, filePath);
    if (ctx.fileCache.has(relPath)) continue;
    let source: string;
    try {
      source = readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }
    pending.push([relPath, { hash: contentHash(source), source }]);
    folded.push(relPath);
  }
  // One mutation for the whole walk: the fold either happens or it does not,
  // and the memo above reads a single generation either way.
  if (pending.length > 0) {
    ctx.mutateFileCache((cache) => {
      for (const [relPath, entry] of pending) cache.set(relPath, entry);
    });
  }
  return folded;
}

/** Barren-walk memo per context: the drop tuple-set and the cache's mutation
 *  generation at the last walk that folded nothing (see
 *  stabilizeSourceUniverse). */
const barrenWalkMemos = new WeakMap<
  object,
  { dropKey: string; cacheGeneration: number }
>();

/** Per-context (file, parent, condition) verdicts already warned — each
 *  condition warns once; cleared when the drops disappear. */
const warnedVerdicts = new WeakMap<object, Set<string>>();

/** The narrow probe set is deliberate — NOT ctx.extensionsSet (conscious
 *  no-behavior-change choice: the teaching probe resolves what it always did). */
const PARENT_PROBE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.tsx',
  '.ts',
  '.jsx',
  '.js',
]);

/**
 * The teaching half for parents that RESOLVE on disk but cannot be admitted
 * (excluded by configuration, unsupported source type, outside the root).
 * Resolution is a best-effort scan of the consumer's own import statements
 * for the parent binding — enough for the relative-specifier case a
 * developer actually hits; a parent this scan cannot resolve keeps the
 * engine's own diagnostic.
 */
function warnInadmissibleParents(
  ctx: PluginContext,
  drops: UnresolvedParentDrop[]
): void {
  const excludeMatcher = ctx.excludeMatcher;
  let warned = warnedVerdicts.get(ctx);
  if (!warned) {
    warned = new Set();
    warnedVerdicts.set(ctx, warned);
  }
  // A (file, parent) no longer dropped warns anew on a future recurrence.
  const active = new Set(drops.map((d) => `${d.file}\0${d.parent}`));
  for (const key of [...warned]) {
    if (!active.has(key.slice(0, key.lastIndexOf('\0')))) warned.delete(key);
  }

  for (const drop of drops) {
    const consumer = ctx.fileCache.get(drop.file);
    if (!consumer) continue;
    const specifier = importSpecifierFor(consumer.source, drop.parent);
    if (!specifier || !specifier.startsWith('.')) continue;

    const resolved = resolveAbsolutePathSpecifier(
      resolve(ctx.rootDir, dirname(drop.file), specifier),
      PARENT_PROBE_EXTENSIONS
    );
    if (!resolved) continue;
    const relPath = relative(ctx.rootDir, resolved);

    const excludedBy = excludeMatcher.explain(resolved, relPath);
    // One message template; the reason clause is the only variable part.
    const reason = excludedBy
      ? `which is excluded by pattern '${excludedBy}'. Include that ` +
        `file in the extraction universe or remove this extension.`
      : !isPathWithinRoot(ctx.rootDir, resolved)
        ? `outside the extraction root. Declare its package in the ` +
          `system includes or move it under the project root.`
        : !ctx.extensionsSet.has(extname(resolved))
          ? `whose extension is not in the configured source extensions.`
          : null;
    if (reason === null) continue;
    const verdictKey = `${drop.file}\0${drop.parent}\0${reason}`;
    if (warned.has(verdictKey)) continue;
    warned.add(verdictKey);
    ctx.warn(
      `cannot extract '${drop.component}': parent '${drop.parent}' resolves to ` +
        `${relPath}, ${reason}`
    );
  }
}

/** The module specifier a named import binds `binding` from, if scannable. */
function importSpecifierFor(source: string, binding: string): string | null {
  const importRe = /import\s+([^;]+?)\s+from\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = importRe.exec(source)) !== null) {
    const clause = match[1];
    const named = new RegExp(`[{,\\s]${binding}[,\\s}]|^${binding}$`);
    if (named.test(clause)) return match[2];
  }
  return null;
}
