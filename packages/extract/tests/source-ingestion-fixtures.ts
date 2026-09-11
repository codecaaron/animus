import { contentHash } from '../pipeline/content-hash';
import {
  createSourceIngestor,
  type RawSourceEntry,
  type SourceIngestionDiagnostic,
  type SourceIngestor,
  type SourceIngestorHost,
} from '../pipeline/source-ingestion';

export function makeHost(
  options: {
    strict?: boolean;
    warnings?: string[];
    extractFacts?: (filesJson: string) => string;
  } = {}
): SourceIngestorHost {
  const { strict = false, warnings = [], extractFacts } = options;
  return {
    engineApi: () => (extractFacts ? { extractFacts } : {}),
    prefix: '[animus-test]',
    strict: () => strict,
    warn: (message) => {
      warnings.push(message);
    },
  };
}

export const FATAL_DIAGNOSTIC = {
  code: 'SOURCE_SVELTE_DEPENDENCY_MISSING' as const,
  originalPath: 'src/Usage.svelte',
  message: 'install svelte to project opted-in source',
};

export const ADVISORY_DIAGNOSTIC = {
  code: 'SOURCE_NATIVE_PARSE_ERROR' as const,
  originalPath: 'src/app.js',
  analysisPath: 'src/app.js',
  message: 'Unexpected JSX expression',
};

export function scriptedSourceIngestor(
  host: SourceIngestorHost,
  options: {
    children?: Record<string, RawSourceEntry[]>;
    diagnostics?: SourceIngestionDiagnostic[];
  } = {}
): SourceIngestor & { ingested: RawSourceEntry[][] } {
  const ingested: RawSourceEntry[][] = [];
  const { surfaceDiagnostics, markPublished } = createSourceIngestor(host);
  return {
    ingested,
    surfaceDiagnostics,
    markPublished,
    async ingest(entries) {
      ingested.push([...entries]);
      const originalEntries = entries.map((entry) => ({
        ...entry,
        hash: entry.hash ?? contentHash(entry.source),
      }));
      const analysisEntries: Array<{
        path: string;
        source: string;
        hash: string;
      }> = [];
      const ownership: Record<
        string,
        { originalPath: string; originalHash: string; analysisPaths: string[] }
      > = {};
      for (const original of originalEntries) {
        const children = (options.children?.[original.path] ?? [original]).map(
          (child) => ({
            ...child,
            hash: child.hash ?? contentHash(child.source),
          })
        );
        analysisEntries.push(...children);
        ownership[original.path] = {
          originalPath: original.path,
          originalHash: original.hash,
          analysisPaths: children.map((child) => child.path),
        };
      }
      return {
        originalEntries,
        analysisEntries,
        ownership,
        diagnostics: options.diagnostics ?? [],
      };
    },
  };
}
