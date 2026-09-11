import { posix } from 'node:path';

import { contentHash } from './content-hash';
import { parseInternalWire } from './internal-wire';
import { preprocessMdx, type PreprocessMdxResult } from './mdx-preprocessor';
import {
  adaptSvelteSource,
  type AdaptSvelteSourceResult,
  type SvelteAdapterDiagnostic,
  type SvelteResolverAttribution,
  type SvelteResolverAttributionRequest,
} from './svelte-source-adapter';

export interface RawSourceEntry {
  path: string;
  source: string;
  hash?: string;
}

type FilesJsonValue =
  | null
  | boolean
  | number
  | string
  | FilesJsonValue[]
  | { [key: string]: FilesJsonValue };

/**
 * The index signature is load-bearing: a caller that re-serializes this corpus
 * after editing it must not strip fields a newer writer added.
 */
export type SerializedSourceEntry = RawSourceEntry & {
  [key: string]: FilesJsonValue;
};

function isSerializedSourceEntry(
  value: FilesJsonValue
): value is SerializedSourceEntry {
  if (!(value instanceof Object) || Array.isArray(value)) return false;
  return (
    String(value.path) === value.path &&
    String(value.source) === value.source &&
    (value.hash === undefined || String(value.hash) === value.hash)
  );
}

/**
 * Throws on a payload that is not a corpus: an empty corpus is
 * indistinguishable from "no files" and would publish an empty stylesheet.
 */
export function parseFilesJson(
  filesJson: string,
  context: string
): SerializedSourceEntry[] {
  const candidate: FilesJsonValue = parseInternalWire(
    filesJson,
    `${context} filesJson`
  );
  if (!Array.isArray(candidate) || !candidate.every(isSerializedSourceEntry)) {
    throw new TypeError(
      `[${context}] analysis files JSON must be an array of {path, source} entries`
    );
  }
  return candidate;
}

export interface OriginalSourceEntry {
  path: string;
  source: string;
  hash: string;
}

export interface AnalysisSourceEntry {
  path: string;
  source: string;
  hash: string;
}

export interface SourceEntryOwnership {
  originalPath: string;
  originalHash: string;
  analysisPaths: string[];
}

export interface ExtractImportFact {
  local: string;
  imported: string;
  source: string;
}

export interface ExtractExportFact {
  exported: string;
  local: string | null;
  source: string | null;
  original: string | null;
}

export interface ExtractChainFact {
  descriptor: {
    binding: string;
    terminal: string;
    extractable: boolean;
  };
  fatalError: string | null;
}

/**
 * A partial transcription of the engine's per-file facts wire: `statics`,
 * `usage`, `compose`, and `transforms` exist on it and are added when read.
 */
export interface ExtractFileFacts {
  path: string;
  chains: ExtractChainFact[];
  imports: ExtractImportFact[];
  exports: ExtractExportFact[];
  parseDiagnostics: string[];
}

export interface ExtractFactsResult {
  files: Record<string, ExtractFileFacts>;
  parseCount: number;
}

export interface NativeSourceDiagnostic {
  code: 'SOURCE_NATIVE_PARSE_ERROR';
  message: string;
  originalPath: string;
  analysisPath: string;
}

/**
 * Advisory diagnostics warn in every mode and never quarantine their file:
 * OXC recovers parse errors the host bundler itself accepts. All else is fatal.
 */
export function isAdvisorySourceDiagnostic(
  diagnostic: SourceIngestionDiagnostic
): boolean {
  return diagnostic.code === 'SOURCE_NATIVE_PARSE_ERROR';
}

export interface SourceParserDiagnostic {
  code:
    | 'SOURCE_MDX_DEPENDENCY_MISSING'
    | 'SOURCE_MDX_PARSE_ERROR'
    | 'SOURCE_SVELTE_DEPENDENCY_MISSING';
  message: string;
  originalPath: string;
}

