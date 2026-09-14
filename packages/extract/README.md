# @animus-ui/extract

Rust/NAPI static CSS extraction pipeline for Animus. Analyzes TypeScript source files using OXC, resolves builder chains against serialized system config, and emits layered CSS.

This package is the shared home of extraction: the `./session` subpath exports the one `ExtractionSession` that every driver drives, and `./pipeline` exports the shared config/option core. It is consumed by [`@animus-ui/vite-plugin`](../vite-plugin), [`@animus-ui/next-plugin`](../next-plugin), the [`@animus-ui/unplugin`](../unplugin) transform host, and the [`animus` CLI](../cli). You typically don't install it directly — the drivers depend on it. For the consumer-facing contract of the standalone drivers (module ids, artifact set, exit codes), see the [standalone extraction contract](https://github.com/codecaaron/animus/blob/main/docs/standalone-extraction.md).

## Platforms

Pre-built binaries for:

- `darwin-arm64` (macOS Apple Silicon)
- `linux-x64-gnu` (Linux x64)
- `linux-arm64-gnu` (Linux ARM64)

## API

v2 is the only engine (v1 was retired — openspec: `retire-extract-v1`); the
package root entry is the engine.

```tsx
import { ExtractEngine, loadSystemModule } from '@animus-ui/extract';

const engine = new ExtractEngine({
  configJson,
  groupRegistryJson,
  themeJson,
  variableMapJson,
  devMode: false,
});
const manifest = engine.analyze(fileEntriesJson);
const { code, hasComponents } = JSON.parse(engine.transformFile(path));
```

### Source corpus

Every driver (the Vite plugin, the extraction session behind the Next
plugin, the CLI, and unplugin) analyzes one source corpus, owned by
`createSourceCorpus` in `@animus-ui/extract/pipeline` (`prepare` →
analyze → `publish`; `published` is the parser-ready projection of the last
successful pass — see the module's own doc comments for the contract).

The Vite plugin and the extraction session are two drivers, not one driver
holding a copy of the other: the session publishes artifacts to disk for
cross-process readers, the Vite context answers virtual modules from memory.
The raw file cache stays with each driver: the Vite context mutates its
cache incrementally under its analysis lock, the session rebinds its cache
wholesale on publish. The ingestion policy point (`createSourceIngestor`) is
not exported from the pipeline barrel; its one production call site is
inside the corpus, asserted by `tests/source-corpus.test.ts`.

## Driver and host obligations

Obligations a driver or host carries that no exported type expresses.

### Hosts and sessions

- `onExternalRootResolved` fires for each admitted root during collection, before that root is walked, so a watching host can open its handle with no blind gap between scan and watch. `onExternalRootsCommitted` fires once after a successful publication with the complete admitted root set; a failed pipeline never fires it, so the host rolls back whatever it opened.
- Every host projects ownership at the same point — after ingestion and before the analysis result is enforced — so that two hosts cannot raise different diagnostics for the same external package. An original that leaves the corpus takes its projected children with it, so no owner outlives the file it described.
- Integrations consume the published replacement epoch rather than deriving their own; pass the served system-props artifact's content as `servedDependencyWitness` so an offline change to that artifact moves the epoch and invalidates persistent-cache snapshots referencing the old one. Absence and an empty string are distinct witness values.

### Ingestion

- A payload that is not a corpus throws, naming the refusing reader, because an empty corpus is indistinguishable from "no files" and would publish an empty stylesheet. Callers with their own documented failure channel translate the throw into it; none may swallow it.
- Keyframes collections are keyed by export name, and a `name.property` reference resolves against whatever local name binds that collection. The binding may arrive either through a cross-file import or through an export in the same file.

### Options

- The `exclude` dialect — globs versus substrings, and the structural exclusions that always apply and cannot be re-admitted — is defined in the [standalone extraction contract](https://github.com/codecaaron/animus/blob/main/docs/standalone-extraction.md#changed-plugin-behavior-release-notes-callout), which every driver shares.

### Assets

- Asset copies are content-addressed and never overwritten, so a revised asset leaves its previous revision in `assets/` until pruning removes it. Choose `staleAssetPruning: 'full-pipeline'` when the driver serves the directory in place (an already-loaded page still requests the old url) and `'every-cycle'` when it republishes the whole directory each cycle.
- Asset urls are emitted relative to the session's `styles.css`, which sits beside `assets/`, so the host's own CSS pipeline applies its publicPath and output hashing to them. A specifier that cannot be substituted warns and is emitted literally, and fails the build in strict mode.

### Engine

- `transformSourcesJson` is the only channel for transforms that ship inside an installed package: `configJson` names each prop's transform but cannot carry its body, and the extractor's other seed is `createTransform()` calls parsed out of project files. Without it, props using a package-shipped transform emit the raw value.
- In dev mode the manifest reports what reconciliation would have eliminated instead of eliminating it, as `report.eliminated_details` entries carrying `kind: "prospective_component"`. That turns a JSX-scanner blind spot into an authoring-time diagnostic rather than missing CSS in a production build.
- `build:extract-v2` checks rustc against `rust-toolchain.toml` before building the shipped binary; `build:v2:debug` skips the check on purpose because it builds a developer-profile binary.

## License

MIT
