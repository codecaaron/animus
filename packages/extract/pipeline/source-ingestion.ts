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

export interface SourceIngestionOptions {
  /** Typed pass-through to the native `extractFacts(filesJson)` surface. */
  extractFacts(filesJson: string): string;
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
  return null;
}

class ResolverExportIndex {
  readonly collisions: ReadonlyArray<{
    canonicalPath: string;
    paths: readonly string[];
  }>;

  private readonly files: ReadonlyMap<string, string>;
  private readonly resolverBindings = new Map<string, ReadonlySet<string>>();

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
    const importedFile = resolveRelativeSource(
      importerPath,
      request.source,
      this.files
    );
    if (!importedFile) return 'other';

    const binding = this.resolveClassExport(
      importedFile,
      request.imported,
      new Set()
    );
    if (binding === null) return 'other';

    return request.access.kind === 'direct' &&
      request.access.importKind === 'named' &&
      binding === request.imported
      ? 'resolver'
      : 'unsupported-resolver-form';
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
      const importedFile = resolveRelativeSource(
        path,
        imported.source,
        this.files
      );
      return importedFile
        ? this.resolveClassExport(importedFile, imported.imported, seen)
        : null;
    }
    if (exported.original === null) return null;
    const nextFile = resolveRelativeSource(path, exported.source, this.files);
    return nextFile
      ? this.resolveClassExport(nextFile, exported.original, seen)
      : null;
  }
}

function addAnalysisEntry(
  analysisEntries: AnalysisSourceEntry[],
  ownership: Record<string, SourceEntryOwnership>,
  analysisOwner: Map<string, string>,
  originalPath: string,
  path: string,
  source: string
): void {
  analysisEntries.push({ path, source, hash: contentHash(source) });
  ownership[originalPath].analysisPaths.push(path);
  analysisOwner.set(path, originalPath);
}

function addAdaptedEntries(
  analysisEntries: AnalysisSourceEntry[],
  ownership: Record<string, SourceEntryOwnership>,
  analysisOwner: Map<string, string>,
  rawOriginalPaths: ReadonlySet<string>,
  diagnostics: SourceIngestionDiagnostic[],
  originalPath: string,
  entries: ReadonlyArray<{ path: string; source: string }>
): void {
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
    addAnalysisEntry(
      analysisEntries,
      ownership,
      analysisOwner,
      originalPath,
      entry.path,
      entry.source
    );
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
        analysisEntries,
        ownership,
        analysisOwner,
        original.path,
        original.path,
        original.source
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
    addAdaptedEntries(
      analysisEntries,
      ownership,
      analysisOwner,
      rawOriginalPaths,
      diagnostics,
      original.path,
      [{ path: `${original.path}.tsx`, source: result.source }]
    );
  }

  const facts = JSON.parse(
    options.extractFacts(JSON.stringify(analysisEntries))
  ) as ExtractFactsResult;
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
    addAdaptedEntries(
      analysisEntries,
      ownership,
      analysisOwner,
      rawOriginalPaths,
      diagnostics,
      original.path,
      result.entries
    );
  }

  return { originalEntries, analysisEntries, ownership, diagnostics };
}
