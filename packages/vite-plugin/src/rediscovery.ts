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

import { DEFAULT_EXCLUDE } from './constants';
import { buildFileEntriesFromCache } from './context';

import type { PluginContext } from './context';

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const d of (ctx.storedManifest?.diagnostics ?? []) as any[]) {
    const parent = unresolvedParentName(d);
    if (parent !== null) {
      drops.push({
        file: String(d.file ?? ''),
        component: String(d.component ?? ''),
        parent,
      });
    }
  }
  return drops;
}

const EMPTY_DROP_FILES: ReadonlySet<string> = new Set();

// Per-manifest memo for the hot-path membership checks below — transform's
// raw-serve check and stabilize's trigger run per served file, and a full
// diagnostics scan per call is wasted work when the manifest hasn't moved.
const dropFilesByManifest = new WeakMap<object, ReadonlySet<string>>();

/** Files carrying an unresolved-parent drop in the CURRENT manifest —
 *  derived once per manifest publication, then a set lookup. */
export function unresolvedDropFiles(ctx: PluginContext): ReadonlySet<string> {
  const manifest = ctx.storedManifest as object | null;
  if (!manifest) return EMPTY_DROP_FILES;
  let files = dropFilesByManifest.get(manifest);
  if (!files) {
    const derived = new Set<string>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const d of ((manifest as any).diagnostics ?? []) as any[]) {
      if (isUnresolvedParentDrop(d)) derived.add(String(d.file ?? ''));
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
 * Synchronous by design — it runs inside the sync `transform` hook. `.mdx`
 * sources need async preprocessing and are not folded here (they ingest on
 * their first watcher edit).
 *
 * Returns whether any re-analysis ran (callers diff plans across the WHOLE
 * transaction, so a fold-and-reanalyze is invisible to them beyond the
 * final manifest).
 */
export function stabilizeSourceUniverse(ctx: PluginContext): boolean {
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
    // UNCHANGED drop tuple-set with no cache-size movement since the last
    // barren walk cannot fold anything new — skip it (its verdicts already
    // warned once).
    const dropKey = drops
      .map((d) => `${d.file}\0${d.component}\0${d.parent}`)
      .sort()
      .join('\n');
    const memo = barrenWalkMemos.get(ctx);
    if (
      memo &&
      memo.dropKey === dropKey &&
      memo.cacheSize === ctx.fileCache.size
    ) {
      return reanalyzed;
    }

    const folded = foldUndiscoveredFiles(ctx);
    if (folded === 0) {
      // The walk is complete and the parents are still unresolvable —
      // genuinely absent, or resolvable-but-inadmissible. Teach the reason
      // where resolution succeeds on disk; the documented runtime fallback
      // stands.
      barrenWalkMemos.set(ctx, { dropKey, cacheSize: ctx.fileCache.size });
      warnInadmissibleParents(ctx, drops);
      return reanalyzed;
    }
    barrenWalkMemos.delete(ctx);

    ctx.log(
      `rediscovery: folded ${folded} on-disk file(s) after unresolved-parent drop`
    );
    reanalyzed = true;
    if (ctx.runAnalysis(buildFileEntriesFromCache(ctx.fileCache)) === false) {
      // Failed analysis: the previous manifest is still current; the folded
      // cache entries stay (they are real on-disk sources) and the next
      // event retries.
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
function foldUndiscoveredFiles(ctx: PluginContext): number {
  const excludePatterns = ctx.options.exclude ?? DEFAULT_EXCLUDE;
  const filePaths = discoverFiles(
    ctx.rootDir,
    ctx.rootDir,
    excludePatterns,
    ctx.extensionsSet
  );
  let folded = 0;
  for (const filePath of filePaths) {
    if (extname(filePath) === '.mdx') continue;
    const relPath = relative(ctx.rootDir, filePath);
    if (ctx.fileCache.has(relPath)) continue;
    let source: string;
    try {
      source = readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }
    ctx.fileCache.set(relPath, { hash: contentHash(source), source });
    folded++;
  }
  return folded;
}

/** Barren-walk memo per context: the drop tuple-set and cache size at the
 *  last walk that folded nothing (see stabilizeSourceUniverse). */
const barrenWalkMemos = new WeakMap<
  object,
  { dropKey: string; cacheSize: number }
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
  const excludePatterns = ctx.options.exclude ?? DEFAULT_EXCLUDE;
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

    const excludedBy = excludePatterns.find(
      (pattern) => resolved.includes(pattern) || relPath.includes(pattern)
    );
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
