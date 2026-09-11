/**
 * What the owning dispatch decided for one file event. `evicted` is a lost
 * decision for an in-scope file, so each environment invalidates broadly.
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
 * Vite dispatches `hotUpdate` once per environment, client first: analysis
 * runs for one dispatch, invalidation for all, coordinated through these keys.
 */
export class HotUpdateEvents {
  private readonly results = new Map<string, HotUpdateResult>();
  /** Keys whose decision aged out of `results`, in eviction order. */
  private readonly evicted = new Set<string>();

  constructor(private readonly historyLimit = 16) {}

  /** True when this environment dispatch owns the event's analysis work. */
  claim(environmentName: string, file: string, timestamp: number): boolean {
    const key = eventKey(file, timestamp);
    // A non-client dispatch never re-owns a claimed event: re-analysis hits
    // the content-hash gate and suppresses this environment's update.
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
