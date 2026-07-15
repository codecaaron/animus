## Why

The extractor proves style reachability only for literal JSX values on name-matched components; everything else falls to the runtime CSS-var path. Today it cannot even say *why* a site went dynamic — the classifier discards expression kind and span, so the dynamic residue is unmeasurable and every improvement proposal is a guess. Meanwhile two cheap, already-scaffolded wins sit unused (cross-file static-value resolution is not consulted for JSX attributes; statically-enumerable conditionals are treated as opaque), and the runtime's single resolution choke point makes a dev-mode reachability witness nearly free. This change makes the residue observable, harvests the depth-0 wins, and gates all expensive interprocedural machinery on measured evidence.

## What Changes

- Dynamic-site classification retains **expression kind + span** and surfaces per-site residue records in v2-native manifest fields, with a histogram tool over built manifests. See design.md for pre-flip safety.
- JSX attribute evaluation consults **resolved static values** (identifiers, member expressions) and expands **statically-enumerable conditionals** into observed value sets feeding the shared prop map (post-flip, v2-only; see design.md).
- The runtime gains a **dev-mode witness recorder** at `resolveClasses`, buffering (component, prop, value, outcome) tuples for reachability observation; excluded from production bundles.
- Conduit summaries, checker oracle, token-type contract exports, and witness feedback into builds are **deferred** behind measurement signals (design.md Ledger).

## Capabilities

### New Capabilities

- `usage-residue-facts`: per-site dynamic-usage records (expression kind, span, binding, prop) and histogram derivability from manifests.
- `style-witness-recording`: bounded dev-mode buffer of runtime resolution outcomes with a documented retrieval handle; production exclusion.

### Modified Capabilities

- `jsx-system-prop-scanner`: "Static value evaluation" gains resolution through project static values and enumerable-set expansion for static-armed conditionals/logicals.
- `shared-system-prop-map`: map entries additionally sourced from members of statically-enumerable value sets, not only directly observed literals.

## Impact

- `packages/extract/crates/extract-v2/` — classifier payload (`jsx_scan.rs`, `usage_facts.rs`), statics-into-JSX wiring, enumerable-set utility inputs. v1 untouched.
- `packages/system/src/runtime/` — witness recorder alongside `resolveClasses`.
- `openspec/changes/prop-flow-reachability/tools/` — residue histogram script reading built manifests (showcase + e2e apps).
- Parity: residue facts are additive v2-native fields (pre-flip safe); classification/map changes are gated on `external:extract-v2-engine-flip`.
- Tests: v2 crate unit tests; runtime Vitest; tiers per Change-Type Map rows for the touched surfaces.
