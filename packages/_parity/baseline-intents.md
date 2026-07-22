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
- [x] `embedded-transform-fixture-20260719` — refresh after the reviewed real
      integration fixture replaced the stale string-transform path with a
      self-contained callback whose production-path oracle requires
      callback-specific `width: 8px`; later parity isolated the exact CSS,
      code, and observables drift to `integration/transforms.tsx` in both modes.
      The atomic pair also resnapshots two reviewed, AST-equivalent selector
      fixture comment corrections without changing their non-code surfaces.
- [x] `modern-css-surface-inc03-conditions-20260722` — refresh after the
      reviewed condition-emission increment (K=3 adversarial pass + fix round)
      added four condition-surface corpus units: raw container/media/supports
      block keys plus a registered-alias case supplied via the harness
      condition-alias map. The same run holds every pre-existing unit
      byte-identical (the change's G1 guardrail); these are the oracle's first
      non-breakpoint condition groups.