export interface AnalysisPathCollisionDiagnostic {
  code: 'SOURCE_ANALYSIS_PATH_COLLISION';
  message: string;
  originalPath: string;
  analysisPath: string;
  conflictingOriginalPath: string;
}

export interface ResolverIdentityCollisionDiagnostic {
  code: 'SOURCE_RESOLVER_IDENTITY_COLLISION';
  message: string;
  originalPath: string;
  canonicalPath: string;
  conflictingOriginalPath: string;
}

export type SourceIngestionDiagnostic =
  | NativeSourceDiagnostic
  | SourceParserDiagnostic
  | AnalysisPathCollisionDiagnostic
  | ResolverIdentityCollisionDiagnostic
  | SvelteAdapterDiagnostic;

export interface SourceIngestionResult {
  originalEntries: OriginalSourceEntry[];
  /** Parser-ready entries sent to analysis; a `.svelte` path is never one. */
  analysisEntries: AnalysisSourceEntry[];
  /** Ownership per original, including originals with zero analysis paths. */
  ownership: Record<string, SourceEntryOwnership>;
  diagnostics: SourceIngestionDiagnostic[];
}

export interface CachedFileFacts {
  hash: string;
  facts: ExtractFileFacts;
}

export interface SourceIngestionOptions {
  extractFacts(filesJson: string): string;
  /** Host-owned memo reused across passes; without it every pass re-parses
   *  the whole corpus through the native boundary. */
  factsCache?: Map<string, CachedFileFacts>;
  /** Test seams; production callers use the module defaults. */
  preprocessMdx?: (
    source: string,
    filename: string
  ) => Promise<PreprocessMdxResult>;
  adaptSvelte?: typeof adaptSvelteSource;
}

const RELATIVE_PROBE_SUFFIXES = [
  '',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '/index.ts',
  '/index.tsx',
  '/index.js',
  '/index.jsx',
] as const;

function extension(path: string): string {
  const basename = posix.basename(path);
  const dot = basename.lastIndexOf('.');
  return dot === -1 ? '' : basename.slice(dot).toLowerCase();
}

function canonicalResolverPath(path: string): string {
  return posix.normalize(path.replaceAll('\\', '/'));
}

/** NodeNext relative specifiers carry the EMITTED extension (`./x.js` for
 *  `x.ts`); the literal spelling is probed first, so a `.js` neighbor wins. */
interface NodeNextExtensionMap {
  readonly [emitted: string]: readonly string[] | undefined;
}

const NODE_NEXT_EXTENSION_MAP: NodeNextExtensionMap = {
  '.js': ['.ts', '.tsx', '.jsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
};

function resolveRelativeSource(
  importerPath: string,
  specifier: string,
  files: ReadonlyMap<string, string>
): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = posix.normalize(
    posix.join(posix.dirname(canonicalResolverPath(importerPath)), specifier)
  );
  for (const suffix of RELATIVE_PROBE_SUFFIXES) {
    const candidate = `${base}${suffix}`;
    const actualPath = files.get(candidate);
    if (actualPath !== undefined) return actualPath;
  }
  const explicitExtension = extension(base);
  for (const sourceExtension of NODE_NEXT_EXTENSION_MAP[explicitExtension] ??
    []) {
    const candidate = `${base.slice(0, -explicitExtension.length)}${sourceExtension}`;
    const actualPath = files.get(candidate);
    if (actualPath !== undefined) return actualPath;
  }
  return null;
}

class ResolverExportIndex {
  readonly collisions: ReadonlyArray<{
    canonicalPath: string;
    paths: readonly string[];
  }>;

  private readonly files: ReadonlyMap<string, string>;
  private readonly resolverBindings = new Map<string, ReadonlySet<string>>();
  /** Both memos live for one ingest only — the index is rebuilt per call,
   *  so neither needs invalidation. */
  private readonly attributionMemo = new Map<
    string,
    SvelteResolverAttribution
  >();
  private readonly resolveMemo = new Map<string, string | null>();

