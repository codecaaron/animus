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

/** The two stylesheets the plugin serves in dev, plus their bundler revisions. */
export interface DevArtifacts {
  /** `virtual:animus/styles.css` — variable block + global layer. */
  staticCss: string;
  /** `virtual:animus/components.js` — the adopted component stylesheet. */
  componentCss: string;
  /**
   * Monotonic invalidation stamp for the static module. Bumps whenever the
   * bundler invalidates it, which is how a geological reset is observed
   * independently of whether the CSS text happened to change.
   */
  staticRevision: number;
  /** Monotonic invalidation stamp for the component module. */
  componentRevision: number;
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
  /** Tear the server down. Safe to call when `start` never ran. */
  close(): Promise<void>;
}

export interface UntilOptions {
  /** Short description of the awaited condition, used in the failure message. */
  what: string;
  timeoutMs?: number;
  everyMs?: number;
  /**
   * Rendered into the failure message. Called only on timeout, so it can read
   * the server again and report the state actually observed last.
   */
  describe?: () => string | Promise<string>;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_EVERY_MS = 25;

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
 */
export function createWatcherBarrier(
  writeSentinel: (marker: string) => void,
  read: () => Promise<DevArtifacts>
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
        describe: async () =>
          `sentinel ${marker} absent from component CSS:\n${(await read()).componentCss}`,
      }
    );
  };
}

/** Whitespace-insensitive comparison key for two served stylesheets. */
export function canonicalizeCss(css: string): string {
  return css.replace(/\s+/g, ' ').trim();
}
