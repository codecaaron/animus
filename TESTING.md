# Testing Manifest

## Test Counts

| Tier | Tests | Files |
|------|-------|-------|
| Rust unit | 179 | 9 embedded modules |
| JS unit | 101 | 9 files (core, system, theming, vite-plugin) |
| Canary | 150 | 1 file (extract/tests/canary.test.ts) |
| Integration | 73 | 4 files (_integration) |
| Type | 104+ assertions | 1 file (system/types.test-d.tsx) |
| Post-build | 6 | 1 shell script |
| **Total** | **539+** | **16 JS + 9 Rust + 1 type + 1 shell** |

## Tiers

| Tier | Command | Purpose |
|------|---------|---------|
| Rust unit | `bun run test:rust` | Extraction engine internals (chain walking, style eval, theme resolution, CSS gen) |
| JS unit | `bun test` (filtered by package) | Runtime functions, composition, theme builder, class resolution |
| Canary | `bun run test:canary` | NAPI boundary seal — every extraction feature gets at least one canary |
| Integration | `bun test packages/_integration` | Full pipeline edge — serialize → NAPI → post-process → assert CSS |
| Type | `bun run test:types` | Compile-time contracts — builder chain types, variant inference, theme types |
| Post-build | `bun run test:showcase` | Showcase artifact integrity — @layer, no __TRANSFORM__, animus- classes |

## Behaviors → Test Locations

| # | Behavior | Primary Tier | Primary File | Secondary | Guard |
|---|----------|-------------|-------------|-----------|-------|
| 1 | Chain Recognition | Rust unit | chain_walker.rs (20) | canary §chain-recognition | Bail on unknown methods |
| 2 | Style Evaluation | Rust unit | style_evaluator.rs (18) | canary §style-evaluation | Per-property bail, spread detection |
| 3 | Theme Resolution | Rust unit | theme_resolver.rs (23) | extraction.test.ts §variant-resolution | var() presence, no raw tokens |
| 4 | CSS Generation | Canary (snapshot) | canary.test.ts §snapshot | extraction.test.ts §variant-resolution | @layer structure, hash stability |
| 5 | Transform Emission | Rust unit | transform_emitter.rs (17) | canary §transform-emission | createComponent in output, dead import stripped |
| 6 | Import Resolution | Rust unit | import_resolver.rs (15) | canary §chain-recognition | Barrel re-export traversal |
| 7 | Chain Merging | Rust unit | chain_merger.rs (20) | canary §extension-chains | Topological sort, parent-child merge |
| 8 | JSX Scanning | Rust unit | jsx_scanner.rs (34) | canary §reconciliation | Dynamic vs static detection |
| 9 | Reconciliation | Rust unit | reconciler.rs (9) | extraction.test.ts §multi-file | Unused elimination, .map() tracking |
| 10 | Post-Processing | JS unit | post-processing.test.ts (36) | extraction.test.ts | Unit fallback, transform resolution, prefixing |
| 11 | Serialization | Integration | serialization.test.ts (5) | — | Shape validation, NAPI round-trip |
| 12 | Composition | JS unit + Integration | compose.test.tsx (11), composition.test.ts (9) | Type tests §compose | Slot extraction, shared variant resolution |
| 13 | Runtime Resolution | JS unit | createClassResolver.test.ts (10) | — | Class map → correct class names |
| 14 | Type Contracts | Type | types.test-d.tsx (104+) | — | @ts-expect-error regression, Assert<IsExact> |
| 15 | Artifact Integrity | Post-build | assert-showcase.sh (6) | — | @layer, no __TRANSFORM__, :root, animus- prefix |

## Assertion Patterns by Tier

### Canary (Extraction Edge)
- **Inline snapshots** for full CSS output — the snapshot IS the seal
- Each test probes one behavior through a component fixture
- `extract()` and `analyzeProject()` as the harness
- Review snapshots like diffs — understand WHY output changed before updating

### Integration (Pipeline Edge)
- **Explicit assertions** on behavior, not full output shape
- `runPipeline()` helper: NAPI → resolveTransformPlaceholders → applyUnitFallback
- `test.each()` for parametrized variant/scale resolution
- `assertNoUnresolvedTokens()` guard on every pipeline output
- Token guard derives from shared theme fixture — not hand-maintained

### Unit (Core)
- **Explicit assertions**, no snapshots
- `test.each()` for input/output matrices (unitless properties, token alias patterns)
- Edge cases are the focus: negative values, zero, missing keys, function call values
- Co-located with the module they test

### Type (Contract)
- `@ts-expect-error` comments as regression guards (TS2578 if type regresses)
- `Assert<IsExact<A, B>>` for precise type equality
- Real JSX expressions as type probes
- `tsc --noEmit` via `bun run test:types`

### Post-build (Seal)
- `grep`-based assertions on `dist/` artifacts
- Presence/absence checks only — fast, cheap, no framework
- Runs after `vite build` of showcase

## Token Invariant Guard

Every integration test that produces CSS through `runPipeline()` includes an `assertNoUnresolvedTokens(css)` call. This guard:

- Derives color token names from `tokens.serialize().variableMapJson`
- Asserts no raw token name appears as a bare CSS property value (e.g., `background-color: primary;`)
- Catches the "dishonest fixture" problem where a non-existent token emits raw instead of `var()`

Location: `packages/_integration/__tests__/assert-no-unresolved-tokens.ts`
