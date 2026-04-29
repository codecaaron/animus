## ADDED Requirements

### Requirement: Consumer-configurable file-extension list with sensible defaults

The bundler adapter plugins (`@animus-ui/vite-plugin`, `@animus-ui/next-plugin`) SHALL expose a `extensions?: string[]` option on their respective options interfaces (`AnimusExtractOptions`, `AnimusNextOptions`). When the option is undefined, both adapters SHALL default to a shared `DEFAULT_EXTENSIONS` constant exported from `@animus-ui/extract/pipeline`. The default SHALL include `.ts`, `.tsx`, `.js`, `.jsx`, and `.mdx`. Both adapters SHALL import the default from the same source of truth — independent redeclaration SHALL be considered a regression.

Adapter parity: any change to the default extension list lands in one module (`packages/extract/pipeline/mdx-preprocessor.ts`) and propagates to both plugins by import.

#### Scenario: Default extensions include `.mdx`
- **WHEN** a plugin is invoked without an `extensions` option
- **THEN** the plugin's file-discovery walk SHALL include `.ts`, `.tsx`, `.js`, `.jsx`, and `.mdx` files, matching the shared `DEFAULT_EXTENSIONS` constant

#### Scenario: Consumer override replaces the list
- **WHEN** a plugin is invoked with `extensions: ['.ts', '.tsx']`
- **THEN** the file-discovery walk SHALL walk ONLY `.ts` and `.tsx` files — the consumer's list fully replaces the default, no additive merge

#### Scenario: Consumer can add extensions beyond the default
- **WHEN** a plugin is invoked with `extensions: ['.ts', '.tsx', '.js', '.jsx', '.mdx', '.md']`
- **THEN** the file-discovery walk SHALL include `.md` files alongside the default set. The plugin does NOT attempt preprocessing for unknown extensions — `.md` files are handed directly to the scanner (which will skip them as non-JSX) unless a preprocessor for `.md` exists

#### Scenario: Both plugins import the shared constant
- **WHEN** either plugin's source is inspected
- **THEN** the file-discovery walk's default-extension resolution SHALL be `options.extensions ?? DEFAULT_EXTENSIONS` (where `DEFAULT_EXTENSIONS` is imported from `@animus-ui/extract/pipeline`). Neither plugin SHALL carry its own local copy of the default list

### Requirement: File-discovery walk includes `.mdx` sources by default

The bundler adapter plugins SHALL include `.mdx` files in their `buildStart` file-discovery walk alongside existing `.ts`/`.tsx`/`.js`/`.jsx` coverage — via the `DEFAULT_EXTENSIONS` default (see preceding requirement), not as a hardcoded module-local list. MDX files SHALL be pre-processed into scanner-consumable JSX form before being passed to the Rust NAPI `analyzeProject` call. Pre-processing failures on individual files SHALL warn via the plugin's logger (prefix `[animus] ⚠`) and exclude that file from the scanner input, without halting the build.

#### Scenario: `.mdx` files appear in the scanner's input set (default config)
- **WHEN** the vite-plugin's or next-plugin's `buildStart` runs with default options AND `.mdx` files present under the discovery root
- **THEN** those files SHALL be included in the scanner input (after MDX→JSX pre-processing) and their JSX references counted by the usage ledger

#### Scenario: Consumer opt-out via `extensions` override
- **WHEN** a plugin is invoked with `extensions: ['.ts', '.tsx', '.js', '.jsx']` (dropping `.mdx`)
- **THEN** the file-discovery walk SHALL NOT include `.mdx` files, MDX preprocessing SHALL NOT be invoked, and the `@mdx-js/mdx` peer-dep SHALL NOT be dynamically imported (zero install-footprint cost for MDX-free consumers)

#### Scenario: Pre-processing failure does not halt the build
- **WHEN** an individual `.mdx` file fails MDX→JSX pre-processing (malformed frontmatter, invalid JSX, etc.)
- **THEN** the plugin SHALL emit a `[animus] ⚠ MDX preprocessing failed for <file>: <error>` warning via its logger, exclude that file from scanner input, and continue the buildStart with remaining files

#### Scenario: MDX-rendered component extracts in production builds
- **WHEN** `bun run clean:full && bun run verify:build:showcase` completes with MDX files rendering ds-built components (e.g. `<MetricGrid>` in `packages/showcase/src/content/**/*.mdx`)
- **THEN** the resulting `packages/showcase/dist/assets/styles-*.css` SHALL contain the component's CSS rules — `animus-MetricGrid*` selectors SHALL be present

#### Scenario: Adapter-parity via shared constant
- **WHEN** either adapter's default extensions are inspected
- **THEN** the default SHALL trace to the single `DEFAULT_EXTENSIONS` export in `@animus-ui/extract/pipeline`. Parity drift (one plugin's default list differing from the other's) is impossible unless a plugin bypasses the shared import — which SHALL be considered a regression

### Requirement: `@mdx-js/mdx` declared as peer-dep-optional, loaded via dynamic import

The plugin packages SHALL declare `@mdx-js/mdx` in both `peerDependencies` (range `^3.0.0`) AND `peerDependenciesMeta: { "@mdx-js/mdx": { optional: true } }`. The preprocessor module SHALL load `@mdx-js/mdx` via `await import('@mdx-js/mdx').catch(() => null)` — dynamic, with null-fallback on resolution failure.

#### Scenario: Consumer with `.mdx` in extensions and `@mdx-js/mdx` installed
- **WHEN** a consumer has `.mdx` in `options.extensions` (or defaults) AND `@mdx-js/mdx@^3` resolvable in their module graph
- **THEN** MDX files SHALL preprocess and feed to the scanner as expected

#### Scenario: Consumer with `.mdx` in extensions but `@mdx-js/mdx` absent
- **WHEN** a consumer has `.mdx` in `options.extensions` but `@mdx-js/mdx` is NOT resolvable
- **THEN** the plugin SHALL emit a one-shot buildStart warning `[animus] ⚠ .mdx in extensions but @mdx-js/mdx not installed; MDX files skipped` and SHALL continue the build with `.mdx` files excluded from scanner input

#### Scenario: Consumer without `.mdx` in extensions
- **WHEN** a consumer configures `options.extensions` to exclude `.mdx`
- **THEN** the preprocessor SHALL NOT be invoked, `@mdx-js/mdx` SHALL NOT be dynamically imported, and non-MDX consumers SHALL pay zero install footprint cost regardless of whether `@mdx-js/mdx` is resolvable
