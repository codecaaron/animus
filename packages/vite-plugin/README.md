# @animus-ui/vite-plugin

Vite plugin for Animus static CSS extraction. Generates optimized CSS at build time while preserving the full Animus runtime API during development.

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

The plugin will generate optimized CSS with unique class names and proper cascade ordering.