  constructor(
    private readonly facts: ExtractFactsResult,
    analysisPaths: readonly string[]
  ) {
    const pathsByCanonical = new Map<string, string[]>();
    for (const path of analysisPaths) {
      const canonicalPath = canonicalResolverPath(path);
      const paths = pathsByCanonical.get(canonicalPath) ?? [];
      paths.push(path);
      pathsByCanonical.set(canonicalPath, paths);
    }
    this.collisions = [...pathsByCanonical]
      .filter(([, paths]) => paths.length > 1)
      .map(([canonicalPath, paths]) => ({ canonicalPath, paths }));

    const factPathsByCanonical = new Map<string, string[]>();
    for (const path of Object.keys(facts.files)) {
      const canonicalPath = canonicalResolverPath(path);
      const paths = factPathsByCanonical.get(canonicalPath) ?? [];
      paths.push(path);
      factPathsByCanonical.set(canonicalPath, paths);
    }
    const files = new Map<string, string>();
    for (const [canonicalPath, paths] of pathsByCanonical) {
      const factPaths = factPathsByCanonical.get(canonicalPath) ?? [];
      if (paths.length === 1 && factPaths.length === 1) {
        files.set(canonicalPath, factPaths[0]);
      }
    }
    this.files = files;

    for (const [path, file] of Object.entries(facts.files)) {
      this.resolverBindings.set(
        path,
        new Set(
          file.chains
            .filter(
              (chain) =>
                chain.descriptor.terminal === 'asClass' &&
                chain.descriptor.extractable &&
                chain.fatalError === null
            )
            .map((chain) => chain.descriptor.binding)
        )
      );
    }
  }

  attribute(
    importerPath: string,
    request: SvelteResolverAttributionRequest
  ): SvelteResolverAttribution {
    const memoKey = `${importerPath}\0${request.source}\0${request.imported}\0${request.access.kind}\0${request.access.importKind}`;
    const memoized = this.attributionMemo.get(memoKey);
    if (memoized !== undefined) return memoized;
    const attribution = this.attributeUncached(importerPath, request);
    this.attributionMemo.set(memoKey, attribution);
    return attribution;
  }

  private attributeUncached(
    importerPath: string,
    request: SvelteResolverAttributionRequest
  ): SvelteResolverAttribution {
    const importedFile = this.resolveSource(importerPath, request.source);
    if (!importedFile) return 'other';

    const binding = this.resolveClassExport(
      importedFile,
      request.imported,
      new Set()
    );
    if (binding === null) return 'other';

    return request.access.kind === 'direct' &&
      request.access.importKind === 'named'
      ? 'resolver'
      : 'unsupported-resolver-form';
  }

  private resolveSource(
    importerPath: string,
    specifier: string
  ): string | null {
    const key = `${importerPath}\0${specifier}`;
    let resolved = this.resolveMemo.get(key);
    if (resolved === undefined) {
      resolved = resolveRelativeSource(importerPath, specifier, this.files);
      this.resolveMemo.set(key, resolved);
    }
    return resolved;
  }

  private resolveClassExport(
    path: string,
    exportedName: string,
    seen: Set<string>
  ): string | null {
    const identity = `${path}\0${exportedName}`;
    if (seen.has(identity)) return null;
    seen.add(identity);

    const file = this.facts.files[path];
    const exported = file?.exports.find(
      (candidate) => candidate.exported === exportedName
    );
    if (!file || !exported) return null;

    if (exported.source === null) {
      if (exported.local === null) return null;
      if (this.resolverBindings.get(path)?.has(exported.local)) {
        return exported.local;
      }

      const imported = file.imports.find(
        (candidate) => candidate.local === exported.local
      );
      if (!imported) return null;
      const importedFile = this.resolveSource(path, imported.source);
      return importedFile
        ? this.resolveClassExport(importedFile, imported.imported, seen)
        : null;
    }
    if (exported.original === null) return null;
    const nextFile = this.resolveSource(path, exported.source);
    return nextFile
      ? this.resolveClassExport(nextFile, exported.original, seen)
      : null;
  }
}

