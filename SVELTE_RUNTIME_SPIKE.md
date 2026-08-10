# Svelte 5 runtime spike — superseded

This was the initial runtime-only spike. Native Svelte source extraction, the
real compiler/Vite consumer, SSR assertions, and the supported authoring
boundary now exist, so the current guide is [docs/svelte.md](docs/svelte.md).

The supported pattern keeps resolver definitions in JavaScript/TypeScript,
imports an ordinary named resolver into a native Svelte instance script, calls
`.attrs({ ... })` directly with an explicit object literal, and spreads the
returned `{ class, style? }` onto a native element. Those direct call sites are
now projected into the shared OXC usage pipeline; a used custom dynamic prop
does not require the old `staticCss.components.*.dynamicProps` workaround.

The bounded caveats also live in the guide: explicit `defaultVariant` values
are required for usage-based variant pruning, dynamic values retain every
declared variant, custom preprocessors and non-relative resolver sources are
not supported, and authoring keeps only `@types/react` as a development-only
dependency for the strict declaration closure — the extraction-only system
binding removed the React runtime package from development and build-time
authoring, and the resolver-only runtime and production client/SSR artifacts
remain React-free.
