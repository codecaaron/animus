# @animus-ui/extract

Rust/NAPI static CSS extraction pipeline for Animus. Analyzes TypeScript source files using OXC, resolves builder chains against serialized system config, and emits layered CSS.

This package is consumed by [`@animus-ui/vite-plugin`](../vite-plugin) and [`@animus-ui/next-plugin`](../next-plugin). You typically don't install it directly — the bundler plugins depend on it.

## Platforms

Pre-built binaries for:
- `darwin-arm64` (macOS Apple Silicon)
- `linux-x64-gnu` (Linux x64)
- `linux-arm64-gnu` (Linux ARM64)

## API

```tsx
import { analyzeProject } from '@animus-ui/extract';

const manifest = analyzeProject(
  fileEntriesJson,
  scalesJson,
  variableMapJson,
  contextualVarsJson,
  propConfig,
  groupRegistry,
  packageResolutionJson,
  devMode,
  prefix
);
```

## License

MIT
