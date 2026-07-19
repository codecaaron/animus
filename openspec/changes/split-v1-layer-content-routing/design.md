## Context

`generate_layer_content()` is a private V1 CSS helper called four times by
`generate_css()`, once for each of base, variants, compounds, and states. The
function currently loops components and switches on the requested layer inside
that loop. Its variant arm also owns option ordering, default-sidecar lookup,
and selector construction.

The public layer generator and downstream tests already establish current CSS
behavior. V2 carries an identical engine-local compatibility implementation and
remains independently owned. The source target is clean; the protected dirty
tree outside it hashes to
`4353bacb030163d6724ad091f33a4bc1a60a9dc9bafb02a8a71e79cf76a8dae7`.

## Goals / Non-Goals

**Goals:**

- Dispatch once on `LayerKind` before component traversal.
- Give base, variants, compounds, and states one private emitter each.
- Characterize exact selector and source order before production editing.
- Preserve every caller/runtime and engine boundary.

**Non-Goals:**

- Change layer names, declarations, selectors, formatting, or source order.
- Refactor structured per-component sheet generation.
- Reconcile stale canonical layer-order wording.
- Edit or share the V2 CSS implementation.

## Decisions

### D1: Dispatch once before component traversal

- **Choice**: retain `generate_layer_content()` as the allocation/dispatch seam
  and match `LayerKind` once before calling a private emitter.
- **Rationale**: callers and return shape remain unchanged while the generic
  function no longer mixes all traversal policies.
- **Alternatives considered**: matching per component retains the original
  coupling; changing callers broadens the public generator diff.

### D2: Use four direct buffer-writing emitters

- **Choice**: add `write_base_layer_content()`,
  `write_variant_layer_content()`, `write_compound_layer_content()`, and
  `write_state_layer_content()` with the existing loops and selector rules.
- **Rationale**: each current policy becomes locally legible without collecting
  intermediate rule descriptors or changing allocation/order.
- **Alternatives considered**: boxed iterators add runtime and lifetime
  machinery; one generic helper merely relocates the mixed branch.

### D3: Characterize exact content before production editing

- **Choice**: add `layer_content_preserves_kind_routing_order_and_selectors`
  with two components and run it GREEN against the nested implementation before
  the structural RED check and source rewrite.
- **Rationale**: this is a behavior-preserving refactor; an exact string matrix
  pins inter-component order, every owned selector, matching sidecars, and
  absent/unmatched-default omission at the private seam.
- **Alternatives considered**: existing contains-based tests and downstream
  canaries are broader but do not pin all four private outputs byte-for-byte.

### D4: Keep V1 and V2 independent

- **Choice**: edit only V1 `css_generator.rs`; protect V2 `css.rs` by content
  hash.
- **Rationale**: the engines own separate CSS phases even when compatibility
  code is currently identical.
- **Alternatives considered**: shared code couples the behavioral oracle to its
  consumer without co-change evidence.

## North Star

**Adversarial cadence K**: 1

- **NS1**: Exact per-layer CSS bytes and source order remain stable.
- **NS2**: One top-level dispatch and four private emitters own layer routing.
- **NS3**: Public generator, layer declaration, selector, pseudo, responsive,
  and formatting contracts stay stable.
- **NS4**: NAPI, canary, and integration boundaries remain green.
- **NS5**: V2 remains independent — provisional — revisit on
  `repowise:v2-css-routing-plan`.

## Decision Ledger

| ID | Decision | Status | Owner increment | Resolving signal | Review-by |
| --- | --- | --- | --- | --- | --- |
| DEF-1 | Refactor `generate_css_sheets_ordered()` complexity | deferred | external:structured-sheet-plan | repowise:structured-sheet-plan | 3 reorientations \| 2026-08-19 |
| DEF-2 | Share layer generation between V1 and V2 | deferred | external:v2-css-routing-plan | repowise:v2-css-routing-plan | 3 reorientations \| 2026-08-19 |
| DEF-3 | Reconcile canonical layer-order wording with current `anm-` output | deferred | external:canonical-layer-contract | spec:canonical-layer-contract | 3 reorientations \| 2026-08-19 |
| DEF-4 | Generalize layer rules into a reusable iterator abstraction | deferred | external:second-layer-rule-consumer | external:second-layer-rule-consumer | 3 reorientations \| 2026-08-19 |

