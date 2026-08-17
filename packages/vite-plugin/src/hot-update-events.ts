/**
 * What the owning dispatch decided for one file event, so the remaining
 * environments act on the same decision instead of re-deriving it from state
 * the owner already mutated.
 *
 * - `ignored` — out of extraction scope (extension gate, exclude pattern,
 *   unreadable, MDX skipped): normal Vite HMR applies.
 * - `evicted` — the event WAS claimed, but its decision fell out of the
 *   bounded history before this environment read it. The decision is
 *   unrecoverable and the file is in scope, so every environment that sees it
 *   invalidates conservatively (see hmr.ts). Deliberately NOT `ignored`: that
 *   is the least conservative kind, and reading it here would leave this
 *   environment's graph serving pre-edit component CSS, a pre-edit
 *   system-props module, and pre-edit definition files — the client/SSR skew
 *   that shows up as a hydration mismatch.
 * - `unchanged` — content hash identical: the update is suppressed everywhere.
 * - `analyzed` — re-analysis ran; every environment invalidates the affected
 *   modules in its own graph. `staleDefinitionFiles` are rootDir-relative
 *   definition files whose component replacement changed (the changed file
 *   itself is never listed). `systemPropsChanged` reports whether the served
 *   system-props module moved (see the transaction-spanning compare in
 *   hmr.ts `analyzeChangedFile`) — only the owning dispatch holds the
 *   before/after values, so it travels with the decision rather than being
 *   re-derived per environment.
 *   `presentationOnly` reports that the changed file's transform output is
 *   byte-identical before and after the edit (style values are not part of
 *   the emitted replacement — class names hash `filename::binding`): every
 *   environment then excludes the file's own modules from the update it
 *   returns, so the module never re-executes and React component identity,
 *   generated IDs, focus, and DOM-owned state survive the edit. Computed once
 *   by the owning dispatch (it needs the pre-edit source and manifest, which
 *   the owner consumed while re-analyzing) — the same travel rule as
 *   `systemPropsChanged`.
 */
export type HotUpdateResult =
  | { kind: 'ignored' }
  | { kind: 'evicted' }
  | { kind: 'unchanged' }
  | {
      kind: 'analyzed';
      staleDefinitionFiles: string[];
      systemPropsChanged: boolean;
      presentationOnly: boolean;
    };

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
 * result. A decision pushed out of that window leaves a tombstone — bounded by
 * the same limit — so a later environment still learns that the event was
 * claimed and analyzed, instead of mistaking it for one nothing ever saw. Past
 * BOTH windows (more than `2 × historyLimit` events in flight) the key is
 * forgotten outright and the event reads as unclaimed again.
 */
export class HotUpdateEvents {
  private readonly results = new Map<string, HotUpdateResult>();
  /** Keys whose decision aged out of `results`, in eviction order. */
  private readonly evicted = new Set<string>();

  constructor(private readonly historyLimit = 16) {}

  /** True when this environment dispatch owns the event's analysis work. */
  claim(environmentName: string, file: string, timestamp: number): boolean {
    const key = eventKey(file, timestamp);
    // A non-client dispatch never re-owns an event the client already took,
    // including one whose decision has since aged out: re-analyzing it would
    // hit the content-hash gate, report `unchanged`, and suppress this
    // environment's update entirely.
    if (
      environmentName !== 'client' &&
      (this.results.has(key) || this.evicted.has(key))
    ) {
      return false;
    }
    this.results.set(key, { kind: 'ignored' });
    // A claim starts a NEW decision for this key, so any tombstone from an
    // earlier event with the same (file, timestamp) is retired with it.
    this.evicted.delete(key);
    this.retireOldest();
    return true;
  }

  /** Publish the owning dispatch's decision to the other environments. */
  record(file: string, timestamp: number, result: HotUpdateResult): void {
    const key = eventKey(file, timestamp);
    this.results.set(key, result);
    // The owner's own key can age out while its analysis awaits; re-recording
    // it makes the fresh decision authoritative again.
    this.evicted.delete(key);
    this.retireOldest();
  }

  /**
   * The decision for this event — `evicted` once it aged out of the decision
   * window, `ignored` only when no dispatch ever claimed it.
   */
  resultOf(file: string, timestamp: number): HotUpdateResult {
    const key = eventKey(file, timestamp);
    const result = this.results.get(key);
    if (result) return result;
    return this.evicted.has(key) ? { kind: 'evicted' } : { kind: 'ignored' };
  }

  /** Hold both windows at `historyLimit`, oldest insertion first. */
  private retireOldest(): void {
    while (this.results.size > this.historyLimit) {
      const oldest = this.results.keys().next().value;
      if (oldest === undefined) break;
      this.results.delete(oldest);
      this.evicted.add(oldest);
    }
    while (this.evicted.size > this.historyLimit) {
      const oldest = this.evicted.values().next().value;
      if (oldest === undefined) break;
      this.evicted.delete(oldest);
    }
  }
}

/** A path can hold any character but NUL, so NUL is the safe separator. */
function eventKey(file: string, timestamp: number): string {
  return `${file}\u0000${timestamp}`;
}
