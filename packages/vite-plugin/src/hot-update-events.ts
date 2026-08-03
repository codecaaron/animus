/**
 * What the owning dispatch decided for one file event, so the remaining
 * environments act on the same decision instead of re-deriving it from state
 * the owner already mutated.
 *
 * - `ignored` — out of extraction scope (extension gate, exclude pattern,
 *   unreadable, MDX skipped): normal Vite HMR applies.
 * - `unchanged` — content hash identical: the update is suppressed everywhere.
 * - `analyzed` — re-analysis ran; every environment invalidates the affected
 *   modules in its own graph. `staleDefinitionFiles` are rootDir-relative
 *   definition files whose component replacement changed (the changed file
 *   itself is never listed).
 */
export type HotUpdateResult =
  | { kind: 'ignored' }
  | { kind: 'unchanged' }
  | { kind: 'analyzed'; staleDefinitionFiles: string[] };

/**
 * Once-per-file-event coordination across the `hotUpdate` dispatches.
 *
 * Vite 8 calls `hotUpdate` once per environment for a single file event — the
 * client environment first, then every non-client environment (see
 * `handleHMRUpdate` in vite/dist/node/chunks/node.js). Analysis work (cache
 * mutation, engine re-analysis, geological reset scheduling) must happen
 * exactly once per event; module invalidation must happen per environment
 * against that environment's own graph.
 *
 * The client dispatch always claims — it is dispatched first, so nothing can
 * have claimed the event before it, and claiming unconditionally keeps a
 * same-millisecond `(file, timestamp)` collision from ever costing a client
 * analysis. A non-client dispatch claims only when the event carries no
 * recorded claim at all, which happens when the plugin is filtered out of the
 * client environment.
 *
 * Keys are retained for a bounded number of recent events so that interleaved
 * file events (Vite does not serialize watcher handlers) still find their own
 * result.
 */
export class HotUpdateEvents {
  private readonly results = new Map<string, HotUpdateResult>();

  constructor(private readonly historyLimit = 16) {}

  /** True when this environment dispatch owns the event's analysis work. */
  claim(environmentName: string, file: string, timestamp: number): boolean {
    const key = eventKey(file, timestamp);
    if (environmentName !== 'client' && this.results.has(key)) return false;
    this.results.set(key, { kind: 'ignored' });
    while (this.results.size > this.historyLimit) {
      const oldest = this.results.keys().next().value;
      if (oldest === undefined) break;
      this.results.delete(oldest);
    }
    return true;
  }

  /** Publish the owning dispatch's decision to the other environments. */
  record(file: string, timestamp: number, result: HotUpdateResult): void {
    this.results.set(eventKey(file, timestamp), result);
  }

  /** The decision for this event — `ignored` when the event was evicted. */
  resultOf(file: string, timestamp: number): HotUpdateResult {
    return this.results.get(eventKey(file, timestamp)) ?? { kind: 'ignored' };
  }
}

/** A path can hold any character but NUL, so NUL is the safe separator. */
function eventKey(file: string, timestamp: number): string {
  return `${file}\u0000${timestamp}`;
}
