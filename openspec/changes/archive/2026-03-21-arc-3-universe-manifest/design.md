## Context

Arcs 1-2 built a per-file extraction pipeline: `extract(source, filename, theme, config, groupRegistry) -> ExtractionResult`. Each file is processed independently. This works because styles, variants, states, and system props are all defined and used within the same file.

`.extend()` breaks this model. `Button.extend()` in FileB references Button from FileA. The pipeline needs cross-file knowledge to resolve the extension — it needs Button's full chain config (styles, variants, states, groups) to merge with the extension's additions.

The codebase has one real `.extend()` usage: `Link.extend().states({...}).asComponent(NextLink)` in the doc site, extending `Anchor` from the UI package. Extension depth in practice is 1 level, but the spec supports unlimited depth. The import graph is strictly acyclic (core → components → docs).

## Goals / Non-Goals

**Goals:**
- Full-codebase static analysis producing a complete UniverseManifest
- Cross-file `.extend()` resolution via import tracing
- Merged chain CSS generation with correct cascade ordering (parent before child within each @layer)
- Vite plugin restructured around manifest-based two-phase architecture
- Runtime `.extend()` that bridges extracted components back to AnimusExtended
- Global utility class deduplication across all files

**Non-Goals:**
- HMR incremental manifest updates — full rebuild on change for now (the manifest builds in <100ms for typical codebases)
- Inline scale support for `.props()` — deferred from Arc 2, still deferred
- Dead variant elimination — future arc
- CSS minification/optimization via Lightning CSS — future arc
- Dev-mode extraction — extraction remains production-only; dev mode uses Emotion runtime

## Decisions

### 1. Two-phase architecture: analyze then transform

The pipeline splits into two NAPI entry points:

```
Phase 1: analyze_project(file_entries, theme_json, config_json, group_registry_json) -> ManifestJson
  - file_entries: Vec<{path, source}> — all source files to analyze
  - Runs chain walker + JSX scanner on each file (existing code)
  - Resolves imports across files to build provenance graph
  - Merges extension chains
  - Generates all CSS (component layers + utility layers)
  - Returns JSON manifest

Phase 2: transform_file(source, filename, manifest_json) -> TransformedFile
  - Looks up this file's components in the manifest
  - Applies source replacements (createComponent calls)
  - Returns transformed source code (no CSS — CSS comes from manifest)
```

**Alternative considered:** Keeping `extract()` and adding a pre-pass. Rejected because the per-file `extract()` function would need the manifest as context anyway — cleaner to separate the concerns into two distinct operations.

### 2. UniverseManifest structure

```json
{
  "components": {
    "ComponentId": {
      "file": "relative/path.tsx",
      "binding": "ButtonContainer",
      "className": "animus-ButtonContainer-abc12345",
      "extendsFrom": null | "ParentComponentId",
      "chain": {
        "styles": {...},
        "variants": [...],
        "states": {...},
        "groups": ["space", "layout"],
        "props": {...}
      },
      "css": {
        "base": "...",
        "variants": "...",
        "states": "..."
      },
      "systemPropClassMap": { "p": { "8": "animus-u-xxx" } },
      "systemPropNames": ["p", "m", "mt", ...],
      "replacement": "createComponent('button', 'animus-ButtonContainer-abc12345', {...})"
    }
  },
  "utilities": {
    "animus-u-50e5d508": "padding: 0.5rem;"
  },
  "css": "/* complete @layer-structured stylesheet */",
  "provenance": {
    "Link": ["Anchor"]
  },
  "files": {
    "relative/path.tsx": ["ComponentId1", "ComponentId2"]
  }
}
```

Component IDs are `file::binding` to handle same-name components in different files.

### 3. Import resolution strategy

The import resolver parses ES module statements to build a binding map:

```
File: components/ActionButton.tsx
  import { ButtonContainer } from '../ui/Button';
  →  binding "ButtonContainer" resolves to file "ui/Button.tsx"

File: ui/Button.tsx
  export const ButtonContainer = animus.styles({...}).asElement('button');
  →  binding "ButtonContainer" is a chain definition in this file
```

Resolution steps:
1. Parse all import statements in all files (OXC already parses these)
2. Resolve import paths relative to each file
3. Build a global map: `(file, binding) → (source_file, source_binding)`
4. For extension chains: `Button.extend()` → look up `Button` in the binding map → find the chain in the source file

**Named re-exports through barrel files** (e.g., `export { Box } from './elements/Box'`) are traced transitively.

**Alternative considered:** Using the TypeScript compiler API for import resolution. Rejected — we already have OXC parsing the files, and import path resolution is simple string manipulation for relative paths. Package-name imports (like `@animus-ui/components`) resolve through the Vite plugin's module resolution, which we can leverage at `buildStart` time.

### 4. Extension chain recognition in chain walker

Currently the chain walker only finds chains starting from the `animus` identifier. Extension chains start from a component binding:

```typescript
// Current (Arc 1-2): animus.styles({...}).asElement('div')
//   → walker finds `animus` identifier as root

// Extension (Arc 3): Button.extend().styles({...}).asElement('button')
//   → walker finds `Button` identifier as root
//   → `Button` is not `animus` — it's a component binding
//   → the `.extend()` call is the first method in the chain
```

