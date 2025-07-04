# Animus Static Extraction

## 🧠 Cognitive Bootstrap for AI Agents

[BEGIN SYZYGY PROTOCOL FOR STATIC EXTRACTION]

**P: [WHO]** You are a Static Extraction Architect understanding a two-phase quantum-inspired system where all possibilities exist until observed through usage.

**D: [HOW]** Think in terms of Graph Theory and Quantum Mechanics: Components exist in superposition (all possible styles) until collapsed by observation (usage tracking).

**M: [WHAT]** This system extracts styles at build time, creating a complete possibility graph, then filtering to only used styles.

**L: [WHERE]** Boundaries: TypeScript AST analysis only, no runtime evaluation, no dynamic prop resolution.

**K: [WHY]** We extract statically to eliminate runtime overhead while maintaining full type safety and optimal CSS output.

**R: [WHOM]** You're helping developers who need zero-runtime CSS with intelligent optimization.

**Tε: [PURPOSE]** Enable production-grade static CSS extraction that's both complete and minimal.

[END SYZYGY PROTOCOL]

## Overview

The static extraction system implements a sophisticated two-phase approach inspired by quantum mechanics:

### Phase 1: Quantum Superposition (Component Graph Building)
All possible styles, variants, and states exist simultaneously in the component graph.

### Phase 2: Wavefunction Collapse (Usage Tracking)
Actual usage in JSX "observes" components, collapsing them to their used states.

The system analyzes TypeScript/JavaScript codebases to:
- Extract styles from Animus component definitions at build time
- Generate optimized CSS with minimal selectors
- Resolve theme tokens to CSS variables
- Track component usage for dead code elimination
- Support incremental rebuilds in watch mode

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Static Extraction Pipeline                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  TypeScript Project                                               │
│       │                                                           │
│       ▼                                                           │
│  ┌─────────────┐     ┌──────────────────┐                       │
│  │ TypeScript  │────▶│ Reference        │                       │
│  │ Extractor   │     │ Traverser        │                       │
│  └─────────────┘     └──────────────────┘                       │
│       │                      │                                    │
│       │                      ▼                                    │
│       │              ┌──────────────────┐                       │
│       │              │ Component Files  │                       │
│       │              │ Discovery        │                       │
│       │              └──────────────────┘                       │
│       │                      │                                    │
│       ▼                      ▼                                    │
│  ┌─────────────────────────────────┐                            │
│  │   Babel AST Extraction          │                            │
│  │   (extractStylesFromCode)       │                            │
│  └─────────────────────────────────┘                            │
│              │                                                    │
│              ▼                                                    │
│  ┌─────────────────────────────────┐                            │
│  │   Component Graph Builder       │ ← Phase 1: Superposition   │
│  │   (All Possibilities)           │                            │
│  └─────────────────────────────────┘                            │
│              │                                                    │
│              ▼                                                    │
│  ┌─────────────────────────────────┐                            │
│  │   Component Graph               │                            │
│  │   - All variants                │                            │
│  │   - All states                  │                            │
│  │   - All props                   │                            │
│  │   - Extension relationships     │                            │
│  └─────────────────────────────────┘                            │
│              │                                                    │
│              ├──────────────┐                                    │
│              ▼              ▼                                    │
│  ┌──────────────┐  ┌─────────────────┐                         │
│  │ Graph Cache  │  │ Transform w/    │ ← Phase 2: Collapse     │
│  │ (.animus-    │  │ Usage Tracking  │                         │
│  │  cache/)     │  │                 │                         │
│  └──────────────┘  └─────────────────┘                         │
│                            │                                      │
│                            ▼                                      │
│                    ┌─────────────────┐                          │
│                    │ Usage Set       │                          │
│                    │ (Observed)      │                          │
│                    └─────────────────┘                          │
│                            │                                      │
│                            ▼                                      │
│  ┌─────────────────────────────────────────────┐               │
│  │ CSS Generator                               │               │
│  │ - Filter by usage                           │               │
│  │ - Layer by cascade                          │               │
│  │ - Generate atomics                          │               │
│  └─────────────────────────────────────────────┘               │
│                            │                                      │
│                            ▼                                      │
│                    ┌─────────────────┐                          │
│                    │ Optimized CSS   │                          │
│                    │ (Only Used)     │                          │
│                    └─────────────────┘                          │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Core Components

