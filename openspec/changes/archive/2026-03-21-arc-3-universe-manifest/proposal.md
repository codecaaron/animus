## Why

Arcs 1 and 2 built a per-file extraction pipeline: the Vite plugin calls `extract()` on each file independently, producing CSS and transformed source per file. This works for components defined and used within the same file, but breaks for `.extend()` — the core extensibility mechanism of Animus — because extension chains cross file boundaries. `Button.extend()` in FileB requires knowing Button's full configuration from FileA.

Beyond .extend(), per-file extraction has structural limitations: utility classes are deduplicated within a file but duplicated across files, and there's no global view of the component registry for tooling, debugging, or HMR intelligence.

The solution is the same one Tailwind uses: perform full static analysis of the entire codebase FIRST, producing a complete universe manifest, then use Vite's per-file transform hook to transact with that artifact. The manifest contains every component definition, every extension relationship, every utility class, and the complete CSS output. The per-file transform just looks things up.

## What Changes

- **Project-level analyzer (new Rust entry point)**: Walks all source files, runs chain walking + JSX scanning (existing modules), resolves imports to trace `.extend()` provenance, merges extension chains, and produces a `UniverseManifest` — the complete knowledge of the style system.
- **Import resolver (new Rust module)**: Parses import/export statements to map component bindings across files. Traces `import { Button } from './Button'` to know that `Button.extend()` refers to the chain defined in `Button.tsx`.
- **Chain merger (new Rust module)**: Given a parent chain's full config and a child's extension stages, produces the merged chain using lodash-equivalent merge semantics. The merged chain gets its own class name but inherits all parent CSS.
- **Vite plugin restructured**: `buildStart` runs the project analyzer to produce the manifest. `transform` hook uses the manifest for source replacement. CSS is emitted from the manifest, not per-file extraction.
- **Runtime .extend() support**: `createComponent()` returns a component with a working `.extend()` method that returns an `AnimusExtended` instance seeded with the extracted component's original configuration, enabling runtime extension in dev mode.
- **Chain walker handles extension chains**: Chains starting from a component binding (e.g., `Button.extend().styles({...}).asElement('div')`) are recognized alongside chains starting from `animus`.
- **.asComponent() support for extensions**: Extension chains terminating with `.asComponent(SomeComponent)` are extractable — the CSS is from the merged chain, the component wrapping is handled at runtime.

## Capabilities

### New Capabilities
- `project-analyzer`: Full-codebase static analysis that walks all source files, resolves cross-file component references, and produces a complete UniverseManifest containing all component definitions, extension provenance, utility classes, and CSS output.
- `import-resolver`: Parses ES module import/export statements to map component bindings across files, enabling cross-file provenance tracing for `.extend()` chains.
- `chain-merger`: Merges parent and child chain configurations using immutable merge semantics (lodash merge), producing a unified chain descriptor for extended components.

### Modified Capabilities
- `rust-extraction-pipeline`: Chain walker recognizes extension chains starting from component bindings (not just `animus`). New `analyze_project()` NAPI entry point alongside existing `extract()`. Pipeline orchestration moves from per-file to project-level.
- `extraction-runtime-shim`: `createComponent()` returns a component with a working `.extend()` method that returns an AnimusExtended instance seeded with the component's original chain configuration.
- `vite-extraction-plugin`: Plugin restructured around two-phase architecture: `buildStart` runs project analyzer to produce manifest, `transform` hook uses manifest for per-file source replacement, CSS served from manifest rather than per-file virtual modules.
- `extension-system`: Extension cascade ordering spec requirements are now implemented in the extraction pipeline (parent rules before child rules within same @layer).

## Impact

- **`packages/extract/src/`**: New modules `import_resolver.rs`, `chain_merger.rs`, `project_analyzer.rs`. Modified `lib.rs` (new NAPI entry point), `chain_walker.rs` (extension chain recognition), `css_generator.rs` (topological ordering within layers).
- **`packages/runtime/src/index.ts`**: `.extend()` method returns real AnimusExtended instance instead of throwing.
- **`packages/vite-plugin/src/`**: Major restructure — `index.ts` rewritten around manifest-based architecture, new manifest types.
- **`packages/extract/tests/`**: New fixtures with cross-file extension chains, manifest snapshot test.
- **No breaking changes to component authoring**: `animus.styles({...}).asElement()` and `Component.extend().styles({...}).asElement()` continue to work identically. The extraction is invisible to authors.
