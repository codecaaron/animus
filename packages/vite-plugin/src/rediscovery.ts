import {
  caseMismatchReason,
  discoverFiles,
  isPathWithinRoot,
  isUnresolvedParentDrop,
  probeAbsolutePathSpecifier,
  unresolvedParentName,
} from '@animus-ui/extract/pipeline';
import { dirname, extname, relative, resolve } from 'path';

import { mergePublished } from './session-outcomes';

import type { ObservedOutcome, PluginContext } from './context';
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
 * Folds undiscovered on-disk files into the Session when the manifest
 * reports an unresolved parent, and returns the outcomes of the attempts
 * that analyzed them; the iteration cap is containment, not semantics.
 */
export async function reconcileSourceCorpus(
  ctx: PluginContext
): Promise<ObservedOutcome[]> {
  const outcomes: ObservedOutcome[] = [];
  if (ctx.isProd || ctx.session === null) return outcomes;

  for (let iteration = 0; iteration < 3; iteration++) {
    if (unresolvedDropFiles(ctx).size === 0) {
      // Drops resolved — future occurrences of the same conditions warn anew.
      warnedVerdicts.get(ctx)?.clear();
      return outcomes;
    }
    // A walk over the generation a barren walk saw cannot fold anything new.
    const manifest = ctx.storedManifest;
    if (manifest !== null && barrenWalks.has(manifest)) return outcomes;

    const folded = undiscoveredFiles(ctx);
    if (folded.length === 0) {
      // The walk is complete and the parents are still unresolvable; teach
      // the reason where resolution succeeds on disk.
      if (manifest !== null) barrenWalks.add(manifest);
      warnInadmissibleParents(ctx, unresolvedParentDrops(ctx));
      return outcomes;
    }

    ctx.log(
      `rediscovery: folded ${folded.length} on-disk file(s) after unresolved-parent drop`
    );
    // The Session reads them: a file it cannot read is lost input it reports,
    // and an attempt that fails keeps none of them for the next walk.
    const submitted = await ctx.submitChanges({
      modifiedFiles: new Set(folded),
    });
    outcomes.push(...submitted);
    // Nothing published: the previous manifest is still current.
    if (!mergePublished(submitted).published) return outcomes;
  }

  if (unresolvedDropFiles(ctx).size > 0) {
    ctx.warn(
      'source-corpus rediscovery did not stabilize after bounded retries'
    );
  }
  return outcomes;
}

/** The on-disk sources the Session does not hold, as absolute paths. */
function undiscoveredFiles(ctx: PluginContext): string[] {
  const held = ctx.session!.heldSources;
  return discoverFiles(
    ctx.rootDir,
    ctx.rootDir,
    ctx.excludeMatcher,
    ctx.extensionsSet
  ).filter(
    (filePath) =>
      // `.mdx` ingests on its first watcher edit instead: without the
      // optional MDX peer a folded `.mdx` is re-quarantined on every pass.
      extname(filePath) !== '.mdx' && !held.has(relative(ctx.rootDir, filePath))
  );
}

/** The manifests whose walk folded nothing: their drops stay unresolvable
 *  until another publication. */
const barrenWalks = new WeakSet<ProjectManifest>();

/** Per-context (file, parent, condition) verdicts already warned — each
 *  condition warns once; cleared when the drops disappear. */
const warnedVerdicts = new WeakMap<object, Set<string>>();

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
    const consumer = ctx.session?.heldSources.get(drop.file);
    if (!consumer) continue;
    const specifier = importSpecifierFor(consumer.source, drop.parent);
    if (!specifier || !specifier.startsWith('.')) continue;

    const importerDir = resolve(ctx.rootDir, dirname(drop.file));
    const probed = probeAbsolutePathSpecifier(
      resolve(importerDir, specifier),
      undefined,
      importerDir,
      ctx.extensionPolicy
    );
    if (probed.kind === 'absent') continue;
    if (probed.kind === 'case-mismatch') {
      // Neither found nor absent: a case-sensitive filesystem loads no file.
      const mismatch = caseMismatchReason(
        `the import '${specifier}'`,
        {
          candidate: relative(ctx.rootDir, probed.candidate),
          actual: relative(ctx.rootDir, probed.actual),
        },
        'spell the import as the file is spelled.'
      );
      const verdictKey = `${drop.file}\0${drop.parent}\0${mismatch}`;
      if (warned.has(verdictKey)) continue;
      warned.add(verdictKey);
      ctx.warn(
        `cannot extract '${drop.component}': parent '${drop.parent}' is unresolved: ${mismatch}`
      );
      continue;
    }
    const resolved = probed.path;
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
