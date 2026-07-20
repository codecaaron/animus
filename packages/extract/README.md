# @animus-ui/extract

Rust/NAPI static CSS extraction pipeline for Animus. Analyzes TypeScript source files using OXC, resolves builder chains against serialized system config, and emits layered CSS.

This package is consumed by [`@animus-ui/vite-plugin`](../vite-plugin) and [`@animus-ui/next-plugin`](../next-plugin). You typically don't install it directly — the bundler plugins depend on it.

## Platforms

Pre-built binaries for:

- `darwin-arm64` (macOS Apple Silicon)
- `linux-x64-gnu` (Linux x64)
- `linux-arm64-gnu` (Linux ARM64)

## API

v2 is the only engine (v1 was retired — openspec: `retire-extract-v1`). The
root entry and the one-cycle `./engine-v2` alias resolve to the same module.

```tsx
import { ExtractEngine, loadSystemModule } from '@animus-ui/extract';

const engine = new ExtractEngine({
  configJson,
  groupRegistryJson,
  themeJson,
  variableMapJson,
  devMode: false,
});
const manifest = engine.analyze(fileEntriesJson);
const { code, hasComponents } = JSON.parse(engine.transformFile(path));
```

## License

MIT
