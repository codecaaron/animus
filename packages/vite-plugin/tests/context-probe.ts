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

/** `vi.mock` is a no-op in this runner, so a hook runs against a plain object
 *  carrying the state it touches, extended through `extras`. */
export interface ContextProbe {
  ctx: PluginContext;
  analyses: number;
  extractedInvalidations: number;
  infoLines: string[];
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
    // SAFETY: The probe models every moduleGraph method its Vite consumers
    // call, and each node carries the id, url, and file fields they read back.
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
    externalDirOwners: {},
    excludeMatcher: createExcludeMatcher(undefined),
    fileCache,
    fileCacheGeneration: 0,
    mutateFileCache: PluginContext.prototype.mutateFileCache,
    corpus,
    rawExtensionFallbacks: new Set<string>(),
    reverseProvenance,
    storedManifest: makeManifest(),
    storedSystemPropMapJson: '{}',
    storedDynamicPropsJson: '{}',
    storedTransformsSource: '{}',
    system: { groupRegistryJson: '{}', sourceThemeManifestsJson: null },
    transformOutputHashes: new Map<string, string>(),
    recordTransformOutput(relativePath: string, code: string) {
      this.transformOutputHashes.set(relativePath, `probe:${code.length}`);
    },
    recordFallbackState: PluginContext.prototype.recordFallbackState,
    runAnalysis(_entries?: RawSourceEntry[]): boolean | undefined {
      probe.analyses++;
      return undefined;
    },
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
    // SAFETY: The modeled base uses owner ingestion and context types, and
    // owner-typed extras are spread last for each exact hook consumer.
    ctx: ctx as PluginContext,
    analyses: 0,
    extractedInvalidations: 0,
    infoLines: [],
    verboseLines: [],
  };
  return probe;
}
