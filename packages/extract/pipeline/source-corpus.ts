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

/** A driver's raw-source cache, read to assemble one pass's corpus; the
 *  driver keeps ownership of the cache and of how it is updated. */
export interface SourceCorpusCache {
  /** rootDir-relative original path → entry. */
  fileCache: ReadonlyMap<string, CachedSourceEntry>;
  /** rootDir-relative external file → owning specifier; absence means "not
   *  external". */
  externalFileOwners: Readonly<ExternalFileOwners>;
}

/** The parser-ready projection the last successful analysis published. */
export interface PublishedSourceCorpus {
  /** Analysis path → entry, generated MDX/Svelte children included. */
  readonly analysisEntries: ReadonlyMap<string, CachedSourceEntry>;
  /** Original path → the analysis entries it owns (zero-entry owners kept). */
  readonly ownership: Readonly<Record<string, SourceEntryOwnership>>;
}

/** Raw originals in, an accepted parser-ready corpus out. `prepare` may run
 *  any number of times; `publish` only after that corpus analyzed cleanly.
 *
 *  A raw array passed to `prepare` must already be in analysis order; only
 *  the cache arm is ordered here. An unordered array silently reorders the
 *  published artifacts. */
export interface SourceCorpus {
  prepare(
    input: readonly RawSourceEntry[] | SourceCorpusCache
  ): Promise<SourceIngestionResult>;
  publish(accepted: SourceIngestionResult): void;
  readonly published: PublishedSourceCorpus;
}

/** Project files in discovery order, then externals in collection order.
 *  Cache insertion order is not that, and engine output depends on order. */
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

/** One corpus per driver instance. `ingestor` is a test seam; production
 *  callers take the default. */
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
