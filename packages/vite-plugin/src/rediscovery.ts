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
  file: string;
  component: string;
  /** The parent binding as written in the consumer, not a resolved path. */
  parent: string;
}

/** The current manifest's unresolved-parent drops, parsed from diagnostics. */
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

// Per-manifest memo: the membership check below runs once per served file.
const dropFilesByManifest = new WeakMap<ProjectManifest, ReadonlySet<string>>();

/** Files carrying an unresolved-parent drop in the current manifest. */
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
 * Folds undiscovered on-disk files when the manifest reports an unresolved
 * parent, then re-analyzes; the iteration cap is containment, not semantics.
 */
export async function reconcileSourceCorpus(
  ctx: PluginContext
): Promise<boolean> {
  if (ctx.isProd) return false;

  let reanalyzed = false;
  for (let iteration = 0; iteration < 3; iteration++) {
    if (unresolvedDropFiles(ctx).size === 0) {
      // Drops resolved — future occurrences of the same conditions warn anew.
      warnedVerdicts.get(ctx)?.clear();
      return reanalyzed;
    }
    const drops = unresolvedParentDrops(ctx);

    // A walk over an unchanged drop set with no cache movement cannot fold
    // anything new. Movement is the mutation generation, never the size.
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
      // The walk is complete and the parents are still unresolvable; teach
      // the reason where resolution succeeds on disk.
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
    // Roll the fold back unless the analysis published: kept entries make the
    // next walk barren, memoize that, and short-circuit every later call.
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
      'source-corpus rediscovery did not stabilize after bounded retries'
    );
  }
  return reanalyzed;
}

/** Returns the cache keys this fold added: a failed analysis must restore
 *  the cache, or the content-hash gate suppresses the retry forever. */
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
    // `.mdx` ingests on its first watcher edit instead: without the optional
    // MDX peer a folded `.mdx` is re-quarantined on every pass.
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

/** Per context: the drop tuple-set and the cache mutation generation at the
 *  last walk that folded nothing. */
const barrenWalkMemos = new WeakMap<
  object,
  { dropKey: string; cacheGeneration: number }
>();

/** Per-context (file, parent, condition) verdicts already warned — each
 *  condition warns once; cleared when the drops disappear. */
const warnedVerdicts = new WeakMap<object, Set<string>>();

const PARENT_PROBE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.tsx',
  '.ts',
  '.jsx',
  '.js',
]);

/**
 * Warns for parents that resolve on disk but cannot be admitted. Resolution
 * is a best-effort scan of the consumer's own relative import specifiers.
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
    const reason = excludedBy
      ? `which is excluded by pattern '${excludedBy}'. Include that ` +
        `file in the extraction sources or remove this extension.`
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
