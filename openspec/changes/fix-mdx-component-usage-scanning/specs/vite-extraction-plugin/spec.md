## ADDED Requirements

### Requirement: File-discovery walk includes `.mdx` sources
The bundler adapter plugins (`@animus-ui/vite-plugin`, `@animus-ui/next-plugin`) SHALL include `.mdx` files in their `buildStart` file-discovery walk alongside existing `.ts`/`.tsx`/`.js`/`.jsx` coverage. MDX files SHALL be pre-processed into scanner-consumable JSX form before being passed to the Rust NAPI `analyzeProject` call. Pre-processing failures on individual files SHALL warn via the plugin's logger (prefix `[animus] ⚠`) and exclude that file from the scanner input, without halting the build.

Adapter parity: both adapters SHALL cover `.mdx`. An asymmetric coverage state (one adapter walks MDX, the other doesn't) SHALL be considered a regression and caught by CI.

#### Scenario: `.mdx` files appear in the scanner's input set
- **WHEN** the vite-plugin's or next-plugin's `buildStart` runs with `.mdx` files present under the discovery root
- **THEN** those files SHALL be included in the scanner input (after MDX→JSX pre-processing) and their JSX references counted by the usage ledger

#### Scenario: Pre-processing failure does not halt the build
- **WHEN** an individual `.mdx` file fails MDX→JSX pre-processing (malformed frontmatter, invalid JSX, etc.)
- **THEN** the plugin SHALL emit a `[animus] ⚠ MDX preprocessing failed for <file>: <error>` warning via its logger, exclude that file from scanner input, and continue the buildStart with remaining files

#### Scenario: MDX-rendered component extracts in production builds
- **WHEN** `bun run clean:full && bun run verify:build:showcase` completes with MDX files rendering ds-built components (e.g. `<MetricGrid>` in `packages/showcase/src/content/**/*.mdx`)
- **THEN** the resulting `packages/showcase/dist/assets/styles-*.css` SHALL contain the component's CSS rules — `animus-MetricGrid*` selectors SHALL be present

#### Scenario: Adapter-parity for next-plugin
- **WHEN** next-plugin's file discovery runs for a next-app with MDX sources
- **THEN** the scanner SHALL see those MDX JSX references the same way vite-plugin does; post-fix, parity is a CI-enforceable invariant (e.g. both adapters' discovery walks include `.mdx`)
