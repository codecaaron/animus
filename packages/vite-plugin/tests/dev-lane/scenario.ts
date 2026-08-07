/**
 * Bundler-neutral scenario contract for the dev-server conformance lane.
 *
 * A scenario drives file mutations against a running dev server and asserts on
 * the ARTIFACTS the server hands a browser plus the REVISION the bundler
 * assigns them. Nothing here mentions Vite: `vite-adapter.ts` is the only
 * implementation today, and a second runtime (Next/Turbopack) would satisfy the
 * same interface without touching the scenarios.
 *
 * Waiting is always bounded and evidence-based — `until` polls an observable
 * artifact, never a wall-clock sleep, and reports the last observed state when
 * it gives up.
 */

/** The modules the plugin serves in dev, plus their bundler revisions. */
export interface DevArtifacts {
  /** `virtual:animus/styles.css` — variable block + global layer. */
  staticCss: string;
  /** `virtual:animus/components.js` — the adopted component stylesheet. */
  componentCss: string;
  /** `virtual:animus/system-props` — the shared prop map module's source. */
  systemProps: string;
  /**
   * Monotonic invalidation stamp for the static module. Bumps whenever the
   * bundler invalidates it, which is how a geological reset is observed
   * independently of whether the CSS text happened to change.
   */
  staticRevision: number;
  /** Monotonic invalidation stamp for the component module. */
  componentRevision: number;
  /**
   * Monotonic invalidation stamp for the shared prop map module. Every module
   * that renders a system prop imports it, so this stamp is the observable
   * blast radius of an edit.
   */
  systemPropsRevision: number;
}

/** One dev server under test. Implemented per bundler. */
export interface DevServerAdapter {
  /** Human name used in assertion messages (e.g. `vite`). */
  readonly name: string;
  /** Boot a dev server rooted at `root`. Resolves once the server is usable. */
  start(root: string): Promise<void>;
  /** Fetch the currently served artifacts through the server's own pipeline. */
  read(): Promise<DevArtifacts>;
  /**
   * Request one project file as a browser would. Exercises the plugin's
   * per-file transform, which is where a file created after start-up is
   * discovered.
   */
  requestSource(projectRelativePath: string): Promise<string>;
  /**
   * Request an arbitrary browser URL through the server's own pipeline —
   * including the non-file URLs a virtual module is served under.
   */
  requestUrl(url: string): Promise<string>;
  /**
   * The document a browser receives for `/`: the fixture's `index.html` after
   * every `transformIndexHtml` hook (the plugin's included) has run. This is
   * the only artifact that carries delivery decisions made per SERVED
   * DOCUMENT rather than per module.
   */
  indexHtml(): Promise<string>;
  /** Tear the server down. Safe to call when `start` never ran. */
  close(): Promise<void>;
  /**
   * Recent watcher/logger events, oldest first — the adapter's evidence
   * trail. Optional: an adapter without one degrades to CSS-only timeout
   * messages.
   */
  trace?(): string[];
  /**
   * Every hot payload path the client environment has sent, oldest first
   * (`'full-reload'` for full reloads). Optional: adapters without payload
   * capture cannot run the presentation-only suppression scenarios.
   */
  hotUpdatePaths?(): string[];
  /**
   * Whether every module node for the given project file currently holds a
   * transform result (i.e. is not sitting invalidated). Optional; used by
   * the suppression scenarios to prove the gate re-warmed the module.
   */
  isModuleWarm?(projectRelativePath: string): boolean;
}

/** The last portion of an adapter's evidence trail, ready for a message. */
export function renderTrace(adapter: DevServerAdapter, lastLines = 60): string {
  const lines = adapter.trace?.() ?? [];
  if (lines.length === 0) return '';
  return `\nEvent trace (last ${Math.min(lastLines, lines.length)} of ${lines.length}):\n${lines
    .slice(-lastLines)
    .join('\n')}`;
}

