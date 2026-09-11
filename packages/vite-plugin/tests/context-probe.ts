import {
  contentHash,
  createExcludeMatcher,
  createSourceCorpus,
} from '@animus-ui/extract/pipeline';
import { resolve } from 'path';

import { PluginContext } from '../src/context';
import { makeManifest } from './manifest-fixture';

import type {
  RawSourceEntry,
  SourceIngestor,
} from '@animus-ui/extract/pipeline';
import type { DevEnvironment } from 'vite';

/** Every original is its own analysis entry; nothing is diagnosed, so the
 *  strict/warn policy never engages and publish bookkeeping is a no-op. */
function identityIngestor(): SourceIngestor {
  return {
    async ingest(entries) {
      const originalEntries = entries.map((entry) => ({
        ...entry,
        hash: entry.hash ?? contentHash(entry.source),
      }));
      return {
        originalEntries,
        analysisEntries: originalEntries,
        ownership: Object.fromEntries(
          originalEntries.map((entry) => [
            entry.path,
            {
              originalPath: entry.path,
              originalHash: entry.hash,
              analysisPaths: [entry.path],
            },
          ])
        ),
        diagnostics: [],
      };
    },
    surfaceDiagnostics: () => new Set<string>(),
    markPublished() {},
  };
}

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

interface ProbeModuleNode {
  id: string;
  url: string;
  file: string | null;
}

interface ProbeModuleGraph {
  getModulesByFile(file: string): Set<ProbeModuleNode> | undefined;
  getModuleById(id: string): ProbeModuleNode | undefined;
  invalidateModule(module: ProbeModuleNode): void;
}

type ContextProbeOverrides = Partial<PluginContext>;

/**
 * Minimal environment module-graph double: nodes for one physical `file`
 * (rootDir-relative or absolute; node ids/urls from `ids`, defaulting to the
 * file's absolute path — pass ids alone for virtual-module graphs), and an
 * `invalidated` recording of every invalidateModule call.
 */
export function makeEnvGraph(opts: {
  rootDir: string;
  file?: string;
  ids?: string[];
}) {
  const absPath = opts.file ? resolve(opts.rootDir, opts.file) : null;
  const invalidated: string[] = [];
  const nodes = (opts.ids ?? (absPath ? [absPath] : [])).map((id) => ({
    id,
    url: id,
    file: absPath,
  }));
  const moduleGraph: ProbeModuleGraph = {
    getModulesByFile: (file) =>
      absPath && file === absPath ? new Set(nodes) : undefined,
    getModuleById: (id) => nodes.find((node) => node.id === id),
    invalidateModule: (module) => {
      invalidated.push(module.id);
    },
  };
  return {
    invalidated,
    // SAFETY: The graph probe models the complete method surface exercised by
    // its exact Vite hook consumers; every returned node supplies the id, url,
    // and file fields those consumers observe and pass back to invalidation.
    moduleGraph: moduleGraph as DevEnvironment['moduleGraph'],
  };
}

export function makeContextProbe<Overrides extends ContextProbeOverrides>(
  rootDir: string,
  extras?: Overrides
): ContextProbe {
  let probe: ContextProbe;
  const externalPackageDirs: string[] = [];
  const fileCache: ReadonlyMap<string, { hash: string; source: string }> =
    new Map();
  const externalFileOwners: Record<string, string> = {};
  const reverseProvenance: Record<string, string[]> = {};
  // Only the native adaptation is stood in for: the REAL corpus runs over
  // this ingestor, so hooks exercise production assembly, fold, and publish.
  const corpus = createSourceCorpus(
    {
      engineApi: () => ({}),
      prefix: '[animus-probe]',
      strict: () => false,
      warn() {},
    },
    identityIngestor()
  );
  const ctx = {
    isProd: false,
    verbose: false,
    rootDir,
    options: {},
    externalPackageDirs,
    externalFileOwners,
    // The token-contract gate runs on every publish; with no source theme
    // manifests it indexes nothing, so an empty map exercises it end to end.
    externalDirOwners: {},
    // The context's memoized matcher (PluginContext builds it in its
    // constructor) — hook code reads this, never a per-call construction.
    excludeMatcher: createExcludeMatcher(undefined),
    // Read-only exactly like production's, so every seed and every hook write
    // goes through the borrowed mutator below and the generation counter the
    // barren-walk memo keys on moves in tests as it does in production.
    fileCache,
    fileCacheGeneration: 0,
    // The PRODUCTION mutator, borrowed rather than mirrored (as with
    // `recordFallbackState`): it touches only `fileCache` and
    // `fileCacheGeneration`, both modeled here.
    mutateFileCache: PluginContext.prototype.mutateFileCache,
    corpus,
    rawExtensionFallbacks: new Set<string>(),
    reverseProvenance,
    storedManifest: makeManifest(),
    // The four inputs `virtual:animus/system-props` is generated from. The
    // engine republishes them on every analysis whether or not they moved.
    storedSystemPropMapJson: '{}',
    storedDynamicPropsJson: '{}',
    storedTransformsSource: '{}',
    system: { groupRegistryJson: '{}', sourceThemeManifestsJson: null },
    // Presentation-only gate state (mirrors PluginContext): tests that
    // don't exercise the gate leave the map empty, which fails the gate
    // open (updates deliver normally).
    transformOutputHashes: new Map<string, string>(),
    recordTransformOutput(relativePath: string, code: string) {
      this.transformOutputHashes.set(relativePath, `probe:${code.length}`);
    },
    // The PRODUCTION mutator, borrowed rather than mirrored: it reads only
    // `isProd` and `rawExtensionFallbacks`, both modeled above, so a probe
    // can never disagree with the real fallback bookkeeping.
    recordFallbackState: PluginContext.prototype.recordFallbackState,
    runAnalysis(_entries?: RawSourceEntry[]): boolean | undefined {
      probe.analyses++;
      return undefined;
    },
    // The PRODUCTION transaction, publish, and token gate, borrowed rather
    // than mirrored. They touch `corpus`, `fileCache`, `externalFileOwners`,
    // `externalDirOwners`, `system`, `options`, `storedManifest`,
    // `runAnalysis`, and `warn`, all modeled above.
    analyzeIngested: PluginContext.prototype.analyzeIngested,
    publishSourceIngestion: PluginContext.prototype.publishSourceIngestion,
    enforceExternalTokenContracts:
      PluginContext.prototype.enforceExternalTokenContracts,
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
  probe = {
    // SAFETY: This is the structural hook-test seam documented above. Its
    // modeled base uses owner ingestion/context types, and owner-typed extras
    // are spread last for each exact hook consumer before the seam is exposed.
    ctx: ctx as PluginContext,
    analyses: 0,
    extractedInvalidations: 0,
    infoLines: [],
    verboseLines: [],
  };
  return probe;
}
