# Proposal — extract-v2-spine

## Why

`packages/extract` consumes oxc as a parser vendor, not a pipeline: its IR escapes the arena into owned strings, forcing repeated re-parsing, name-string resolution (with live mis-attribution cases), string-surgery emission, and a NAPI boundary that swallows errors and round-trips the whole manifest per file. These defects are load-bearing across the manifest schema, phase structure, and boundary contract, so repairing them in place is coordinated churn across every module seam. A parity-gated parallel rewrite of the oxc-consuming spine — grounded in shipping reference implementations (oxc, rolldown, tsdown) and gated behind a differential harness — replaces the architecture without destabilizing consumers, who see nothing until an explicit engine flip.

## What Changes

- Build a differential parity harness (v1 as reference oracle) with a scoreboard, an intentional-divergence register, and a v1 self-determinism precondition check.
- Author adversarial parity fixtures for the corpus classes the current suite lacks (shadowing, aliased re-exports, duplicate-binding universes, MDX provider-scope, multi-line imports, `'use client'` variants, cycles).
- Add dual-engine build mechanics: v2 spine compiled alongside v1, engine selected by plugin option, v1 default; `verify:parity` tier + Change-Type Map row added in the same change.
- Implement the v2 spine: parse-once owned-AST store, fact-table manifest (spans/ids, no code strings), stateful NAPI handle with one typed options object and errors-as-data, span-chunk emission — initially bug-compatible with v1's name-based resolution semantics (see design.md for decisions and sequencing; design.md wins on any disagreement).
- Apply a minimal sanctioned determinism patch to v1 (sorted serialization of currently HashMap-ordered fields) so the reference oracle is stable against itself.
- Symbol-correct resolution, sourcemaps, and watch/incremental semantics enter later through the divergence register per the design.md Decision Ledger — not part of the initial spine.

## Capabilities

### New Capabilities

- `extraction-parity-harness` — differential runner over the fixture corpus: v1-vs-v2 (and v1-vs-v1 self-check) comparison at pinned measurement points, scoreboard with per-fixture failure classification, intentional-divergence register with categories.
- `dual-engine-build` — both engines build from one workspace; a plugin-level engine option selects v1 (default) or v2; consumer-visible behavior is unchanged unless the flag is set.
- `deterministic-extraction` — identical inputs produce identical bytes across runs and thread counts, for both engines, on the declared comparison surface.
- `transform-evaluation-contract` — observable contract of the user-transform evaluation seam: value coercion, number/string formatting, error surfacing (no silent eval swallow), cross-file registration ordering; verified by a recorded-expectation battery run against both engines.
- `rendered-usage-semantics` — usage-resolution behavior for the known hard cases (MDX provider-scope tags, aliased imports, duplicate binding names, bare `createElement`, `compose()` reassignment), each with an explicit expected-engine-verdict fixture.
- `arch-extract-v2-spine` — architectural constraints on the v2 spine: parse-once per (file, build); manifest free of generated code strings; no raw string-surgery emission; no v1 module imports outside the declared carry-over allowlist; oxc consumed via the umbrella crate allowlist; ownership and AST-construction containment. All checks executable with positive controls.

### Modified Capabilities

- `verification-tier-policy` — adds the `verify:parity` tier and its Change-Type Map ownership row.
- `extraction-diagnostics` — boundary hardening for the v2 engine: every fallible NAPI export reports errors-as-data or `napi::Result`; malformed input yields non-empty diagnostics; diagnostics comparable as a per-fixture multiset.
- `vite-extraction-plugin` — gains the engine-selection option (default v1).
- `next-config-wrapper` — gains the engine-selection option (default v1).

## Impact

- **Code**: `packages/extract` (v2 spine crate/modules, minimal v1 determinism patch), `packages/extract/pipeline` (options assembly), `packages/vite-plugin` + `packages/next-plugin` (engine flag plumbing), new parity-harness tooling and fixtures, `vite.config.ts` `run.tasks` (`verify:parity`), root `CLAUDE.md` Change-Type Map.
- **APIs**: new v2 NAPI surface (stateful handle, typed options, shared error struct); v1 NAPI surface unchanged; plugin option surfaces gain one engine field.
- **Dependencies**: umbrella `oxc` (0.139+) for v2; `self_cell`; a MagicString-style span-chunk dependency (or minimal in-house port — deferred D2); possibly `lightningcss` (harness-only, CSS AST diff classifier).
- **Systems**: CI Rust build cost roughly doubles while both engines compile (budgeted in the dual-build increment); canary/NAPI freshness checks must account for the second binary or feature-gated paths; consumer fixtures (`e2e/*`, showcase) unchanged until flip.
