/**
 * Bundler-neutral contract for the dev-server suite: assertions run on served
 * artifacts and bundler revisions, and no adapter detail belongs here.
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
   * Invalidation stamp for the static module: it bumps on every invalidation,
   * so a system reload is observable even when the CSS text did not change.
   */
  staticRevision: number;
  componentRevision: number;
  /**
   * Invalidation stamp for the shared prop map module. Every module rendering
   * a system prop imports it, so it is the observable blast radius of an edit.
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
   * Request one project file as a browser would, through the plugin's per-file
   * transform — where a file created after start-up is discovered.
   */
  requestSource(projectRelativePath: string): Promise<string>;
  /**
   * Request an arbitrary browser URL, including the non-file URLs a virtual
   * module is served under.
   */
  requestUrl(url: string): Promise<string>;
  /**
   * The document a browser receives for `/`, after every `transformIndexHtml`
   * hook — the only artifact carrying per-document delivery decisions.
   */
  indexHtml(): Promise<string>;
  /** Tear the server down. Safe to call when `start` never ran. */
  close(): Promise<void>;
  /**
   * Recent watcher and logger events, oldest first. Optional: without one,
   * timeout messages carry no event trail.
   */
  trace?(): string[];
  /**
   * Hot payload paths the client environment has sent, oldest first
   * (`'full-reload'` for a full reload). Optional.
   */
  hotUpdatePaths?(): string[];
  /**
   * Whether every module node for the given project file holds a transform
   * result, i.e. none is sitting invalidated. Optional.
   */
  isModuleWarm?(projectRelativePath: string): boolean;
}

export function renderTrace(adapter: DevServerAdapter, lastLines = 60): string {
  const lines = adapter.trace?.() ?? [];
  if (lines.length === 0) return '';
  return `\nEvent trace (last ${Math.min(lastLines, lines.length)} of ${lines.length}):\n${lines
    .slice(-lastLines)
    .join('\n')}`;
}

export interface UntilOptions {
  /** Short description of the awaited condition, for the failure message. */
  what: string;
  timeoutMs?: number;
  everyMs?: number;
  /**
   * Re-issue the awaited mutation every ~1s while the probe reports "not yet":
   * a same-path write under 50ms after the previous event is dropped outright.
   */
  reassert?: () => void;
  /**
   * Rendered into the failure message; called only on timeout, so it may read
   * the server again for the state observed last.
   */
  describe?: () => string | Promise<string>;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_EVERY_MS = 25;
/** Cadence of `UntilOptions.reassert`: ~1s at the 25ms poll interval. */
const REASSERT_EVERY_POLLS = 40;

/**
 * Poll `probe` until it yields a value other than `false` ("not yet"). The
 * loop absorbs the plugin's reset-coalescing window, so no assertion sleeps.
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
 * Proof that every file event written before the call has been delivered: a
 * sentinel component is written and awaited, so a negative read needs no sleep.
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

export function canonicalizeCss(css: string): string {
  return css.replace(/\s+/g, ' ').trim();
}
