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

## License

MIT