/**
 * Native and MDX entries must establish the resolver index before any Svelte
 * projection; bare-package and aliased sources stay unattributed by design.
 */
export async function ingestSourceEntries(
  rawEntries: readonly RawSourceEntry[],
  options: SourceIngestionOptions
): Promise<SourceIngestionResult> {
  const mdxAdapter = options.preprocessMdx ?? preprocessMdx;
  const svelteAdapter = options.adaptSvelte ?? adaptSvelteSource;
  const originalEntries = rawEntries.map((entry) => ({
    ...entry,
    hash: entry.hash ?? contentHash(entry.source),
  }));
  const rawOriginalPaths = new Set(originalEntries.map((entry) => entry.path));
  const analysisEntries: AnalysisSourceEntry[] = [];
  const ownership: Record<string, SourceEntryOwnership> = {};
  const analysisOwner = new Map<string, string>();
  const diagnostics: SourceIngestionDiagnostic[] = [];
  const svelteEntries: OriginalSourceEntry[] = [];

  const addAnalysisEntry = (
    originalPath: string,
    path: string,
    source: string,
    hash?: string
  ): void => {
    analysisEntries.push({ path, source, hash: hash ?? contentHash(source) });
    ownership[originalPath].analysisPaths.push(path);
    analysisOwner.set(path, originalPath);
  };

  const addAdaptedEntries = (
    originalPath: string,
    entries: ReadonlyArray<{ path: string; source: string }>
  ): void => {
    const pendingPaths = new Set<string>();
    for (const entry of entries) {
      const conflictingOriginalPath = rawOriginalPaths.has(entry.path)
        ? entry.path
        : (analysisOwner.get(entry.path) ??
          (pendingPaths.has(entry.path) ? originalPath : null));
      if (conflictingOriginalPath !== null) {
        diagnostics.push({
          code: 'SOURCE_ANALYSIS_PATH_COLLISION',
          message: `Generated analysis path '${entry.path}' collides with '${conflictingOriginalPath}'. Rename one of the source files so adapted analysis paths remain unique.`,
          originalPath,
          analysisPath: entry.path,
          conflictingOriginalPath,
        });
        return;
      }
      pendingPaths.add(entry.path);
    }

    for (const entry of entries) {
      addAnalysisEntry(originalPath, entry.path, entry.source);
    }
  };

  for (const original of originalEntries) {
    ownership[original.path] = {
      originalPath: original.path,
      originalHash: original.hash,
      analysisPaths: [],
    };
    const kind = extension(original.path);
    if (kind === '.svelte') {
      svelteEntries.push(original);
      continue;
    }
    if (kind !== '.mdx') {
      addAnalysisEntry(
        original.path,
        original.path,
        original.source,
        original.hash
      );
      continue;
    }

    const result = await mdxAdapter(original.source, original.path);
    if (result.kind === 'missing-dep') {
      diagnostics.push({
        code: 'SOURCE_MDX_DEPENDENCY_MISSING',
        message:
          "Install optional peer dependency '@mdx-js/mdx' to analyze opted-in MDX source.",
        originalPath: original.path,
      });
      continue;
    }
    if (result.kind === 'error' || result.source === undefined) {
      diagnostics.push({
        code: 'SOURCE_MDX_PARSE_ERROR',
        message: result.error ?? 'MDX preprocessing produced no source.',
        originalPath: original.path,
      });
      continue;
    }
    addAdaptedEntries(original.path, [
      { path: `${original.path}.tsx`, source: result.source },
    ]);
  }

  const facts = collectFileFacts(analysisEntries, options);
  for (const [analysisPath, file] of Object.entries(facts.files)) {
    const originalPath = analysisOwner.get(analysisPath) ?? analysisPath;
    for (const message of file.parseDiagnostics) {
      diagnostics.push({
        code: 'SOURCE_NATIVE_PARSE_ERROR',
        message,
        originalPath,
        analysisPath,
      });
    }
  }

  const resolvers = new ResolverExportIndex(
    facts,
    analysisEntries.map((entry) => entry.path)
  );
  for (const { canonicalPath, paths } of resolvers.collisions) {
    for (let index = 0; index < paths.length; index += 1) {
      const path = paths[index];
      const conflictingPath = paths[(index + 1) % paths.length];
      diagnostics.push({
        code: 'SOURCE_RESOLVER_IDENTITY_COLLISION',
        message: `Resolver lookup paths '${path}' and '${conflictingPath}' normalize to the same private identity '${canonicalPath}'. Rename one of the source files so resolver identities remain unique.`,
        originalPath: analysisOwner.get(path) ?? path,
        canonicalPath,
        conflictingOriginalPath:
          analysisOwner.get(conflictingPath) ?? conflictingPath,
      });
    }
  }
  for (const original of svelteEntries) {
    const result: AdaptSvelteSourceResult = await svelteAdapter(
      original.source,
      original.path,
      {
        attributeResolver: (request) =>
          resolvers.attribute(original.path, request),
      }
    );
    if (result.kind === 'missing-dep') {
      diagnostics.push({
        code: 'SOURCE_SVELTE_DEPENDENCY_MISSING',
        message:
          "Install optional peer dependency 'svelte' to analyze opted-in Svelte source.",
        originalPath: original.path,
      });
      continue;
    }
    if (result.kind === 'error') {
      diagnostics.push(...result.diagnostics);
      continue;
    }
    addAdaptedEntries(original.path, result.entries);
  }

  return { originalEntries, analysisEntries, ownership, diagnostics };
}

