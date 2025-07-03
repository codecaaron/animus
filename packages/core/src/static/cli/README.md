# Animus Static Extraction CLI

A command-line interface for extracting, analyzing, and optimizing Animus component styles at build time.

## Installation

```bash
npm install -D @animus-ui/core
# or
yarn add -D @animus-ui/core
```

The CLI is available as `animus-static` after installation.

## Commands

### Extract

Extract styles from Animus components and generate optimized CSS.

```bash
# Extract from a single file
animus-static extract ./src/Button.tsx -o ./dist/button.css

# Extract from entire directory
animus-static extract ./src -o ./dist/styles.css

# Extract with theme (supports .ts/.tsx files)
animus-static extract ./src -t ./theme.ts -o ./dist/styles.css

# Extract with specific theme mode
animus-static extract ./src --theme-mode css-variable -o ./dist/styles.css
```

Options:
- `-o, --output <path>`: Output CSS file path (stdout if not specified)
- `-t, --theme <path>`: Path to theme file (supports .js/.ts/.tsx)
- `--theme-mode <mode>`: Theme resolution mode (inline, css-variable, hybrid)
- `--no-atomic`: Disable atomic CSS generation
- `-v, --verbose`: Verbose output

**Theme File Support**: TypeScript theme files are automatically transformed to JavaScript for loading.

### Analyze

Analyze Animus component usage patterns and generate statistics.

```bash
# Analyze a directory
animus-static analyze ./src

# Verbose analysis with detailed information
animus-static analyze ./src -v

# Output as JSON
animus-static analyze ./src --json > analysis.json
```

Options:
- `-v, --verbose`: Show detailed analysis
- `--json`: Output as JSON

### Watch

Watch for changes and regenerate CSS automatically with incremental rebuilds.

```bash
# Watch and output to file
animus-static watch ./src -o ./dist/styles.css

# Watch with theme
animus-static watch ./src -t ./theme.ts -o ./dist/styles.css

# Watch with verbose output to see incremental updates
animus-static watch ./src -o ./dist/styles.css -v
```

Options:
- Same as `extract` command
- **Incremental rebuilds**: Only re-processes changed files
- Tracks component dependencies for smart updates
- Full rebuild triggered on file deletions
- Debounced for rapid successive changes

## Theme Resolution

The CLI supports three theme resolution modes:

1. **inline**: Theme values are inlined directly into CSS
2. **css-variable**: All theme values become CSS variables
3. **hybrid** (default): Colors and shadows use CSS variables, spacing is inlined

## Examples

### Basic Component Extraction

```tsx
// Button.tsx
import { animus } from '@animus-ui/core';

export const Button = animus
  .styles({
    padding: '8px 16px',
    borderRadius: '4px',
    backgroundColor: 'colors.primary'
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

```bash
animus-static extract ./Button.tsx
```

Output:
```css
.animus-Button-b7n {
  padding: 8px 16px;
  border-radius: 4px;
  background-color: var(--animus-colors-primary);
}

.animus-Button-b7n-size-small {
  padding: 4px 8px;
}

.animus-Button-b7n-size-large {
  padding: 12px 24px;
}
```

### With Theme

```ts
// theme.ts
export const theme = {
  colors: {
    primary: '#007bff',
    secondary: '#6c757d'
  },
  space: {
    sm: '0.5rem',
    md: '1rem',
    lg: '2rem'
  }
};
```

```bash
animus-static extract ./src -t ./theme.ts -o ./dist/styles.css
```

## Integration with Build Tools

### Next.js

```js
// next.config.js
const { execSync } = require('child_process');

module.exports = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Extract styles during build
      execSync('animus-static extract ./src -o ./public/styles.css');
    }
    return config;
  }
};
```

### Vite

```js
// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    {
      name: 'animus-static',
      buildStart() {
        // Extract styles before build
        require('child_process').execSync(
          'animus-static extract ./src -o ./dist/styles.css'
        );
      }
    }
  ]
});
```

## Performance

The static extraction system is optimized for large codebases:

- Parallel processing of files
- Intelligent caching
- Only regenerates changed components in watch mode
- Typical extraction time: <100ms per component

## Limitations

- Spread props (`{...props}`) are not tracked
- Dynamic prop values are not evaluated
- Sparse arrays in responsive values may not work as expected

## Debugging

Use the `-v, --verbose` flag to see detailed information about:
- Which components were found
- How many styles were extracted
- Theme token usage
- Generated CSS size