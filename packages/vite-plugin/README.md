# @animus-ui/vite-plugin

Vite plugin for Animus static CSS extraction. Generates optimized CSS at build time while preserving the full Animus runtime API during development.

## ⚠️ Important: Known Issues

**The JSX usage tracking feature is currently non-functional.** This means:
- ❌ Usage-based optimization doesn't work (all styles are generated)
- ❌ Atomic utilities are not filtered by actual usage
- ❌ The two-phase extraction is incomplete

**Workaround**: The plugin includes manual test data to demonstrate intended functionality. For production builds, **use the CLI tools instead**:

```bash
# Recommended approach
npx animus-static extract ./src -o ./dist/styles.css
```

## Installation

```bash
npm install @animus-ui/vite-plugin
```

## Usage

```js
// vite.config.js
import { animusVitePlugin } from '@animus-ui/vite-plugin';

export default {
  plugins: [
    animusVitePlugin({
      theme: './src/theme.ts',
      output: 'animus.css',
      themeMode: 'hybrid',
      atomic: true
    })
  ]
};
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `theme` | `string` | - | Path to theme file |
| `output` | `string` | `'animus.css'` | Output CSS filename |
| `themeMode` | `'inline' \| 'css-variable' \| 'hybrid'` | `'hybrid'` | Theme token resolution mode |
| `atomic` | `boolean` | `true` | Enable atomic CSS generation |
| `transform` | `boolean \| TransformOptions` | `true` | Enable code transformation |
| `transformExclude` | `RegExp` | `/node_modules/` | Files to exclude from transformation |

### Transform Options

```typescript
interface TransformOptions {
  enabled?: boolean;
  mode?: 'production' | 'development' | 'both';
  preserveDevExperience?: boolean;
  injectMetadata?: 'inline' | 'external' | 'both';
  shimImportPath?: string;
}
```

## Features

- **Build-time CSS extraction** - Generates static CSS from Animus components
- **Theme support** - Loads and processes TypeScript or JavaScript theme files
- **Code transformation** - Optional AST transformation for production optimization
- **Development mode** - Preserves runtime behavior for hot reloading
- **Atomic CSS** - Generates utility classes for enabled groups and props

## Example

```typescript
// src/components/Button.tsx
import { animus } from '@animus-ui/core';

export const Button = animus
  .styles({
    padding: '8px 16px',
    borderRadius: '4px',
    backgroundColor: 'primary'
  })
  .variant({
    prop: 'size',
    variants: {
      small: { padding: '4px 8px' },
      large: { padding: '12px 24px' }
    }
  })
  .asElement('button');
```

The plugin will generate CSS with unique class names and proper cascade ordering.

## How It Works (Theory vs Reality)

### Intended Two-Phase Architecture

1. **Phase 1: Component Graph Building** ✅ Working
   - Discovers all Animus components via TypeScript analysis
   - Builds complete graph of all possible styles/variants/states
   - Caches results in `.animus-cache/`

2. **Phase 2: Usage Tracking** ❌ Not Working
   - Should track actual component usage in JSX during transformation
   - Should record which variants/states/props are used
   - Should filter CSS to only include used styles

### Current Reality

Due to the transform hook not capturing usage properly:
- Phase 1 works: Complete component graph is built
- Phase 2 fails: No usage data is collected
- Result: All possible styles are generated (not optimized)

### What Actually Works

✅ **Component Discovery & Extraction**
- Finds all Animus components in your project
- Extracts styles, variants, states correctly
- Handles component extension (`.extend()`)

✅ **Theme Loading**
- TypeScript theme files are compiled with esbuild
- Theme tokens are resolved properly
- CSS variables are generated

✅ **Basic CSS Generation**
- Generates valid CSS for all components
- Maintains proper cascade ordering
- Creates atomic utilities

❌ **Usage-Based Optimization**
- Transform hook doesn't track JSX usage
- All atomic utilities generated (not filtered)
- No dead code elimination

## Debugging

To see what's happening under the hood:

```js
// vite.config.js
export default {
  plugins: [
    animusVitePlugin({
      theme: './src/theme.ts',
      output: 'animus.css'
    })
  ],
  build: {
    // Enable verbose logging
    logLevel: 'info'
  }
};
```

Check the generated files:
- `.animus-cache/component-graph.json` - Complete component graph
- `dist/animus.css` - Generated CSS (currently includes everything)

## Contributing

The main issue is in the transform hook implementation. The code exists but doesn't execute properly during Vite's build process. Key files:

- `src/plugin.ts` - Main plugin implementation (see transform hook)
- Lines 319-388 contain the manual test data workaround

Help fixing the transform pipeline would be greatly appreciated!