/**
 * `parseCount` counts the parses performed by THIS call, so a fully-memoized
 * pass reports zero.
 */
function collectFileFacts(
  analysisEntries: readonly AnalysisSourceEntry[],
  options: SourceIngestionOptions
): ExtractFactsResult {
  const cache = options.factsCache;
  if (!cache) {
    // SAFETY: serde output of the engine's own `extractFacts` NAPI call on
    // this line, shaped as `ExtractFactsResult`; unparseable bytes throw.
    return JSON.parse(
      options.extractFacts(JSON.stringify(analysisEntries))
    ) as ExtractFactsResult;
  }
  const pending = analysisEntries.filter(
    (entry) => cache.get(entry.path)?.hash !== entry.hash
  );
  let parseCount = 0;
  if (pending.length > 0) {
    // SAFETY: same engine surface and wire as the uncached branch, over the
    // pending subset.
    const fresh = JSON.parse(
      options.extractFacts(JSON.stringify(pending))
    ) as ExtractFactsResult;
    parseCount = fresh.parseCount;
    for (const entry of pending) {
      const facts = fresh.files[entry.path];
      if (facts) cache.set(entry.path, { hash: entry.hash, facts });
      else cache.delete(entry.path);
    }
  }
  const currentPaths = new Set(analysisEntries.map((entry) => entry.path));
  for (const path of [...cache.keys()]) {
    if (!currentPaths.has(path)) cache.delete(path);
  }
  const files: Record<string, ExtractFileFacts> = {};
  for (const entry of analysisEntries) {
    const cached = cache.get(entry.path);
    if (cached) files[entry.path] = cached.facts;
  }
  return { files, parseCount };
}

/**
 * Drops each named original and the analysis children it owns. Every corpus
 * path applies it — skipping it on incremental passes freezes re-analysis.
 */
export function withoutInvalidOriginals(
  result: SourceIngestionResult,
  invalidOriginals: ReadonlySet<string>
): SourceIngestionResult {
  if (invalidOriginals.size === 0) return result;
  const ownership = Object.fromEntries(
    Object.entries(result.ownership).filter(
      ([originalPath]) => !invalidOriginals.has(originalPath)
    )
  );
  const analysisPaths = new Set(
    Object.values(ownership).flatMap((owner) => owner.analysisPaths)
  );
  return {
    ...result,
    originalEntries: result.originalEntries.filter(
      (entry) => !invalidOriginals.has(entry.path)
    ),
    analysisEntries: result.analysisEntries.filter((entry) =>
      analysisPaths.has(entry.path)
    ),
    ownership,
  };
}