export interface UntilOptions {
  /** Short description of the awaited condition, used in the failure message. */
  what: string;
  timeoutMs?: number;
  everyMs?: number;
  /**
   * Re-issue the mutation the probe is waiting on. Called every
   * `REASSERT_EVERY_POLLS` polls (~1s) while the probe still reports
   * "not yet".
   *
   * Why it exists: the dev server's vendored chokidar throttles change events
   * per path (50ms in `_emit`, drop — NOT redeliver), so a write landing
   * <50ms after the previous change event on the SAME path produces no event
   * at all, and nothing downstream can ever observe it (observed on CI where
   * back-to-back scenarios edit one file <50ms apart; reproduced locally
   * with two same-file writes ~30ms apart). Any wait on such a write must
   * re-assert it: the rewrite is idempotent at the plugin layer — when the
   * original event was delivered it hash-skips as unchanged — and when the
   * event was throttled away the rewrite, now outside the window, emits the
   * event that carries the mutation in.
   */
  reassert?: () => void;
  /**
   * Rendered into the failure message. Called only on timeout, so it can read
   * the server again and report the state actually observed last.
   */
  describe?: () => string | Promise<string>;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_EVERY_MS = 25;
/** Cadence of `UntilOptions.reassert`: ~1s at the 25ms poll interval. */
const REASSERT_EVERY_POLLS = 40;

/**
 * Poll `probe` until it yields a value, then return it. `false` means
 * "not yet".
 *
 * The plugin coalesces resets behind a short quiescence window, so every
 * post-mutation assertion goes through here rather than through a sleep: the
 * loop absorbs the window and the timeout is the only clock in the lane.
 */
export async function until<T>(
  probe: () => T | false | Promise<T | false>,
  options: UntilOptions
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const everyMs = options.everyMs ?? DEFAULT_EVERY_MS;
  const startedAt = Date.now();
  let attempts = 0;

  for (;;) {
    const last = await probe();
    attempts += 1;
    if (last !== false) return last;
    if (options.reassert && attempts % REASSERT_EVERY_POLLS === 0) {
      options.reassert();
    }

    const elapsed = Date.now() - startedAt;
    if (elapsed >= timeoutMs) {
      const rendered = options.describe
        ? await options.describe()
        : '(no reporter supplied)';
      throw new Error(
        `until(${options.what}) gave up after ${elapsed}ms / ${attempts} polls. ` +
          `Last observed: ${rendered}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
}

/**
 * A watcher barrier: proof that the dev server has drained every file event
 * written before the barrier call.
 *
 * Negative assertions ("this edit must NOT change the artifact") cannot be
 * proven by waiting a fixed time. Instead the scenario writes its mutation,
 * then writes a sentinel component whose style value is unique, then waits for
 * that sentinel value to appear in the served component CSS. Once the sentinel
 * has landed the earlier write has been delivered too, so the negative
 * assertion is a single read rather than a race with a sleep.
 *
 * One watcher semantic the barrier must absorb: a sentinel write landing hot
 * on the heels of the previous sentinel event can be throttled away entirely
 * (see `UntilOptions.reassert` for the mechanism), so the barrier re-asserts
 * the SAME marker on a slow pickup. Drainage still holds: every pre-barrier
 * mutation event precedes the first sentinel write, so observing any sentinel
 * write proves them delivered.
 */
export function createWatcherBarrier(
  writeSentinel: (marker: string) => void,
  read: () => Promise<DevArtifacts>,
  describeExtra?: () => string
): () => Promise<void> {
  let counter = 0;
  return async () => {
    counter += 1;
    const marker = `${100 + counter}px`;
    writeSentinel(marker);
    await until(
      async () => (await read()).componentCss.includes(marker) || false,
      {
        what: `watcher barrier #${counter} (sentinel padding ${marker})`,
        reassert: () => writeSentinel(marker),
        describe: async () =>
          `sentinel ${marker} absent from component CSS:\n${(await read()).componentCss}${describeExtra?.() ?? ''}`,
      }
    );
  };
}

/** Whitespace-insensitive comparison key for two served stylesheets. */
export function canonicalizeCss(css: string): string {
  return css.replace(/\s+/g, ' ').trim();
}
