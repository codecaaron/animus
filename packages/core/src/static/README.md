# Animus Static Extraction

A powerful build-time CSS extraction system for Animus components that generates optimized CSS while preserving the full runtime API during development.

## Overview

The static extraction system analyzes TypeScript/JavaScript codebases to:
- Extract styles from Animus component definitions at build time
- Generate optimized CSS with minimal selectors
- Resolve theme tokens to CSS variables
- Track component usage for dead code elimination
- Support incremental rebuilds in watch mode

## Architecture

### Core Components

1. **TypeScript Extractor** (`typescript-extractor.ts`)
   - Uses TypeScript compiler API for accurate extraction
   - Handles cross-file imports and component resolution
   - Preserves type information for better analysis

2. **Component Registry** (`component-registry.ts`)
   - Central authority for all components in a project
   - Tracks component relationships and dependencies
   - Manages component identity across files

3. **CSS Generator** (`generator.ts`)
   - Converts extracted styles to optimized CSS
   - Supports multiple output modes:
     - Component styles with unique class names
     - Atomic utilities for enabled groups/props
   - Handles theme token resolution (inline, CSS variables, or hybrid)

4. **Theme Resolver** (`theme-resolver.ts`)
   - Resolves theme tokens at build time
   - Generates CSS custom properties
   - Supports multiple resolution strategies

5. **Usage Collector** (`usageCollector.ts`)
   - Tracks actual prop usage in JSX
   - Enables dead code elimination
   - Optimizes atomic CSS generation

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

## Architecture Decisions

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed design decisions and rationale.
