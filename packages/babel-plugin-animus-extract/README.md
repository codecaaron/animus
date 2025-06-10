# @animus-ui/babel-plugin-animus-extract

Babel plugin for zero-runtime CSS extraction from Animus components. This plugin transforms Animus component definitions to extract static styles at build time while maintaining runtime capabilities for dynamic use cases.

## Features

- **Zero-Runtime CSS**: Extracts static styles at build time
- **Atomic CSS Generation**: Converts props to atomic utility classes
- **Responsive Support**: Handles responsive prop syntax
- **Type Safety**: Maintains full TypeScript support
- **Progressive Enhancement**: Allows incremental adoption
- **Runtime Fallback**: Supports dynamic styling when needed

## Installation

```bash
npm install --save-dev @animus-ui/babel-plugin-animus-extract
```

## Usage

Add the plugin to your Babel configuration:

```js
// babel.config.js
module.exports = {
  plugins: [
    ['@animus-ui/babel-plugin-animus-extract', {
      // Options
      cssOutputPath: './dist/styles',
      atomic: true,
      extractComponents: true,
      runtimeFallback: true,
      generateTypes: true,
      development: process.env.NODE_ENV === 'development'
    }]
  ]
};
```

## Options

### `cssOutputPath`
- Type: `string`
- Default: `'./dist/styles'`
- Directory where CSS files will be generated

### `atomic`
- Type: `boolean`
- Default: `true`
- Generate atomic CSS classes for props

### `extractComponents`
- Type: `boolean`
- Default: `true`
- Extract component-level styles

### `runtimeFallback`
- Type: `boolean`
- Default: `true`
- Keep runtime for dynamic props

### `generateTypes`
- Type: `boolean`
- Default: `true`
- Generate TypeScript definitions

### `development`
- Type: `boolean`
- Default: `process.env.NODE_ENV === 'development'`
- Skip transformation in development for hot reloading

## How It Works

The plugin transforms Animus component definitions:

```js
// Input
const Box = animus
  .styles({ padding: 16, backgroundColor: 'blue' })
  .props({ p: { scale: 'spacing' } })
  .asElement('div');

// Usage
<Box p={4} />

// Output CSS
.animus-a1b2c3 {
  padding: 16px;
  background-color: blue;
}
.p-4 {
  padding: 1rem;
}

// Output JS
const Box = __animus_runtime('div', 'animus-a1b2c3', {...});
<Box className="animus-a1b2c3 p-4" />
```

## Supported Transformations

### Static Style Extraction
Extracts styles defined in `.styles()` method to static CSS:

```js
animus.styles({ 
  padding: 16,
  backgroundColor: 'blue' 
})
// → .animus-xyz { padding: 16px; background-color: blue; }
```

### State-Based Styles
Extracts state variations:

```js
animus.states({
  hover: { backgroundColor: 'lightblue' },
  active: { transform: 'scale(0.98)' }
})
// → .animus-xyz--hover { background-color: lightblue; }
// → .animus-xyz--active { transform: scale(0.98); }
```

### Atomic Prop Classes
Converts static prop values to atomic classes:

```js
<Box p={4} m={{ _: 2, md: 4 }} />
// → <Box className="p-4 m-2 md:m-4" />
```

## Limitations

- Dynamic values remain runtime-processed
- Complex expressions cannot be statically analyzed
- Theme values must be known at build time

## Development

The plugin operates in three main phases:

1. **Detection**: Identifies Animus component definitions
2. **Extraction**: Extracts static styles and generates CSS
3. **Transformation**: Replaces original code with optimized runtime

## License

MIT