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

export interface AbortedParseRejection {
  /** Original path → hash of the bytes whose parse aborted. */
  originals: ReadonlyMap<string, string>;
  message: string;
}

export interface SourceCorpus {
  prepare(
    input: readonly RawSourceEntry[] | SourceCorpusCache
  ): Promise<SourceIngestionResult>;
  /** Non-null when an admitted original's parse aborted: the parser yielded
   *  no chains, imports or exports for it, so analyzing it would publish a
   *  generation without the styles its served module still uses. The attempt
   *  must not analyze or publish; hosts check this between `prepare` and
   *  analysis. */
  rejection(prepared: SourceIngestionResult): AbortedParseRejection | null;
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
    rejection(prepared) {
      const aborted = (prepared.abortedParses ?? []).filter(
        ({ originalPath }) => prepared.ownership[originalPath] !== undefined
      );
      if (aborted.length === 0) return null;
      const files = aborted
        .map(
          ({ originalPath, messages }) =>
            `${originalPath} (${messages.join('; ')})`
        )
        .join(', ');
      const owners = aborted.length === 1 ? "this file's" : "these files'";
      return {
        originals: new Map(
          aborted.map(({ originalPath, hash }) => [originalPath, hash])
        ),
        message: `${host.prefix} analysis not published: the parser stopped before the end of ${files}; fix the syntax error to publish ${owners} changes`,
      };
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