## Guardrail Register

| ID | Invariant | Scope | On trip | Status |
| --- | --- | --- | --- | --- |
| G1 | The change SHALL NOT alter a public CSS generator type/function signature | footprint:packages/extract/src/css_generator.rs | STOP | active (inc 01 final: empty) |
| G2 | Four private emitters SHALL be called once each from one top-level kind match, and component-loop dispatch SHALL be absent | footprint:packages/extract/src/css_generator.rs | STOP | active (inc 01 final: definitions 4; occurrences 8; match 1; old dispatch empty) |
| G3 | Exact base, ordered option/default, indexed compound, and ordered state content SHALL remain characterized | footprint:packages/extract/src/css_generator.rs | STOP | active (inc 01 final: focused 1/1) |
| G4 | The V2 CSS implementation SHALL remain byte-stable | footprint:packages/extract/crates/extract-v2/src/css.rs | STOP | active (inc 01 final: `bc426b39a9c42ac6950a67fb43ec97b052b4bc36b478334ad1e6451d129b2858`) |
| G5 | The change SHALL NOT move any pre-existing dirty increment | all | STOP | active (inc 01 final: `4353bacb030163d6724ad091f33a4bc1a60a9dc9bafb02a8a71e79cf76a8dae7  -`) |
| G6 | The change SHALL NOT regress mapped V1 extraction verification | change-end | STOP | active (inc 01 final: Clippy 0; Rust 279 + 8/1 ignored + 348; canary 200; integration 157) |

Checks — verbatim commands:

**G1** — expected: empty output

```bash
git diff --unified=0 -- packages/extract/src/css_generator.rs | rg '^[+][^+].*pub (struct|fn|enum|const|type)|^[-][^-].*pub (struct|fn|enum|const|type)' || true
```

**G2** — expected: counts 4, 8, and 1, then empty output

```bash
test "$(rg -c '^fn write_(base|variant|compound|state)_layer_content\(' packages/extract/src/css_generator.rs || true)" = 4
test "$(rg -c 'write_(base|variant|compound|state)_layer_content\(' packages/extract/src/css_generator.rs || true)" = 8
test "$(rg -c '^    match kind \{' packages/extract/src/css_generator.rs || true)" = 1
rg -n -U 'for component in components \{\n\s*match kind' packages/extract/src/css_generator.rs || true
```

**G3** — expected: focused characterization passes

```bash
RUSTUP_TOOLCHAIN=1.97.0 repowise distill cargo test --manifest-path packages/extract/Cargo.toml css_generator::tests::layer_content_preserves_kind_routing_order_and_selectors --lib
```

**G4** — expected:
`bc426b39a9c42ac6950a67fb43ec97b052b4bc36b478334ad1e6451d129b2858  packages/extract/crates/extract-v2/src/css.rs`

```bash
shasum -a 256 packages/extract/crates/extract-v2/src/css.rs
```

**G5** — expected:
`4353bacb030163d6724ad091f33a4bc1a60a9dc9bafb02a8a71e79cf76a8dae7  -`

```bash
git diff -- . ':(exclude)packages/extract/src/css_generator.rs' | shasum -a 256
```

**G6** — expected: every command exits zero after exact printed prerequisite remediation

```bash
repowise distill vp run verify:clippy
repowise distill vp run verify:unit:rust
repowise distill vp run verify:canary
repowise distill vp run verify:integration
```

## Risks / Trade-offs

- [Risk] Moving dispatch outside the component loop changes inter-component
  order -> Mitigation: each caller requests exactly one kind, and the direct
  matrix plus full generator tests pin order.
- [Risk] Helper extraction changes option/default or state order -> Mitigation:
  move the existing loops intact and assert exact strings.
- [Risk] A matching, absent, or unmatched default changes emission ->
  Mitigation: keep the existing lookup and characterize a non-first matching
  sidecar plus both no-sidecar paths.
- [Risk] Cross-engine duplication appears actionable -> Mitigation: V2 is
  hash-protected and engine-local; DEF-2 names the reopening signal.
- [Trade-off] Structured-sheet complexity remains -> accepted; DEF-1 owns that
  larger, independently callable path.

## Migration Plan

N/A — private V1 refactor with no rollout. Acceptance requires GREEN behavior,
pre-edit structural RED, final GREEN, G1-G6, strict OODA validation, and
independent two-phase review.
