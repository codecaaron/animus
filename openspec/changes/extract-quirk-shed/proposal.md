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
- `selectorOrder` dead surface is wired or removed (direction deferred
  with signal in brainstorm.md).
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
- `builder-chain`: `selectorOrder` requirement is added or the surface
  is removed from the builder API (per deferral resolution).

## Impact

- Code: `packages/extract/crates/extract-v2/src/{theme,analyze_css,
  assemble,engine}.rs`, `packages/_parity/register.json` + corpus,
  possibly `packages/system/src/SystemBuilder.ts` (selectorOrder), v1
  backports only where plugins consume a shared contract.
- APIs: none breaking; new diagnostics appear in manifests.
- Dependencies: hard dependency on `extract-v2-default-flip` shipping
  first (guardrail: sheds must reach users as fixes, not parity breaks).
- Systems: the differential harness's reference flips from live-v1 to
  committed baselines at the final increment.
