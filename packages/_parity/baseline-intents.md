# Parity baseline refresh journal

Every oracle refresh requires a checked intent here before the privileged
`scripts/verify/refresh-parity-baseline.sh <intent>` command can write the
committed production/development pair. Ordinary parity runs never write it.

- [x] `extract-quirk-shed-inc-07-seed` — seed the v2 oracle after the final
      live-v1 differential passed with 23 production and 27 development
      divergences, all registered; increments 01–06 and 08 are ticked.
- [x] `total-floor-prop-flow-20260713` — refresh the production/development v2
      oracle once after the reviewed total system-prop floor, reachable-component
      bound, and static JSX value enrichment intentionally changed CSS, runtime
      metadata, and generated resolver payloads.
- [x] `review-reachability-hardening-20260713` — refresh after external review
      corrected alias/member/local/dynamic component identity so the system floor
      and reconciliation share one conservative canonical reachability set.