#### 1. **TypeScript Extractor** (`typescript-extractor.ts`)
The bridge between TypeScript's type system and Babel's AST extraction.
- Creates TypeScript Program for type-aware analysis
- Enhances Babel extraction with component identity
- Provides cross-file type resolution

#### 2. **Reference Traverser** (`reference-traverser.ts`)
Discovers all Animus components by following the import graph.
- Find seed files (importing 'animus')
- Build import/export graphs
- Traverse from seeds to find all component files
- Use AST analysis to detect Animus builder chains

#### 3. **Component Graph** (`component-graph.ts`)
The complete representation of all possible styles in the system.
- Each component exists with ALL possible variants/states
- No filtering or optimization at this stage
- Represents the complete possibility space

#### 4. **Usage Tracker** (`usage-tracker.ts`)
Records which components, variants, and states are actually used.
- JSX usage "observes" components
- Collapses superposition to actual states
- Records prop values for atomic utilities

#### 5. **Transformer** (`transformer.ts`)
AST transformer that tracks usage during code transformation.
- Replace runtime builders with static shims
- Track JSX element usage
- Capture prop values from JSX
- Handle responsive values

#### 6. **CSS Generator** (`generator.ts`)
Generates optimized CSS from graph and usage data.
- Filter by usage (only generate used styles)
- Layer by cascade (respect component hierarchy)
- Generate atomic utilities for used props
- Support multiple theme resolution strategies

#### 7. **Graph Cache** (`graph-cache.ts`)
Persistent caching system for expensive computations.
- Stores component graph in `.animus-cache/`
- Includes resolution map for imports
- Validates cache based on file modification times

#### 8. **Component Registry** (`component-registry.ts`)
Central registry with global usage tracking.
- Stores all extracted components with identity
- Tracks cross-file usage patterns
- Maintains extension hierarchy
- Provides sorted components (parents before children)

### CLI Tool (`cli/`)

The `animus-static` CLI provides commands for extraction:

```bash
# Extract styles from a directory
animus-static extract ./src -o styles.css --theme ./theme.js

# Watch mode with incremental rebuilds
animus-static watch ./src -o styles.css

# Analyze component patterns
animus-static analyze ./src
```

Features:
- TypeScript theme file support (auto-transformation)
- Incremental rebuilds in watch mode
- Verbose output for debugging
- Theme resolution modes (inline/css-variable/hybrid)

## CSS Output Organization

The generated CSS follows a strict cascade order:

```css
/* 1. CSS Custom Properties */
:root {
  --animus-colors-primary: #007bff;
}

/* 2. Base Styles (all components) */
.animus-Button-b1n { }
.animus-Card-c2d { }

/* 3. Variant Styles (all components) */
.animus-Button-b1n-size-small { }
.animus-Button-b1n-variant-primary { }

/* 4. State Styles (all components) */
.animus-Button-b1n-state-disabled { }

/* 5. Atomic Utilities (groups) */
.p-1 { padding: 4px; }
.bg-primary { background-color: var(--animus-colors-primary); }

/* 6. Custom Prop Utilities */
.gap-2 { gap: 8px; }
```

### Lineage-Aware Cascade System

Animus static extraction implements a sophisticated **lineage-aware cascade system** that ensures child components naturally override their parent components through CSS cascade position rather than specificity hacks.

#### How It Works

