import type { PluginContext } from '../src/context';

/**
 * The stand-in `PluginContext` that behavioral tests drive hook bodies with.
 *
 * `vi.mock` is a no-op in this repo's runner, so a hook is exercised by handing
 * it a plain object carrying exactly the state it touches. The fields below are
 * the ones every such driver needs — plus the counters the assertions read,
 * which live on the returned probe as plain properties the context's own
 * closures increment.
 *
 * A caller adds whatever else its hook reaches for through `extras` (spread
 * last, so it may also replace a default), and replaces `ctx.runAnalysis` when
 * the analysis has to publish something.
 */
export interface ContextProbe {
  ctx: PluginContext;
  analyses: number;
  extractedInvalidations: number;
  /** Standard-level lines (`ctx.info`). */
  infoLines: string[];
  /** Verbose-only lines (`ctx.log`). */
  verboseLines: string[];
}

export function makeContextProbe(
  rootDir: string,
  extras: Record<string, unknown> = {}
): ContextProbe {
  const probe: ContextProbe = {
    ctx: null as unknown as PluginContext,
    analyses: 0,
    extractedInvalidations: 0,
    infoLines: [],
    verboseLines: [],
  };
  const ctx = {
    isProd: false,
    verbose: false,
    rootDir,
    options: {},
    externalPackageDirs: [] as string[],
    fileCache: new Map<string, { hash: string; source: string }>(),
    storedManifest: { components: {}, files: {} },
    // The four inputs `virtual:animus/system-props` is generated from. The
    // engine republishes them on every analysis whether or not they moved.
    storedSystemPropMapJson: '{}',
    storedDynamicPropsJson: '{}',
    storedTransformsSource: '{}',
    system: { groupRegistryJson: '{}' },
    runAnalysis() {
      probe.analyses++;
    },
    invalidateExtractedModules() {
      probe.extractedInvalidations++;
    },
    log(msg: string) {
      probe.verboseLines.push(msg);
    },
    info(msg: string) {
      probe.infoLines.push(msg);
    },
    warn() {},
    logTimingWaterfall() {},
    ...extras,
  };
  probe.ctx = ctx as unknown as PluginContext;
  return probe;
}
