# Proposal: extract-quirk-shed

## Why

The v2 engine reproduces v1's bugs BY CONTRACT — bug-compatibility kept
the rewrite's parity claims falsifiable (archived
`2026-07-13-extract-v2-spine`, design D3). That contract's second half
comes due once v2 is the shipped default: every registered quirk is a
real defect reaching real users — invalid CSS emitted silently,
`'use client'` directives buried under imports, components vanishing
with no diagnostic. The register was designed so divergence can now be
LICENSED per-entry instead of forbidden: each shed fixes v2, registers
the intentional divergence, and keeps the differential harness as the
gate rather than fighting it.

## What Changes

- Unresolved-token-alias passthrough gains a diagnostic and stops
  emitting invalid CSS (clears four active css-validity register
  entries).
- `'use client'` detection handles leading trivia (comment before the
  directive no longer breaks Next output).
- Import emission stops substring-grepping generated text (no spurious
  imports from user strings).
- Eval-failed chains emit a bail diagnostic instead of vanishing
  silently.
- `duplicate-compose` register entry drops (v2 already correct; zero
  code).
- `selectorOrder` is removed from `SerializedConfig` and
  `SystemBuilder.toConfig()`; retained NAPI argument slots receive a
  placeholder until v1 retires.
- Vite and Next surface manifest warn diagnostics through their
  developer warning channels.
- Final increment: v1 leaves the oracle set; the differential inverts to
  committed v2 baselines; v1 retirement (including the `loadSystemModule`
  decision) begins.

## Capabilities

### Modified Capabilities

- `deterministic-extraction`: invalid-CSS passthrough becomes a
  diagnosed, valid-output requirement.
- `extraction-diagnostics`: new bail/warn scenarios (eval-drop, alias
  leak) become required diagnostics.
- `extraction-parity-harness`: register-licensed divergence + oracle
  inversion (v1 → committed baselines) become requirements.
- `transform-evaluation-contract`: directive/import emission
  requirements replace the grep-quirk scenarios.
- `next-webpack-integration` and `pipeline-integration-testing`: active
  consumers stop requiring a serialized `selectorOrder` value while
  preserving the production NAPI call shape.
- `verification-tier-policy`: the standing parity tier, CI wiring, and
  change-type coverage follow the committed-v2 oracle and shared loader.

## Impact

- Code: `packages/extract/crates/extract-v2/src/{theme,analyze_css,
  assemble,engine}.rs`, `packages/_parity/register.json` + corpus,
  `packages/system/src/SystemBuilder.ts`, plugin consumers, integration
  helpers, and selector-order documentation; v1 backports only where
  plugins consume a shared contract.
- APIs: subtractive removal of the dead `SerializedConfig.selectorOrder`
  field; new diagnostics appear in manifests and plugin warning output.
- Dependencies: hard dependency on `extract-v2-default-flip` shipping
  first (guardrail: sheds must reach users as fixes, not parity breaks).
- Systems: the differential harness's reference flips from live-v1 to
  committed baselines at the final increment; the parity tier and CI exercise
  that committed oracle.