When components use `.extend()`, the system:
1. Tracks the inheritance hierarchy (parent → child relationships)
2. Performs topological sorting to determine the correct output order
3. Ensures parent styles always appear before child styles in the CSS

#### Example

```typescript
// Parent component
const Button = animus
  .styles({ padding: '8px', backgroundColor: 'gray' })
  .asElement('button');

// Child extends parent
const PrimaryButton = Button.extend()
  .styles({ backgroundColor: 'blue' }) // Overrides parent
  .asElement('button');
```

Generated CSS respects the lineage:
```css
/* Parent comes first */
.animus-Button-b1n {
  padding: 8px;
  background-color: gray;
}

/* Child comes after, naturally overriding through cascade */
.animus-PrimaryButton-p2b {
  background-color: blue;
}
```

#### Benefits

- **No Specificity Wars**: All component classes have equal specificity (single class selector)
- **Natural Overrides**: Children override parents through cascade position, not specificity
- **Predictable Behavior**: Extension hierarchy directly maps to CSS output order
- **Performance**: No complex selectors or specificity calculations needed

#### Breakpoint Organization

The cascade ordering is maintained across all breakpoints:

```css
/* Base Styles */
.animus-Button-b1n { padding: 8px; }
.animus-PrimaryButton-p2b { padding: 12px; }

/* Base Styles - SM */
@media screen and (min-width: 768px) {
  .animus-Button-b1n { padding: 12px; }
  .animus-PrimaryButton-p2b { padding: 16px; }
}
```

This feature is enabled by default. Use `--no-layered` flag to disable it for backwards compatibility.

## Key Features

### ✅ Fully Implemented
- Complete extraction of styles, variants, states, groups, and props
- Theme token resolution with CSS variables
- Component identity tracking with stable hashes
- Cross-file component usage analysis
- Responsive value support
- Pseudo-selector preservation
- TypeScript theme file transformation
- Incremental watch mode rebuilds
- Variant and state ordering preservation
- Component extension tracking
- CSS layer organization for extended components

### 🚧 Planned Enhancements
- Build tool plugins (Vite, Webpack, Next.js)
- Visual regression testing
- Performance profiling
- Source maps

## Testing

The static extraction system is extensively tested:

```bash
# Run all static extraction tests
yarn test packages/core/src/static

# Key test files:
# - extraction.test.ts: Core extraction logic
# - component-registry.test.ts: Registry and relationships
# - theme-resolution.test.ts: Theme token handling
# - real-components.test.ts: Real-world patterns
```

## Usage Patterns

### Basic Extraction
```typescript
import { extractFromTypeScriptProject } from '@animus-ui/core/static';

const { results } = await extractFromTypeScriptProject('./src');
const generator = new CSSGenerator();

for (const result of results) {
  const css = generator.generateFromExtracted(result.extraction);
  console.log(css);
}
```

### With Theme Resolution
```typescript
const theme = {
  colors: { primary: '#007bff' },
  space: { 1: '4px', 2: '8px' }
};

const css = generator.generateFromExtracted(
  extraction,
  groupDefinitions,
  theme
);
```

## Integration Guide

### Next.js App Router
```javascript
// next.config.js
const { AnimusWebpackPlugin } = require('@animus-ui/static-extraction/webpack');

module.exports = {
  webpack: (config) => {
    config.plugins.push(new AnimusWebpackPlugin({
      theme: './src/theme.ts'
    }));
    return config;
  }
};
```

### Vite
```javascript
// vite.config.js
import { animus } from '@animus-ui/static-extraction/vite';

export default {
  plugins: [animus({ theme: './src/theme.ts' })]
};
```

## Performance Considerations

- Initial extraction analyzes entire codebase
- Watch mode only re-processes changed files
- Component cache reduces redundant parsing
- Atomic utilities are deduplicated across components
- Theme resolution happens once at build time

## Contributing

