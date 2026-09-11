import { compareDiscoveryOrder } from './discover-files';
import {
  createSourceIngestor,
  withoutInvalidOriginals,
  type ExternalFileOwners,
  type RawSourceEntry,
  type SourceEntryOwnership,
  type SourceIngestionResult,
  type SourceIngestor,
  type SourceIngestorHost,
} from './source-ingestion';

type CachedSourceEntry = { hash: string; source: string };

export interface SourceCorpusCache {
  /** rootDir-relative original path → entry. */
  fileCache: ReadonlyMap<string, CachedSourceEntry>;
  /** rootDir-relative external file → owning specifier; absence means "not
   *  external". */
  externalFileOwners: Readonly<ExternalFileOwners>;
}

export interface PublishedSourceCorpus {
  readonly analysisEntries: ReadonlyMap<string, CachedSourceEntry>;
  /** Original path → the analysis entries it owns (zero-entry owners kept). */
  readonly ownership: Readonly<Record<string, SourceEntryOwnership>>;
}

export interface SourceCorpus {
  prepare(
    input: readonly RawSourceEntry[] | SourceCorpusCache
  ): Promise<SourceIngestionResult>;
  publish(accepted: SourceIngestionResult): void;
  readonly published: PublishedSourceCorpus;
}

function assembleRawEntries({
  fileCache,
  externalFileOwners,
}: SourceCorpusCache): RawSourceEntry[] {
  const project: RawSourceEntry[] = [];
  const external: RawSourceEntry[] = [];
  for (const [path, { hash, source }] of fileCache) {
    const target = externalFileOwners[path] === undefined ? project : external;
    target.push({ path, source, hash });
  }
  project.sort((a, b) => compareDiscoveryOrder(a.path, b.path));
  return [...project, ...external];
}

export function createSourceCorpus(
  host: SourceIngestorHost,
  ingestor: SourceIngestor = createSourceIngestor(host)
): SourceCorpus {
  let published: PublishedSourceCorpus = {
    analysisEntries: new Map(),
    ownership: {},
  };
  return {
    async prepare(input) {
      const rawEntries =
        'fileCache' in input ? assembleRawEntries(input) : input;
      const ingested = await ingestor.ingest(rawEntries);
      return withoutInvalidOriginals(
        ingested,
        ingestor.surfaceDiagnostics(ingested.diagnostics)
      );
    },
    publish(accepted) {
      ingestor.markPublished(accepted);
      published = {
        analysisEntries: new Map(
          accepted.analysisEntries.map((entry) => [
            entry.path,
            { hash: entry.hash, source: entry.source },
          ])
        ),
        ownership: accepted.ownership,
      };
    },
    get published() {
      return published;
    },
  };
}
