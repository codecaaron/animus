# Retired tools

Retired 2026-07-13 by `extract-v2-default-flip` increment 03, per that
change's design D3 (scaffolding retirement scoped to provably-dead
surfaces):

- `code-parity.ts`
- `css-parity.ts`
- `chain-parity.ts`

All three were change-local differential scaffolding subsumed by the
3-leg `verify:parity` tier (`scripts/verify/parity.sh` +
`packages/_parity`, including `tools/seam-battery.ts`), which is the
living harness.

The remaining files here (`analyze-run.ts`, `determinism-check.sh`,
`determinism-run.ts`, `evidence-prepatch-diff.txt`) are kept as the
archive's evidence basis, not as runnable scaffolding.
