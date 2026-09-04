# Animus

Type-driven CSS-in-JS with static extraction. Zero runtime.

## What It Is

A design system builder where the TypeScript types ARE the product. Define components with a builder chain that enforces cascade ordering — the types guarantee that every legal component produces valid, extractable CSS at build time.

No Emotion. No styled-components. No runtime style injection. The builder chain compiles to static CSS via `@layer`, extracted by a Rust pipeline.

## Install

```bash
# The design system builder
npm install @animus-ui/system

# Pick your bundler plugin
npm install @animus-ui/vite-plugin   # Vite
npm install @animus-ui/next-plugin   # Next.js
npm install @animus-ui/unplugin      # rollup, esbuild, rspack, webpack

# No plugin for your build system, or a CI gate? The standalone CLI:
npm install @animus-ui/cli           # animus build / animus watch
```

Not on Vite or Next? The transform host (`@animus-ui/unplugin`) and the
`animus` CLI are documented in the
[standalone extraction contract](docs/standalone-extraction.md) — module
resolution, the artifact set, exit codes, and a copy-pasteable rollup
quickstart.

## Documentation

Deliberately withheld. The system-definition API is still settling
(vocabulary registration: `build()` → register → `seal()`), and written
guides repeatedly drifted into teaching shapes the current pipeline
rejects. Rather than keep wrong docs, they are removed until the API
freezes. Until then, the sources of truth are:

- the packages' TypeScript definitions — the types are the contract;
- the in-repo consumers, which are compiled, extracted, and asserted on
  every verify run and therefore cannot silently drift:
  `packages/test-ds/src/system.ts` (a kit), the `e2e/*/src/ds.ts` apps,
  and `packages/showcase/src/ds.ts` with its live Examples pages.

## Packages

| Package                                          | Purpose                                                                                              |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| [`@animus-ui/system`](packages/system)           | Builder chain, theme, types, runtime                                                                 |
| [`@animus-ui/vite-plugin`](packages/vite-plugin) | Static CSS extraction for Vite                                                                       |
| [`@animus-ui/next-plugin`](packages/next-plugin) | Static CSS extraction for Next.js                                                                    |
| [`@animus-ui/unplugin`](packages/unplugin)       | Transform host for rollup, esbuild, rspack, webpack                                                  |
| [`@animus-ui/cli`](packages/cli)                 | `animus` — standalone extraction CLI (CI gates, non-JS orchestrators)                                |
| [`@animus-ui/extract`](packages/extract)         | Rust/NAPI extraction engine + the shared extraction session every driver (plugins, host, CLI) drives |
| [`@animus-ui/properties`](packages/properties)   | CSS property data (transitive dep of system)                                                         |

## Legacy

`@animus-ui/core` and `@animus-ui/theming` are the original Emotion-based packages. They are pinned at their last published versions and no longer actively developed.

## License

MIT