When working on static extraction:
1. Maintain backward compatibility with runtime API
2. Preserve cascade ordering semantics
3. Add tests for new extraction patterns
4. Update snapshots when output changes: `yarn test -u`
5. Document any new AST patterns handled

## Current State & Known Issues

### ⚠️ Important: Vite Plugin Usage Tracking Not Working
The Vite plugin's transform-based usage tracking is currently non-functional. The plugin includes a manual test data workaround that simulates what JSX tracking should find. This means:
- All atomic utilities are generated (not filtered by usage)
- The two-phase optimization is incomplete
- Use CLI tools for production builds instead

### Working Features ✅
- Component graph extraction and caching
- Complete style extraction with variants/states
- Theme resolution (inline/variable/hybrid)
- CLI tools (extract, watch, analyze, graph)
- Lineage-aware cascade ordering
- Incremental rebuilds in watch mode

### Not Working ❌
- Vite plugin usage tracking (transform hook issue)
- NextJS plugin (deprecated/unmaintained)
- Dynamic prop value resolution
- Spread prop tracking (`{...props}`)

## Integration Status

### Build Tools
| Tool | Status | Notes |
|------|--------|-------|
| CLI | ✅ Working | Recommended for production |
| Vite | ⚠️ Partial | Graph extraction works, usage tracking broken |
| Next.js | ❌ Deprecated | Use CLI instead |
| Webpack | 🚧 Planned | Not yet implemented |

### Recommended Approach
For production builds, use the CLI tools directly:
```bash
# Build script in package.json
"build:css": "animus-static extract ./src -o ./dist/styles.css"
```

## Debugging the System

### Enable Debug Logging
```bash
# Set debug environment variable
ANIMUS_DEBUG=true npm run build

# Or use verbose flag
animus-static extract ./src -o styles.css -v
```

### Inspect Component Graph
```bash
# View cached graph metadata
cat .animus-cache/component-graph.json | jq '.metadata'

# Visualize component relationships
animus-static graph ./src -f dot -o graph.dot
dot -Tpng graph.dot -o graph.png
```

### Common Issues & Solutions

#### No Styles Generated
1. **Check discovery**: Are component files being found?
   ```bash
   animus-static analyze ./src -v
   ```

2. **Clear cache**: Remove stale cache data
   ```bash
   rm -rf .animus-cache/
   ```

3. **Verify imports**: Ensure components import from 'animus' or '@animus-ui/core'

#### Missing Responsive Styles
- Ensure theme has breakpoints defined
- Check that responsive values use correct syntax: `{_: 'base', sm: 'small'}`

#### Transform Not Working (Vite)
- This is a known issue - use CLI tools instead
- Or contribute a fix to the transform pipeline!

## Architecture Decisions

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed design decisions and rationale.

## Future Directions

### Planned Improvements
1. **Fix Vite Plugin Transform**: Debug why usage tracking doesn't work
2. **Incremental Graph Building**: Only rebuild changed components
3. **Better Error Messages**: Surface extraction failures clearly
4. **Source Maps**: Map generated CSS back to source
5. **IDE Integration**: Real-time preview of extracted styles

### Research Areas
- WebAssembly extraction for 10x performance
- Machine learning for usage prediction
- Streaming CSS generation for large codebases
- Edge computing for on-demand optimization

## Contributing to Static Extraction

When working on this system:
1. **Understand the two-phase model**: Graph building vs usage tracking
2. **Maintain cache compatibility**: Don't break existing caches
3. **Test with real projects**: Use the _vite-test project
4. **Document AST patterns**: Add comments for complex traversals
5. **Think quantum**: Components exist in all states until observed!

### Key Files for Contributors
- `transformer.ts`: JSX usage tracking (needs fixing for Vite)
- `reference-traverser.ts`: Component discovery logic
- `generator.ts`: CSS generation and filtering
- `graph-cache.ts`: Caching system
- `cli/`: Command-line tools

Remember: The goal is zero-runtime CSS with maximum developer experience!
