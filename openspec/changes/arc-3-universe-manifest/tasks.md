## 1. Chain Walker: Extension Chain Recognition

- [ ] 1.1 Add `extends_from: Option<String>` field to ChainDescriptor
- [ ] 1.2 Modify chain walking to recognize extension pattern: when root identifier is NOT `animus` and first method is `.extend()`, record `extends_from: Some(root_identifier)` and walk remaining chain as normal
- [ ] 1.3 Remove `extend` from BAIL_METHODS — `.extend()` as a chain root pattern is extractable; `.extend(arg)` as a mid-chain call with an argument remains a bail
- [ ] 1.4 Handle `.asComponent()` terminal as extractable for extension chains (set terminal to AsComponent, record component identifier as tag)
- [ ] 1.5 Add unit tests: extension chain recognized and extractable, extension chain with extends_from set, asComponent terminal on extension chain is extractable, bare animus chain with .extend(arg) still bails, multiple chains (primary + extension) in same file

## 2. Import Resolver (New Module)

- [ ] 2.1 Create `import_resolver.rs` module with types: `ImportBinding { source_file, export_name }`, `FileExports { named: HashMap, default: Option, re_exports: Vec }`
- [ ] 2.2 Parse import statements from OXC AST: `ImportDeclaration` → extract specifiers (named, default, namespace) and source path
- [ ] 2.3 Parse export statements from OXC AST: `ExportNamedDeclaration` (with and without source), `ExportDefaultDeclaration`, re-exports
- [ ] 2.4 Build global binding map: for each file, map local binding names to their resolved (file, export_name) pairs
- [ ] 2.5 Implement transitive resolution: follow re-export chains through barrel files (e.g., index.ts re-exports from ./Box.tsx)
- [ ] 2.6 Handle unresolvable imports: external packages (next/link, react) return None
- [ ] 2.7 Relative path resolution: resolve `./Button` to the actual file path (try .ts, .tsx, .js, .jsx, /index.ts extensions)
- [ ] 2.8 Add unit tests: named import resolution, renamed import, re-export through barrel file, unresolvable external import, relative path resolution with extensions

## 3. Chain Merger (New Module)

- [ ] 3.1 Create `chain_merger.rs` module with function `merge_chains(parent_config, child_stages) -> MergedConfig`
- [ ] 3.2 Implement deep merge for serde_json::Value objects (equivalent to lodash merge): nested objects merge recursively, child values override parent on conflict, arrays and scalars are replaced not merged
- [ ] 3.3 Merge each config field: baseStyles, variants (by prop key), statesConfig, activeGroups, custom props
- [ ] 3.4 Implement topological sort of provenance graph for multi-level chains
- [ ] 3.5 Detect cycles in provenance graph and report error
- [ ] 3.6 Merged component gets own class name: `animus-{binding}-{hash(merged_chain)}`
- [ ] 3.7 Add unit tests: merge base styles (child overrides), merge variants additively, merge states additively, merge groups additively, override variant option, three-level chain, cycle detection

## 4. Project Analyzer (New Module + NAPI Entry Point)

- [ ] 4.1 Create `project_analyzer.rs` module with `analyze(files, theme, config, group_registry) -> UniverseManifest`
- [ ] 4.2 Phase 1: Walk all files with chain_walker, collect all chain descriptors per file
- [ ] 4.3 Phase 2: Walk all files with import_resolver, build global binding map
- [ ] 4.4 Phase 3: For each extension chain, resolve extends_from binding to parent component via import resolver
- [ ] 4.5 Phase 4: Build provenance graph, topologically sort, merge chains using chain_merger
- [ ] 4.6 Phase 5: Walk all files with jsx_scanner for components with active groups, collect utility usages globally
- [ ] 4.7 Phase 6: Generate all CSS — component CSS (topologically ordered within layers) + utility CSS (@layer system) + custom prop CSS (@layer custom)
- [ ] 4.8 Phase 7: Build manifest JSON with components, utilities, css, provenance, files mappings
- [ ] 4.9 Add NAPI entry point: `analyze_project(file_entries_json, theme_json, config_json, group_registry_json) -> String`
- [ ] 4.10 Add NAPI entry point: `transform_file(source, filename, manifest_json) -> TransformResult`

## 5. CSS Generator: Topological Ordering

- [ ] 5.1 Modify `generate_css` to accept a topological order for components within each layer
- [ ] 5.2 Parent component rules emitted BEFORE child component rules within same @layer block
- [ ] 5.3 Components with no extension relationship ordered by file path + binding name (stable, deterministic)
- [ ] 5.4 Add unit tests: parent before child in @layer base, deep chain ordering (A before B before C), unrelated components in stable order

## 6. Transform Emitter: asComponent Support

- [ ] 6.1 Update `ComponentReplacement` to distinguish between tag string and component reference for the element parameter
- [ ] 6.2 When terminal is asComponent on an extension chain, emit `createComponent(ComponentRef, className, config)` where ComponentRef is the identifier (not a string literal)
- [ ] 6.3 Preserve the original component import in the transformed source (e.g., NextLink import stays)
- [ ] 6.4 Add `extendConfig` to the runtime config JSON: serialized chain configuration for runtime .extend() support
- [ ] 6.5 Add unit tests: asComponent replacement preserves identifier, extendConfig appears in config JSON

## 7. Runtime Shim: Component Element + Extend

- [ ] 7.1 Update createComponent to accept component references as first argument (not just string tags)
- [ ] 7.2 Use `React.createElement(element, ...)` which handles both string tags and component references
- [ ] 7.3 Implement working `.extend()` method that imports and returns AnimusExtended from @animus-ui/core, seeded with extendConfig
- [ ] 7.4 When element is a component reference, skip `isPropValid` check — forward all non-filtered props
- [ ] 7.5 Add extendConfig to ComponentConfig type definition

## 8. Vite Plugin: Manifest-Based Architecture

- [ ] 8.1 Add `analyze_project` and `transform_file` imports from the NAPI binding
- [ ] 8.2 Restructure `buildStart`: evaluate theme, serialize config + group registry, glob source files, read all sources, call `analyze_project()`, store manifest + CSS
- [ ] 8.3 Restructure `transform` hook: call `transform_file(code, id, manifestJson)` instead of `extract()`
- [ ] 8.4 Change virtual CSS to single global module: `virtual:animus/styles.css` serves manifest CSS
- [ ] 8.5 Remove per-file cssStore — replaced by single manifest CSS string
- [ ] 8.6 Add file glob configuration to plugin options (include/exclude patterns with sensible defaults)
- [ ] 8.7 Add package import resolution: use Vite's `this.resolve()` at buildStart to resolve package-name imports to file paths

## 9. Integration Tests

- [ ] 9.1 Create multi-file test fixtures: parent component file + extension file with import
- [ ] 9.2 Create test fixture with .asComponent() extension (mirrors the real Anchor→Link pattern)
- [ ] 9.3 Add canary tests for analyze_project: manifest contains both parent and child, provenance correct, CSS has both components
- [ ] 9.4 Add canary tests for transform_file: source replacement correct, createComponent for asComponent uses identifier not string
- [ ] 9.5 Add canary test: extension CSS ordering — parent rules before child rules within each @layer
- [ ] 9.6 Add canary test: global utility deduplication — same utility from two files produces one class
- [ ] 9.7 Add MANIFEST SNAPSHOT test: known fixture set → exact manifest JSON comparison (chain of trust: fixtures → manifest → CSS)
- [ ] 9.8 Update existing canary tests to pass with new NAPI signatures (backward compatibility check)