/** rootDir-relative source path → the external package specifier owning it.
 *  Absence of a key means "not external"; every reader branches on that. */
export interface ExternalFileOwners {
  [sourcePath: string]: string;
}

/**
 * Diagnostics name ANALYSIS paths while ownership is recorded for originals,
 * so projection is required; the result REPLACES the caller's owner map.
 */
export function projectExternalFileOwners(
  result: SourceIngestionResult,
  rawOwners: Readonly<ExternalFileOwners>
): ExternalFileOwners {
  const projected: ExternalFileOwners = {};
  for (const owner of Object.values(result.ownership)) {
    const packageOwner = rawOwners[owner.originalPath];
    if (!packageOwner) continue;
    projected[owner.originalPath] = packageOwner;
    for (const analysisPath of owner.analysisPaths) {
      projected[analysisPath] = packageOwner;
    }
  }
  return projected;
}

export interface SourceIngestorHost {
  engineApi(): { extractFacts?: (filesJson: string) => string };
  /** Host log prefix, e.g. `[animus-extract]`. */
  prefix: string;
  strict(): boolean;
  warn(message: string): void;
}

export interface SourceIngestor {
  ingest(entries: readonly RawSourceEntry[]): Promise<SourceIngestionResult>;
  /** Returns originals to quarantine. Fatal diagnostics throw under strict,
   *  else warn once per (original, message); advisory ones never quarantine. */
  surfaceDiagnostics(
    diagnostics: readonly SourceIngestionDiagnostic[]
  ): Set<string>;
  /** Clears the warn dedupe for the result's originals so a later regression
   *  re-warns; hosts call it from their publish step. */
  markPublished(result: SourceIngestionResult): void;
}

/**
 * One ingestion policy point for every host: a host supplies only a prefix, a
 * strict flag, and a warn sink; policy and per-host memos stay here.
 */
export function createSourceIngestor(host: SourceIngestorHost): SourceIngestor {
  const factsCache = new Map<string, CachedFileFacts>();
  /** Non-strict dedupe: a quarantined original re-ingests on every later
   *  corpus pass, so re-warning it on each save is noise. */
  const warnedByOriginal = new Map<string, Set<string>>();
  return {
    async ingest(entries) {
      const extractFacts = host.engineApi().extractFacts;
      if (extractFacts === undefined) {
        throw new Error(
          `${host.prefix} native engine does not expose extractFacts required for source adaptation`
        );
      }
      return ingestSourceEntries(entries, { extractFacts, factsCache });
    },
    surfaceDiagnostics(diagnostics) {
      const fatal = diagnostics.filter(
        (diagnostic) => !isAdvisorySourceDiagnostic(diagnostic)
      );
      const invalidOriginals = new Set(
        fatal.map((diagnostic) => diagnostic.originalPath)
      );
      if (diagnostics.length === 0) return invalidOriginals;
      if (host.strict() && fatal.length > 0) {
        const lines = fatal.map(
          (diagnostic) =>
            `${diagnostic.code} ${diagnostic.originalPath}: ${diagnostic.message}`
        );
        throw new Error(`${host.prefix} ${lines.join(`\n${host.prefix} `)}`);
      }
      for (const diagnostic of diagnostics) {
        const line = `${diagnostic.code} ${diagnostic.originalPath}: ${diagnostic.message}`;
        let warned = warnedByOriginal.get(diagnostic.originalPath);
        if (!warned) {
          warned = new Set();
          warnedByOriginal.set(diagnostic.originalPath, warned);
        }
        if (warned.has(line)) continue;
        warned.add(line);
        host.warn(`${host.prefix} ${line}`);
      }
      return invalidOriginals;
    },
    markPublished(result) {
      for (const originalPath of Object.keys(result.ownership)) {
        warnedByOriginal.delete(originalPath);
      }
    },
  };
}
