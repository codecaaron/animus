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
- [x] `modern-css-surface-inc06-builtins-20260722` — refresh after the
      reviewed built-in condition increment added four builtin-alias corpus
      units (`condition-builtin-{motion,osdark,print,order}`): the nine D8
      built-ins ship at reserved orders 300–380, and the harness alias map
      gained `_osDark`/`_print` at real built-in orders. Every pre-existing
      unit stays byte-identical in the same run (G1), including the blessed
      inc-03 `condition-aliased` unit whose harness `_motionReduce` entry is
      unchanged.
- [x] `modern-css-surface-inc08-container-20260722` — refresh after the
      reviewed ergonomics-survey increment landed the compose-slot container
      card (Root establishes `container-name: card`, slots respond) and the
      registered-`@property` contextual-var consumer — the oracle's first
      compose×container and registered-var units. Every pre-existing unit
      stays byte-identical in the same run (G1).
- [x] `modern-css-surface-corpus-headers-20260722` — comment-only refresh: the
      ten condition/container corpus fixtures' "NOT yet blessed" staging
      headers were stale after their blessings (inc 03/06/08), one fixture
      cited a consumer-lane assertion that did not exist at authoring time
      (now real: the showcase @property pin), and the builtin-motion header
      overclaimed band provenance. No emission-affecting bytes change; every
      unit's css/observables stay byte-identical — only the embedded `code`
      artifacts move.
- [x] `ani-fix-witness-fixtures-20260803` — four candidate-only corpus units
      pinning the ANI batch-1 extraction fixes, no pre-existing unit moves:
      `duplicate-compose-modules` (cross-module compose identity — two modules
      with same-named local slot recipes each namespace under their own
      module's Root class), `extension-compounds` (extension-added compounds
      renumbered against the extending component over the flattened
      parent-first order, pinned at two depths), `compose-default.tsx` (the
      `--pace-default`-keyed inheritance rule propagates an omitted Root
      prop's default; no child-side default override), and
      `compose-slot-bail` (an unresolvable compose slot fails closed with the
      bail diagnostic instead of binding a same-named component from another
      module). The usage-side bare-name keying correction is deliberately NOT
      in this refresh — it lands as its own change with an identity
      concordance + semantic differential, registering the expected
      `duplicate-binding` drift when it does. Every pre-existing unit stays
      byte-identical in the same run.
- [x] `ani-closeout-fixture-batch-20260803` — refresh once after adding the
      two audit-gap corpus fixtures for the ledger closeout change
      (openspec: ani-ledger-closeout, increment 03):
      `inline-asserted-targets.tsx` (ANI-015 — an `as const` tag and an
      `as`-typed component target extract exactly like their bare forms
      after the chain_walk assertion-unwrap fix) and
      `color-family-pass-through.tsx` (ANI-009 — `backgroundColor`/`color`
      longhands resolve semantic tokens at top level and in responsive
      slots; a `borderTopColor` literal passes through). New units only —
      every pre-existing unit stays byte-identical in the same run.
- [x] `member-target-extraction-20260804` — refresh once after
      `inline-asserted-targets.tsx` gained the static-member arm:
      `asComponent(Compound.Item as unknown as typeof Compound.Item)` now
      EXTRACTS (chain_walk resolves dotted static-member paths, peeling
      assertions at every hop) instead of bailing — the 0.1.3 reproduction
      probe 4 gap. Only this unit drifts; every other unit stays
      byte-identical in the same run. CAVEAT (recorded by the follow-up
      refresh below): this refresh also baselined a dev/prod asymmetry it
      did not flag — production reconciliation pruned the wrapped `Item`
      while development kept it.
- [x] `as-component-target-keep-20260804` — refresh once after review fixed
      the dev/prod asymmetry the previous intent baselined: reconciliation
      now keeps `asComponent()` wrap targets (the emitted wrapper calls
      `createComponent(<target>, …)`, merging the target's class onto the
      element, so the target's CSS is runtime-required whenever the wrapper
      renders even though the target never appears as a JSX tag). In
      `inline-asserted-targets.tsx` the production oracle gains the
      `animus-Item-*` padding rule (matching what development always kept)
      and the reconciliation report stops counting `Item` as eliminated.
      Only this unit drifts; every other unit stays byte-identical in the
      same run.
- [x] `extension-bail-witness-20260806` — refresh once after extension-parent
      resolution gained fail-loud bails: in the per-file unit
      `extract/extension-child.tsx`, the parent's relative import resolves
      outside the single-file universe, and the child chain — already absent
      from code and CSS at baseline (a silent drop) — now leaves the
      `could not resolve parent component` bail diagnostic behind. Only this
      unit's diagnostics surface drifts (identical hashes in both modes; the
      combined `extract-all` unit, where the parent is present and the child
      inherits, stays byte-identical). Every other unit stays byte-identical
      in the same run.
