# @animus-ui/extract

Rust/NAPI static CSS extraction pipeline for Animus. Analyzes TypeScript source files using OXC, resolves builder chains against serialized system config, and emits layered CSS.

This package is the shared home of extraction: the `./session` subpath exports the one `ExtractionSession` that every driver drives, and `./pipeline` exports the shared config/option core. It is consumed by [`@animus-ui/vite-plugin`](../vite-plugin), [`@animus-ui/next-plugin`](../next-plugin), the [`@animus-ui/unplugin`](../unplugin) transform host, and the [`animus` CLI](../cli). You typically don't install it directly — the drivers depend on it. For the consumer-facing contract of the standalone drivers (module ids, artifact set, exit codes), see the [standalone extraction contract](https://github.com/codecaaron/animus/blob/main/docs/standalone-extraction.md).

## Platforms

Pre-built binaries for:

- `darwin-arm64` (macOS Apple Silicon)
- `linux-x64-gnu` (Linux x64)
- `linux-arm64-gnu` (Linux ARM64)

## API

v2 is the only engine, since the v1 engine was removed. The package root
entry is the engine.

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
- A prepared corpus is rejected when an admitted original's parse aborted: `rejection` returns a message naming the file, and the attempt must neither analyze nor publish, because analyzing it publishes a generation without that file. Each host routes the rejection through its own failure channel, keeps its last successful generation, and holds the latest observed source of every file, valid edits included, until an attempt without an aborted parse publishes them together. Other analysis failures keep their rollback. Parse diagnostics the parser recovered from only warn.
- Keyframes collections are keyed by export name, and a `name.property` reference resolves against whatever local name binds that collection. The binding may arrive either through a cross-file import or through an export in the same file.

### Options

- The `exclude` dialect — globs versus substrings, and the structural exclusions that always apply and cannot be re-admitted — is defined in the [standalone extraction contract](https://github.com/codecaaron/animus/blob/main/docs/standalone-extraction.md#changed-plugin-behavior-release-notes-callout), which every driver shares.

### Assets

- Asset copies are content-addressed and never overwritten, so a revised asset leaves its previous revision in `assets/` until pruning removes it. Choose `staleAssetPruning: 'full-pipeline'` when the driver serves the directory in place (an already-loaded page still requests the old url) and `'every-cycle'` when it republishes the whole directory each cycle.
- Asset urls are emitted relative to the session's `styles.css`, which sits beside `assets/`, so the host's own CSS pipeline applies its publicPath and output hashing to them. A specifier that cannot be substituted warns and is emitted literally, and fails the build in strict mode.

### Engine

- `transformSourcesJson` is the only channel by which configured transforms reach the evaluator: `configJson` binds each prop to a definition (`transformId`) but cannot carry its body, and `createTransform()` declarations parsed out of project files are never registered as configured definitions. Without it, props bound to a configured transform emit the raw value. A `.props()` callback is evaluated from the analyzed source instead, for known values only, when its definition passes the same admission; otherwise it runs only at runtime. A configured source that reads `btoa` or `atob` additionally needs `transformProvenanceJson`, the loader's per-definition evidence (`loadSystemModule().transformProvenance`) that its own callable reads the host function; without it the source is rejected. The same evidence rejects any configured source whose callable is shown reading a binding declared outside itself (a module-level `Math`, an import, an enclosing function's variable). Where the loader cannot locate a callable that reads neither name, the source keeps its text admission: `{ hostGlobals: [] }` then records compatibility, not that the callable reads no outer binding.
- Configured definitions are evaluated like `.props()` callbacks: each known value in its own fresh realm under a fixed budget of interpreter steps, with host-environment reads declined. The budget interrupts JavaScript execution; it is not a cap on memory or on time spent inside one built-in (native) call. Props bound to one key their static classes by the value's type (the manifest's `typed_system_props`, delivered as the system-props module's `typedSystemProps`). Upgrade `@animus-ui/system` together with `@animus-ui/extract` and the consuming plugin or CLI: an older system runtime ignores that list and can apply a number's class to a string or miss a string's class. A JSX or `staticCss.systemProps` value that cannot be evaluated, that misses a populated scale, or whose string result post-processing would rewrite gets no static class and computes at runtime; in a style block, variant, state or global style it applies raw with `animus.transform.static-evaluation-unavailable`.
- In dev mode the manifest reports what reconciliation would have eliminated instead of eliminating it, as `report.eliminated_details` entries carrying `kind: "prospective_component"`. That turns a JSX-scanner blind spot into an authoring-time diagnostic rather than missing CSS in a production build.
- `build:extract-v2` checks rustc against `rust-toolchain.toml` before building the shipped binary; `build:v2:debug` skips the check on purpose because it builds a developer-profile binary.

