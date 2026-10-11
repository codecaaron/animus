import { invalidateFileModules } from './module-invalidation';

import type { ObservedOutcome, PluginContext } from './context';
import type { WatchChanges } from '@animus-ui/extract/session';
import type { HotUpdateOptions } from 'vite';

/** The publications of one or more Session attempts, merged. */
export interface MergedPublications {
  published: boolean;
  /** A full pass (a system reload) published. */
  full: boolean;
  endedHold: boolean;
  systemPropsChanged: boolean;
  planChanged: Set<string>;
  redeliver: Set<string>;
}

/** The file event as a Session change set. */
export function changesOf(
  type: HotUpdateOptions['type'],
  absFile: string
): WatchChanges {
  const files = new Set([absFile]);
  return type === 'delete' ? { removedFiles: files } : { modifiedFiles: files };
}

/** What the published outcomes of one submission change, merged. */
export function mergePublished(
  outcomes: readonly ObservedOutcome[]
): MergedPublications {
  const merged = {
    published: false,
    full: false,
    endedHold: false,
    systemPropsChanged: false,
    planChanged: new Set<string>(),
    redeliver: new Set<string>(),
  };
  for (const { outcome, systemPropsChanged } of outcomes) {
    if (outcome.kind !== 'published') continue;
    merged.published = true;
    merged.full ||= outcome.pass === 'full';
    merged.endedHold ||= outcome.endedHold;
    merged.systemPropsChanged ||= systemPropsChanged;
    for (const path of outcome.planChanged) merged.planChanged.add(path);
    for (const path of outcome.redeliver) merged.redeliver.add(path);
  }
  return merged;
}

/** Acts on what every submission's publications owe the module graph: a
 *  publication that ends a hold re-delivers the originals whose bytes
 *  changed meanwhile, and a full pass (a system reload) reloads the
 *  client. */
export function applyPublished(
  ctx: PluginContext,
  merged: MergedPublications
): void {
  if (merged.redeliver.size > 0) {
    invalidateFileModules(ctx, [...merged.redeliver]);
  }
  if (merged.full) {
    // A type-only definition module has no import edge, so importer
    // propagation cannot deliver its new bytes — evict changed plans.
    invalidateFileModules(ctx, [...merged.planChanged]);
    ctx.invalidateSystemReloadModules(true);
  }
}
