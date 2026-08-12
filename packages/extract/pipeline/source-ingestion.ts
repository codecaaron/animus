import { posix } from 'node:path';

import { contentHash } from './content-hash';
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
  /** Optional precomputed hash of the raw original source. */
  hash?: string;
}

export interface OriginalSourceEntry {
  path: string;
  source: string;
  /** Hash of the raw original source, never a generated projection. */
  hash: string;
}

export interface AnalysisSourceEntry {
  path: string;
  source: string;
  /** Hash of this parser-ready entry. */
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

export interface ExtractFileFacts {
  path: string;
  chains: ExtractChainFact[];
  imports: ExtractImportFact[];
  exports: ExtractExportFact[];
  parseDiagnostics: string[];
  [key: string]: unknown;
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
 * Advisory diagnostics surface as warnings in EVERY mode and never
 * quarantine their file. OXC reports recovered parse diagnostics for
 * sources the consumer's own toolchain may accept (`.js` now parses
 * JSX-enabled, so genuinely malformed code is the remaining producer),
 * and the engine still analyzes whatever the recovered AST carries —
 * failing the build for that would make extraction stricter than the
 * host bundler, which surfaces its own error for the same file. Everything
 * else stays fatal: strict throws, non-strict warns and quarantines.
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
  /** Raw inputs keyed and hashed by their original source identity. */
  originalEntries: OriginalSourceEntry[];
  /** Parser-ready entries sent to analysis; Svelte itself is never a target. */
  analysisEntries: AnalysisSourceEntry[];
  /** Atomic original-to-generated ownership, including zero-entry owners. */
  ownership: Record<string, SourceEntryOwnership>;
  diagnostics: SourceIngestionDiagnostic[];
}

export interface CachedFileFacts {
  /** Hash of the analysis entry the facts were extracted from. */
  hash: string;
  facts: ExtractFileFacts;
}

export interface SourceIngestionOptions {
  /** Typed pass-through to the native `extractFacts(filesJson)` surface. */
  extractFacts(filesJson: string): string;
  /**
   * Host-owned per-file facts memo: an incremental corpus pass re-extracts
   * only entries whose (path, hash) pair changed and evicts paths absent
   * from the current corpus. Without it every pass re-parses the whole
   * corpus through the native boundary — a per-keystroke tax on the HMR
   * and watch paths that both hosts route through here.
   */
  factsCache?: Map<string, CachedFileFacts>;
  /** Test seams; production callers use the dynamically loaded defaults. */
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

/** NodeNext-style relative specifiers carry the EMITTED extension
 *  (`./definition.js` for `definition.ts`); map each back to its source
 *  forms. The exact spelling is probed first by the suffix loop's empty
 *  suffix, so a literal `.js` neighbor still wins. */
const NODE_NEXT_EXTENSION_MAP: Readonly<Record<string, readonly string[]>> = {
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
  /** The same (importer, request) pair repeats for every call site of one
   *  resolver in one file; the index is rebuilt per ingest, so neither memo
   *  needs invalidation. */
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

    // The walk above proved the export chain terminates in an extractable
    // `.asClass()` binding, and the engine's usage identity now follows the
    // same chains (sourced re-export hops via follow_reexports plus the
    // defining-module local-rename unwrap), so a renamed import witnesses
    // and prunes end-to-end — the former name-equality boundary guarded an
    // engine gap that no longer exists.
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
 * Convert raw source identities into parser-ready analysis entries once.
 *
 * Native and MDX entries establish the resolver-export index through the
 * native fact collector before any Svelte projection. Svelte calls are then
 * attributed by exact relative import/export identity and parsed once. Bare
 * package and configured-alias sources deliberately remain `other`; callers
 * must not guess those identities.
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

  // Identity entries carry their original's precomputed hash; only generated
  // MDX/Svelte projections hash fresh content here.
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
 * Run the native fact collector, re-extracting only changed entries when the
 * caller supplies a `factsCache`. `parseCount` keeps its meaning — parses
 * performed by THIS call — so a fully-memoized pass reports zero.
 */
function collectFileFacts(
  analysisEntries: readonly AnalysisSourceEntry[],
  options: SourceIngestionOptions
): ExtractFactsResult {
  const cache = options.factsCache;
  if (!cache) {
    return JSON.parse(
      options.extractFacts(JSON.stringify(analysisEntries))
    ) as ExtractFactsResult;
  }
  const pending = analysisEntries.filter(
    (entry) => cache.get(entry.path)?.hash !== entry.hash
  );
  let parseCount = 0;
  if (pending.length > 0) {
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
 * The per-file quarantine: drop every original a diagnostic named — and the
 * analysis children it owns — so one invalid source never aborts the rest
 * of the corpus. Shared by buildStart AND every incremental path in both
 * hosts; asymmetry here is how a permanently-diagnosable file (an `.mdx`
 * with the optional peer absent, an unsupported `.svelte` shape) froze all
 * re-analysis for the life of the dev server.
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

export interface SourceIngestorHost {
  /** Engine access at call time; `extractFacts` stays optional on the shared
   *  EngineApi for test doubles — the capability guard lives HERE, once. */
  engineApi(): { extractFacts?: (filesJson: string) => string };
  /** Host log prefix, e.g. `[animus-extract]` / `[animus-next]`. */
  prefix: string;
  strict(): boolean;
  warn(message: string): void;
}

export interface SourceIngestor {
  /** Prepare one raw-source corpus through the shared adaptation boundary. */
  ingest(entries: readonly RawSourceEntry[]): Promise<SourceIngestionResult>;
  /** Surface adapter diagnostics under ONE strict/warn/quarantine policy:
   *  advisory diagnostics warn in every mode and never quarantine; fatal
   *  diagnostics throw under strict, else warn once per (original, message)
   *  and join the returned quarantine set. */
  surfaceDiagnostics(
    diagnostics: readonly SourceIngestionDiagnostic[]
  ): Set<string>;
  /** Reset the warn dedupe for originals that published clean, so a future
   *  regression re-warns. Call from the host's publish step. */
  markPublished(result: SourceIngestionResult): void;
}

/**
 * The one source-ingestion policy point shared by every host (vite-plugin,
 * next-plugin, cli, unplugin). Hosts hold exactly their prefix, strict flag,
 * and warn sink; the capability guard, facts memo, and warn-dedupe lifecycle
 * live here so the plugins cannot fork (precedent: pkg-collection
 * divergences; see also `enforceExternalTokenContracts`).
 */
export function createSourceIngestor(host: SourceIngestorHost): SourceIngestor {
  const factsCache = new Map<string, CachedFileFacts>();
  /** Non-strict warn dedupe: a quarantined-but-retained original re-ingests
   *  on every later corpus pass, and re-warning each save is noise. Keyed by
   *  original path; cleared when that original publishes clean again. */
  const warnedByOriginal = new Map<string, Set<string>>();
  return {
    async ingest(entries) {
      const extractFacts = host.engineApi().extractFacts;
      if (typeof extractFacts !== 'function') {
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