## Prop-order lint rule

`@animus-ui/extract/oxlint` is an [Oxlint](https://oxc.rs/docs/guide/usage/linter/js-plugins.html) JS plugin with one rule, `animus/prop-order`. It orders the props an Animus component tag is written with by stage, then within the stage by registration:

1. variant props (variants and compounds), in the order the chain declares them;
2. states, in declaration order;
3. system props, in the system's registration order (not the order of the groups that admit them);
4. custom props, in declaration order, inherited ones first.

This is a readability convention. The stylesheet does not follow JSX attribute order, so the rule changes no CSS.

```json
{
  "jsPlugins": [{ "name": "animus", "specifier": "@animus-ui/extract/oxlint" }],
  "rules": { "animus/prop-order": "warn" }
}
```

The plugin must resolve from the config file's directory. Under an install that does not hoist `@animus-ui/extract`, add it as a direct dev dependency.

The rule reads `.animus/prop-order.json` at the project root. A host writes it after every analysis only when asked to, with `propOrderFile: true` in its options (the Vite, Next and unplugin hosts, or `animus.config` for `animus build`); off, no file is written and the analysis builds none of its data. `animus prop-order`, from `@animus-ui/cli`, writes only this file, from one analysis and without a dev server, whatever the option says. Keep `.animus/` out of version control. The file records each component's accepted props with their stage and rank, which component each written tag resolves to (imports, aliases such as `Box as B`, namespace members such as `ui.Box`, re-exports, family members), and the content hash of every analysed file, of the system module's inputs, and of the configuration resolution reads (`package.json`, the tsconfig chain, the build's config files). By default the rule uses the nearest such file above the linted file; the option `{ "orderFile": "path/to/.animus/prop-order.json" }` names one, relative to the working directory. Its paths are relative to the directory that holds `.animus`, so the rule reads a file only at `<root>/.animus/prop-order.json` and reports any other location as unusable.

- **Missing or stale file.** If the file is missing or unreadable, or a recorded file no longer matches its hash, the rule reports that (again only when it changes) and orders nothing until the file is usable. A long-lived process, such as an editor's, rechecks the disk at most once a second. A running dev server with `propOrderFile: true` regenerates it on save. Otherwise rerun `animus prop-order`, including after `oxlint --fix`, since fixing a file changes it. Within one process the rule's own fixes, any of them, do not make the file stale, since moving literal props changes nothing the analysis records, so one `--fix` run orders every fixable tag, including when a directive suppresses some. Any other change to a file, such as another rule's fix in the same run, does read as changed, and the tags linted after it wait for the next run.
- **Unresolved tags.** A tag the analysis did not resolve to exactly one component is skipped. So is a name the file also binds inside a function or block.
- **Attributes that stay put.** A spread, a prop the component does not accept, and a prop its target receives as written never move: a `data-*` or `aria-*` prop, which Animus always forwards, or a variant or state an `.asComponent()` target is forwarded, since the target can see the order they arrive in. Each run of the other accepted props between them is ordered on its own.
- **When the rule fixes.** It fixes a tag only when moving props cannot change what it evaluates: every value in a run it reorders a literal (a sign is allowed only on a number), no comment inside the tag, no repeated prop, and no `as` or `asChild`. A non-literal value that stays put, such as `key={item.id}` or a value in a run already in order, does not block it. Any other out-of-order tag gets a diagnostic without a fix.

## License

MIT
