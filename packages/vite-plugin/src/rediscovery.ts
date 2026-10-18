import {
  caseMismatchReason,
  isPathWithinRoot,
  probeAbsolutePathSpecifier,
  servedFiles,
} from '@animus-ui/extract/pipeline';
import { extname, relative, resolve } from 'path';

import type { ObservedOutcome, PluginContext } from './context';
import type {
  ManifestMissingInput,
  ProjectManifest,
  ServedFiles,
} from '@animus-ui/extract/pipeline';

const NO_SERVED: ServedFiles = {
  listed: new Set(),
  dropped: new Map(),
  builders: new Set(),
};

// Per-manifest memo: the membership checks run once per served file.
const servedByManifest = new WeakMap<ProjectManifest, ServedFiles>();

/** What the current manifest says the transform serves. */
export function manifestServedFiles(ctx: PluginContext): ServedFiles {
  const manifest = ctx.storedManifest;
  if (!manifest) return NO_SERVED;
  let served = servedByManifest.get(manifest);
  if (!served) {
    served = servedFiles(manifest);
    servedByManifest.set(manifest, served);
  }
  return served;
}

/** The current manifest's extensions dropped over their parent, by file:
 *  the engine's typed missing-input evidence (spec §12.2 row 11). */
export function droppedExtensions(
  ctx: PluginContext
): ReadonlyMap<string, ManifestMissingInput> {
  return manifestServedFiles(ctx).dropped;
}

/** Per-context (file, parent, condition) verdicts already warned — each
 *  condition warns once; cleared when the drops disappear. */
const warnedVerdicts = new WeakMap<object, Set<string>>();

/** A missing parent's file on disk: one the fold submits, or why it cannot
 *  be admitted. */
type ParentOnDisk =
  | { kind: 'fold'; path: string }
  | { kind: 'inadmissible'; reason: string }
  | { kind: 'none' };

/** Where a parent the analysis does not hold is on disk, probed from its
 *  base under the host's extension order: one no analysed module answers
 *  (`absent`), or one the host opens but the analysis never read
 *  (`incomplete`), such as a file the watcher has not reported yet. */
function parentOnDisk(
  ctx: PluginContext,
  input: ManifestMissingInput
): ParentOnDisk {
  if (
    (input.outcome !== 'absent' && input.outcome !== 'incomplete') ||
    input.base === null
  )
    return { kind: 'none' };
  const probed = probeAbsolutePathSpecifier(
    resolve(ctx.rootDir, input.base),
    undefined,
    ctx.rootDir,
    ctx.extensionPolicy
  );
  if (probed.kind === 'absent') return { kind: 'none' };
  if (probed.kind === 'case-mismatch') {
    // Neither found nor absent: a case-sensitive filesystem loads no file.
    return {
      kind: 'inadmissible',
      reason: `is unresolved: ${caseMismatchReason(
        `the import '${input.specifier}'`,
        {
          candidate: relative(ctx.rootDir, probed.candidate),
          actual: relative(ctx.rootDir, probed.actual),
        },
        'spell the import as the file is spelled.'
      )}`,
    };
  }
  const path = probed.path;
  const relPath = relative(ctx.rootDir, path);
  const excludedBy = ctx.excludeMatcher.explain(path, relPath);
  const reason = excludedBy
    ? `which is excluded by pattern '${excludedBy}'. Include that file in ` +
      `the extraction sources or remove this extension.`
    : !isPathWithinRoot(ctx.rootDir, path)
      ? `outside the extraction root. Declare its package in the system ` +
        `includes or move it under the project root.`
      : !ctx.extensionsSet.has(extname(path))
        ? `whose extension is not in the configured source extensions.`
        : // `.mdx` ingests on its first watcher edit instead: a parent
          // declared in MDX is a style declaration there, which ingestion
          // rejects, so a folded `.mdx` is re-quarantined every pass.
          extname(path) === '.mdx' || ctx.session?.heldSources.has(relPath)
          ? null
          : undefined;
  if (reason === undefined) return { kind: 'fold', path };
  if (reason === null) return { kind: 'none' };
  return {
    kind: 'inadmissible',
    reason: `resolves to ${relPath}, ${reason}`,
  };
}

/**
 * Folds the on-disk files the manifest's dropped extensions name as missing
 * parents into the Session, in one bounded pass, and returns the outcomes
 * of that attempt. A parent no file answers, or one that cannot be
 * admitted, leaves its drop standing: the transform then fails rather than
 * serving builder code (SA1).
 */
export async function reconcileSourceCorpus(
  ctx: PluginContext
): Promise<ObservedOutcome[]> {
  if (ctx.isProd || ctx.session === null) return [];
  const drops = [...droppedExtensions(ctx).values()];
  if (drops.length === 0) {
    // Drops resolved — future occurrences of the same conditions warn anew.
    warnedVerdicts.get(ctx)?.clear();
    return [];
  }
  const folded = new Set<string>();
  const inadmissible: Array<[ManifestMissingInput, string]> = [];
  for (const drop of drops) {
    const onDisk = parentOnDisk(ctx, drop);
    if (onDisk.kind === 'fold') folded.add(onDisk.path);
    else if (onDisk.kind === 'inadmissible') {
      inadmissible.push([drop, onDisk.reason]);
    }
  }
  warnInadmissibleParents(ctx, drops, inadmissible);
  if (folded.size === 0) return [];
  ctx.log(
    `rediscovery: folded ${folded.size} on-disk file(s) a dropped extension names as its parent`
  );
  // The Session reads them: a file it cannot read is lost input it reports,
  // and an attempt that fails keeps none of them for the next pass.
  return ctx.submitChanges({ modifiedFiles: folded });
}

/** Warns, once per condition, for parents that resolve on disk but cannot
 *  be admitted. */
function warnInadmissibleParents(
  ctx: PluginContext,
  drops: readonly ManifestMissingInput[],
  inadmissible: ReadonlyArray<[ManifestMissingInput, string]>
): void {
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
  for (const [drop, reason] of inadmissible) {
    const verdictKey = `${drop.file}\0${drop.parent}\0${reason}`;
    if (warned.has(verdictKey)) continue;
    warned.add(verdictKey);
    ctx.warn(
      `cannot extract '${drop.component}': parent '${drop.parent}' ${reason}`
    );
  }
}