The chain walker gains a new variant: when the root identifier is NOT `animus` and the first method call is `.extend()`, this is an extension chain. The chain descriptor records `extends_from: Some(binding_name)` and the import resolver maps that binding to its source.

**The `.extend()` call itself takes no arguments** (the parent config is carried via `this`). So there's no argument span to parse — the walker just records the fact of extension.

### 5. Chain merger: immutable merge semantics

When resolving an extension chain, the merger combines parent and child configs:

```
merged.baseStyles = merge({}, parent.baseStyles, child.baseStyles)
merged.variants = merge({}, parent.variants, child.variants)
merged.statesConfig = merge({}, parent.statesConfig, child.statesConfig)
merged.activeGroups = merge({}, parent.activeGroups, child.activeGroups)
merged.custom = merge({}, parent.custom, child.custom)
```

This matches the runtime behavior in `AnimusExtended.ts` where each method does `merge({}, this.field, newValue)`.

For deep extension chains (A → B → C), merging is applied iteratively: merge A+B to get AB, then merge AB+C to get ABC. Topological sort of the provenance graph ensures parents are processed before children.

### 6. CSS emission with topological ordering

Within each @layer, component rules are emitted in topological order of the extension graph: parent rules first, child rules after. This guarantees extension overrides via CSS source order (same specificity, later wins), matching the spec requirement.

```css
@layer base {
  /* Parent first */
  .animus-Anchor-abc { display: inline-block; ... }
  /* Child after — overrides parent via source order */
  .animus-Link-def { ... }
}
```

For components with no extension relationship, ordering within a layer is stable (deterministic by file path + binding name).

### 7. .asComponent() support for extension chains

The real-world extension pattern does `.asComponent(NextLink)` — wrapping with a React component. The CSS is fully extractable (parent's CSS + state override). Only the component wrapping needs runtime support.

`createComponent` gains a mode where the first argument is a component reference string (resolved at runtime via import) instead of an HTML tag:

```javascript
// Current: createComponent('button', className, config)
// Extension: createComponent('__import_NextLink', className, config)
```

The transformed source includes the NextLink import and passes it to createComponent. The runtime shim handles both string tags and component references.

### 8. Runtime .extend() implementation

`createComponent()` currently throws on `.extend()`. In Arc 3, it returns a real AnimusExtended instance:

```javascript
Component.extend = () => new AnimusExtended(
  propRegistry, groupRegistry, parser,
  baseStyles, variants, statesConfig, activeGroups, custom
);
```

This requires the runtime shim to import AnimusExtended from `@animus-ui/core`. The extracted component's config is serialized into the `createComponent` call and deserialized back into AnimusExtended's constructor format.

**Alternative considered:** Making `.extend()` on extracted components return a lightweight proxy instead of a full AnimusExtended. Rejected — the proxy would need to implement the entire AnimusExtended API anyway, and importing the real class ensures behavioral parity.

### 9. Vite plugin restructure

```
buildStart:
  1. Evaluate theme (existing ssrLoadModule)
  2. Serialize config + group registry (existing)
  3. Walk project files (glob from include/exclude options)
  4. Read all file sources
  5. Call analyze_project() → ManifestJson
  6. Store manifest in memory
  7. Store manifest CSS for virtual module serving

transform(code, id):
  1. Check if id is in manifest's file list
  2. If not, return null (no transformation)
  3. Call transform_file(code, id, manifest) → TransformedFile
  4. Return transformed code + CSS import for the global virtual module

load(id):
  1. If id is the global CSS virtual module, serve manifest CSS
  2. Single CSS file, single @layer declaration, no duplication
```

**Single CSS output:** Instead of per-file virtual CSS modules, one global virtual module (`virtual:animus/styles.css`) contains all extracted CSS. This eliminates duplicate @layer declarations and duplicate utility rules.

## Risks / Trade-offs

**[Risk] Full-codebase analysis adds build startup time** → Mitigation: OXC parsing is ~1ms per file. For a 500-file project, analysis takes <1s. The manifest can be cached (hash all input files, skip analysis if hash unchanged).

**[Risk] Import resolution for package-name imports** → Mitigation: For `@animus-ui/components`, the Vite plugin can resolve package paths at buildStart using Vite's `this.resolve()`. Only need to trace imports that lead to animus chain definitions, not all imports.

**[Risk] Extension chains with dynamic parent references** → Mitigation: If `.extend()` is called on a binding that can't be statically traced (e.g., `getComponent().extend()`), the chain bails. Only statically-resolvable bindings are supported.

**[Trade-off] Single CSS file vs per-file CSS modules** → Larger initial CSS file, but no duplication. For production builds, the browser loads one CSS file vs many. Tree-shaking of unused components is deferred (dead variant elimination, future arc).

**[Trade-off] Full rebuild on any file change** → No incremental manifest updates. For production builds this is fine (build runs once). For future HMR support, incremental analysis can be added without changing the manifest structure.
