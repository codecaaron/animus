# arch-parity-refresh-discipline Specification

## Purpose

Additive-only discipline for parity oracle refreshes — existing valid-case expectations never rewrite.

## Requirements
### Requirement: Parity oracle refreshes are additions-only

A refresh of the recorded parity oracle SHALL only add cases or add newly-recorded rejection expectations; every pre-existing valid-case expectation SHALL remain byte-identical across the refresh. A refresh that rewrites an existing expectation to match newly-observed output converts a live bug into the recorded baseline and is a discipline violation, not a refresh. Known blind spot: the tier proves the recorded corpus is internally consistent — the additions-only property itself is confirmed on the refresh diff at review, and coverage is only as strong as the existing battery.

#### Scenario: Parity tier green after an additions-only refresh

- **WHEN** the following command is run after an oracle refresh

```bash
vp run verify:parity
```

- **THEN** it exits 0 (requires a fresh v2 NAPI; a stale NAPI fails loud with `PREPARE:` rather than passing vacuously)
- **AND** the recorder diff for the refresh shows only added cases — no modified valid-case expectations

#### Scenario: Stale parity register fails the tier

- **WHEN** the following command is run with a non-empty active register left over from a completed refresh

```bash
cat packages/_parity/register.json
```

- **THEN** the expected content at rest is `[]`; a stale active entry fails `vp run verify:parity` by design

